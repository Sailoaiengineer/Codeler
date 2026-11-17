// Pure AI panel logic: provider request shapes, reply parsing, edit blocks, MCP config checks. No vscode import.

export type Provider = 'anthropic' | 'openai' | 'google';
export const PROVIDERS: readonly Provider[] = ['anthropic', 'openai', 'google'];
export const PROVIDER_LABELS: Record<Provider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' };
export const DEFAULT_MODELS: Record<Provider, string> = { anthropic: 'claude-sonnet-5-5', openai: 'gpt-5.6', google: 'gemini-3-pro' };

export type ToolDef = { name: string; description: string; inputSchema: Record<string, unknown> };
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };
export type ToolResult = { id: string; name: string; text: string; isError: boolean };
export type Turn =
	| { role: 'user'; text: string }
	| { role: 'assistant'; text: string; calls: ToolCall[] }
	| { role: 'tool'; results: ToolResult[] };
export type ProviderReply = { text: string; calls: ToolCall[] };
export type ProposedEdit = { path: string; content: string; error?: string };

export const SYSTEM_PROMPT = [
	'You are a coding assistant inside the Codeler editor.',
	'To change a file, reply with the complete new file contents in one fenced block whose info string is the language, then path=, then the path relative to the workspace root, for example:',
	'```ts path=src/app.ts',
	'...full file contents...',
	'```',
	'Never use absolute paths or "..". Explain briefly outside the blocks. The user reviews every change before it is written.',
].join('\n');

// Paths the model proposes must stay inside the workspace folder. Returns an error message, or undefined when the path is fine.
export function checkRelativePath(p: string): string | undefined {
	if (!p || p.includes('\0')) return 'The path is empty or invalid.';
	if (/^([A-Za-z]:|[\\/])/.test(p)) return 'The path must be relative to the workspace.';
	if (p.split(/[\\/]/).includes('..')) return 'The path must not contain "..".';
	// .git and .codeler hold history and repo data; team config folders run tasks and hooks, so an AI edit never writes there either.
	if (p.split(/[\\/]/).some(s => /^\.(git|codeler|vscode|github|husky)$/i.test(s))) return 'Codeler will not edit .git, .codeler or team config (.vscode, .github, .husky) files.';
	return undefined;
}

// Windows runs npx, npm and other .cmd shims only through cmd.exe. Plain text only is passed there.
export function windowsLaunch(command: string, args: string[], platform: string = process.platform): { command: string; args: string[] } | { error: string } {
	if (platform !== 'win32' || /\.exe$/i.test(command)) return { command, args };
	const plain = /^[\w@.\/\\:=+,-]+$/;
	if (![command, ...args].every(s => plain.test(s))) {
		return { error: "This MCP server's command has characters Codeler won't pass to the Windows shell. Use the full path to an .exe instead." };
	}
	return { command: 'cmd.exe', args: ['/d', '/s', '/c', command, ...args] };
}

// Reads fenced blocks whose info string has path=<file>. Other fenced code stays in the prose.
export function parseEditBlocks(text: string): { prose: string; edits: ProposedEdit[] } {
	const lines = text.split('\n');
	const prose: string[] = [];
	const edits: ProposedEdit[] = [];
	for (let i = 0; i < lines.length; i++) {
		const open = /^\s*(`{3,})(.*)$/.exec(lines[i]);
		const pathMatch = open && /(?:^|\s)path=(\S+)/.exec(open[2]);
		if (!open || !pathMatch) { prose.push(lines[i]); continue; }
		const fence = open[1];
		const body: string[] = [];
		let j = i + 1;
		for (; j < lines.length; j++) {
			const t = lines[j].trim();
			if (t.length >= fence.length && /^`+$/.test(t)) break;
			body.push(lines[j]);
		}
		// shortcut: a block with no closing fence may be cut off, so it is rejected instead of written
		const cut = j >= lines.length;
		edits.push({ path: pathMatch[1], content: body.length ? body.join('\n') + '\n' : '', error: cut ? 'The reply was cut off before this file ended.' : checkRelativePath(pathMatch[1]) });
		i = j;
	}
	return { prose: prose.join('\n').trim(), edits };
}

const MODEL_RE = /^[A-Za-z0-9._:-]{1,100}$/;
const KEY_HEADER: Record<Provider, string> = { anthropic: 'x-api-key', openai: 'authorization', google: 'x-goog-api-key' };

export type RequestOptions = { model: string; apiKey: string; system: string; turns: Turn[]; tools: ToolDef[] };
export type HttpRequest = { url: string; headers: Record<string, string>; body: string };

// Shapes one provider request. The key goes only into that provider's auth header.
export function buildRequest(provider: Provider, o: RequestOptions): HttpRequest {
	if (!MODEL_RE.test(o.model)) throw new Error('The model name in settings is not valid.');
	if (!o.apiKey) throw new Error('No API key is saved for this provider.');
	const auth = KEY_HEADER[provider];
	const header = provider === 'openai' ? `Bearer ${o.apiKey}` : o.apiKey;
	const json = { 'content-type': 'application/json' };
	if (provider === 'anthropic') {
		const body = {
			model: o.model, max_tokens: 4096, system: o.system,
			messages: o.turns.map(anthropicTurn),
			...(o.tools.length ? { tools: o.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) } : {}),
		};
		return { url: 'https://api.anthropic.com/v1/messages', headers: { ...json, [auth]: header, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) };
	}
	if (provider === 'openai') {
		const body = {
			model: o.model, max_completion_tokens: 4096,
			messages: [{ role: 'system', content: o.system }, ...o.turns.flatMap(openAiTurn)],
			...(o.tools.length ? { tools: o.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}),
		};
		return { url: 'https://api.openai.com/v1/chat/completions', headers: { ...json, [auth]: header }, body: JSON.stringify(body) };
	}
	const body = {
		systemInstruction: { parts: [{ text: o.system }] },
		contents: o.turns.map(googleTurn),
		generationConfig: { maxOutputTokens: 4096 },
		...(o.tools.length ? { tools: [{ functionDeclarations: o.tools.map(t => ({ name: t.name, description: t.description, parameters: googleSchema(t.inputSchema) })) }] } : {}),
	};
	const model = encodeURIComponent(o.model);
	return { url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, headers: { ...json, [auth]: header }, body: JSON.stringify(body) };
}

function anthropicTurn(t: Turn) {
	if (t.role === 'user') return { role: 'user', content: t.text };
	if (t.role === 'assistant') return { role: 'assistant', content: [...(t.text ? [{ type: 'text', text: t.text }] : []), ...t.calls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args }))] };
	return { role: 'user', content: t.results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.text, is_error: r.isError })) };
}

function openAiTurn(t: Turn) {
	if (t.role === 'user') return [{ role: 'user', content: t.text }];
	if (t.role === 'assistant') return [{ role: 'assistant', content: t.text || null, ...(t.calls.length ? { tool_calls: t.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) }];
	return t.results.map(r => ({ role: 'tool', tool_call_id: r.id, content: r.text }));
}

function googleTurn(t: Turn) {
	if (t.role === 'user') return { role: 'user', parts: [{ text: t.text }] };
	if (t.role === 'assistant') return { role: 'model', parts: [...(t.text ? [{ text: t.text }] : []), ...t.calls.map(c => ({ functionCall: { name: c.name, args: c.args } }))] };
	return { role: 'user', parts: t.results.map(r => ({ functionResponse: { name: r.name, response: r.isError ? { error: r.text } : { result: r.text } } })) };
}

// Gemini rejects some JSON Schema keys that MCP servers commonly send.
function googleSchema(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(googleSchema);
	if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => k !== '$schema' && k !== 'additionalProperties').map(([k, x]) => [k, googleSchema(x)]));
	return v;
}

// Turns a provider JSON reply into text plus tool calls.
export function parseReply(provider: Provider, json: any): ProviderReply {
	if (provider === 'anthropic') {
		const blocks: any[] = Array.isArray(json?.content) ? json.content : [];
		return {
			text: blocks.filter(b => b?.type === 'text').map(b => String(b.text ?? '')).join('\n'),
			calls: blocks.filter(b => b?.type === 'tool_use').map(b => ({ id: String(b.id), name: String(b.name), args: asObject(b.input) })),
		};
	}
	if (provider === 'openai') {
		const msg = json?.choices?.[0]?.message ?? {};
		const calls: ToolCall[] = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).map((c: any) => ({ id: String(c.id), name: String(c.function?.name ?? ''), args: parseArgs(c.function?.arguments) }));
		return { text: typeof msg.content === 'string' ? msg.content : '', calls };
	}
	const parts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
	const calls: ToolCall[] = parts.filter(p => p?.functionCall).map((p, i) => ({ id: `call_${i}`, name: String(p.functionCall.name ?? ''), args: asObject(p.functionCall.args) }));
	return { text: parts.filter(p => typeof p?.text === 'string').map(p => p.text).join('\n'), calls };
}

function asObject(v: unknown): Record<string, unknown> {
	return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
function parseArgs(s: unknown): Record<string, unknown> {
	try { return asObject(JSON.parse(String(s ?? '{}'))); } catch { return {}; }
}

// Sends one request and returns the parsed reply. Error text never includes the key.
export async function callProvider(provider: Provider, o: RequestOptions, fetchFn: typeof fetch = fetch): Promise<ProviderReply> {
	const req = buildRequest(provider, o);
	const res = await fetchFn(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: AbortSignal.timeout(120_000) });
	const raw = await res.text();
	let json: any = undefined;
	try { json = JSON.parse(raw); } catch { /* not JSON: reported below */ }
	if (!res.ok) {
		const detail = String(json?.error?.message ?? json?.error ?? '').slice(0, 300);
		throw new Error(`${PROVIDER_LABELS[provider]} returned ${res.status}${detail ? `: ${detail}` : ''}`);
	}
	if (!json) throw new Error(`${PROVIDER_LABELS[provider]} sent a reply that is not JSON.`);
	return parseReply(provider, json);
}

export type McpServerConfig = { name: string; command?: string; args: string[]; env?: Record<string, string>; url?: string };
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// The setup line is pasted into a shell, so a quote, $ or backtick in a path could run something else. Such paths are refused.
export function mcpSetupLine(server: string, root: string): { line: string } | { error: string } {
	if (/["$`]/.test(server) || /["$`]/.test(root)) {
		return { error: 'This folder path has a quote, $ or backtick, so Codeler will not copy a setup line for it. Rename the folder or add the server by hand.' };
	}
	return { line: `claude mcp add codeler -- node "${server}" "${root}"` };
}

// Checks the codeler.mcpServers setting. Bad entries are reported and skipped; good ones are kept.
export function validateMcpServers(raw: unknown): { servers: McpServerConfig[]; errors: string[] } {
	const servers: McpServerConfig[] = [];
	const errors: string[] = [];
	if (raw === undefined || raw === null) return { servers, errors };
	if (!Array.isArray(raw)) return { servers, errors: ['codeler.mcpServers must be a list.'] };
	const seen = new Set<string>();
	raw.forEach((entry, i) => {
		const fail = (msg: string): void => { errors.push(`MCP server ${i + 1}: ${msg}`); };
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail('must be an object.');
		const e = entry as Record<string, unknown>;
		const name = e.name;
		if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(name)) return fail('name must be 1 to 40 letters, digits, "-" or "_".');
		if (seen.has(name)) return fail(`name "${name}" is used twice.`);
		if (e.url !== undefined) {
			if (e.command !== undefined) return fail('use either command or url, not both.');
			if (typeof e.url !== 'string') return fail('url must be text.');
			let u: URL;
			try { u = new URL(e.url); } catch { return fail('url is not a valid address.'); }
			if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail('url must start with http:// or https://.');
			if (u.protocol === 'http:' && !LOCAL_HOSTS.has(u.hostname)) return fail('plain http:// is allowed only for localhost. Use https:// for other servers.');
			seen.add(name); servers.push({ name, url: e.url, args: [] });
			return;
		}
		if (typeof e.command !== 'string' || !e.command.trim()) return fail('needs a command or a url.');
		if (e.args !== undefined && (!Array.isArray(e.args) || !e.args.every(a => typeof a === 'string'))) return fail('args must be a list of text.');
		if (e.env !== undefined && (!e.env || typeof e.env !== 'object' || Array.isArray(e.env) || !Object.values(e.env).every(v => typeof v === 'string'))) return fail('env must map names to text.');
		seen.add(name);
		servers.push({ name, command: e.command, args: (e.args as string[] | undefined) ?? [], ...(e.env ? { env: e.env as Record<string, string> } : {}) });
	});
	return { servers, errors };
}

// Tool names sent to providers must be short and plain.
export function toolName(server: string, tool: string): string {
	return `${server}__${tool}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

// Keeps tool output small enough to send back to the model.
export function capText(s: string, max = 20000): string {
	return s.length > max ? s.slice(0, max) + '\n[cut short]' : s;
}
