import * as vscode from 'vscode';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { callProvider, capText, DEFAULT_MODELS, McpServerConfig, parseEditBlocks, PROVIDER_LABELS, PROVIDERS, Provider, ProposedEdit, SYSTEM_PROMPT, toolName, ToolCall, ToolDef, ToolResult, Turn, validateMcpServers } from './logic';

const EDIT_SCHEME = 'codeler-ai-edit';
const MAX_TOOL_ROUNDS = 8;
const MAX_FILE_CHARS = 200_000;
const KEY_PREFIX = 'codeler.ai.key.';
const PROVIDER_KEY = 'codeler.ai.provider';
const MCP_WARNED_KEY = 'codeler.ai.mcpWarned';

type ShownEdit = { id: number; path: string; error?: string; state: 'open' | 'applied' | 'discarded' };
type ShownItem = { kind: 'user' | 'assistant' | 'note' | 'error'; text: string; edits?: ShownEdit[] };
type Route = { server: string; tool: string; client: Client };

class AiView implements vscode.WebviewViewProvider, vscode.TextDocumentContentProvider {
	private view?: vscode.WebviewView;
	private turns: Turn[] = [];
	private shown: ShownItem[] = [];
	private pending = new Map<number, { path: string; content: string }>();
	private nextId = 1;
	private busy = false;
	private clients = new Map<string, Client>();

	constructor(private ctx: vscode.ExtensionContext, private root: string | undefined) { }

	resolveWebviewView(view: vscode.WebviewView) {
		this.view = view;
		const media = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');
		const webview = view.webview;
		webview.options = { enableScripts: true, localResourceRoots: [media] };
		const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
		vscode.workspace.fs.readFile(vscode.Uri.joinPath(media, 'ai.html')).then(bytes => {
			webview.html = new TextDecoder().decode(bytes)
				.replaceAll('{{csp}}', `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';`)
				.replaceAll('{{nonce}}', nonce)
				.replaceAll('{{css}}', webview.asWebviewUri(vscode.Uri.joinPath(media, 'codeler.css')).toString());
		});
		webview.onDidReceiveMessage(m => void this.onMessage(m));
		view.onDidDispose(() => { this.view = undefined; });
	}

	private async onMessage(m: any) {
		switch (m?.type) {
			case 'ready': await this.postState(); return this.post({ type: 'replay', items: this.shown });
			case 'provider': if (PROVIDERS.includes(m.id)) { await this.ctx.globalState.update(PROVIDER_KEY, m.id); return this.postState(); } return;
			case 'setKey': return this.setKey();
			case 'removeKey': return this.removeKey();
			case 'send': return this.send(String(m.text ?? ''), m.includeFile === true, m.useTools === true);
			case 'review': return this.review(Number(m.id));
			case 'apply': return this.apply(Number(m.id));
			case 'discard': return this.discard(Number(m.id));
			case 'manageMcp': return vscode.commands.executeCommand('codeler.ai.manageMcp');
		}
	}

	private provider(): Provider {
		const saved = this.ctx.globalState.get<string>(PROVIDER_KEY);
		return PROVIDERS.find(p => p === saved) ?? 'anthropic';
	}

	private models(): Record<Provider, string> {
		const cfg = vscode.workspace.getConfiguration('codeler').get<Record<string, unknown>>('ai.models', {});
		const pick = (p: Provider) => typeof cfg[p] === 'string' && cfg[p] ? cfg[p] as string : DEFAULT_MODELS[p];
		return { anthropic: pick('anthropic'), openai: pick('openai'), google: pick('google') };
	}

	private async postState() {
		const provider = this.provider();
		const models = this.models();
		const providers = await Promise.all(PROVIDERS.map(async id => ({ id, label: PROVIDER_LABELS[id], model: models[id], hasKey: !!(await this.ctx.secrets.get(KEY_PREFIX + id)) })));
		this.post({ type: 'state', provider, providers });
	}

	private async setKey() {
		const p = this.provider();
		const entered = await vscode.window.showInputBox({ prompt: `Paste your ${PROVIDER_LABELS[p]} API key`, password: true, ignoreFocusOut: true, placeHolder: 'Saved in secure storage on this computer only' });
		const key = entered?.trim();
		if (!key) return;
		if (/\s/.test(key)) return vscode.window.showWarningMessage('That does not look like an API key.').then(() => undefined);
		await this.ctx.secrets.store(KEY_PREFIX + p, key);
		await this.postState();
	}

	private async removeKey() {
		const p = this.provider();
		await this.ctx.secrets.delete(KEY_PREFIX + p);
		await this.postState();
		void vscode.window.showInformationMessage(`${PROVIDER_LABELS[p]} key removed.`);
	}

	private show(item: ShownItem) {
		this.shown.push(item);
		this.post({ type: 'append', item });
	}

	private post(m: unknown) {
		void this.view?.webview.postMessage(m);
	}

	private relative(uri: vscode.Uri): string | undefined {
		if (!this.root) return undefined;
		const rel = path.relative(this.root, uri.fsPath);
		return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : undefined;
	}

	private inside(rel: string): boolean {
		if (!this.root) return false;
		const abs = path.resolve(this.root, rel);
		return abs.startsWith(this.root + path.sep);
	}

	private fileContext(): string {
		const ed = vscode.window.activeTextEditor;
		if (!ed) return '';
		const name = this.relative(ed.document.uri) ?? path.basename(ed.document.uri.fsPath);
		const body = ed.document.getText().slice(0, MAX_FILE_CHARS);
		return `Current file: ${name}\n\`\`\`\`\n${body}\n\`\`\`\`\n\n`;
	}

	private async send(text: string, includeFile: boolean, useTools: boolean) {
		text = text.trim();
		if (!text || this.busy) return;
		const provider = this.provider();
		const apiKey = await this.ctx.secrets.get(KEY_PREFIX + provider);
		if (!apiKey) return this.show({ kind: 'error', text: `Add a ${PROVIDER_LABELS[provider]} key first.` });

		this.busy = true;
		this.post({ type: 'busy', on: true });
		const start = this.turns.length;
		try {
			this.turns.push({ role: 'user', text: (includeFile ? this.fileContext() : '') + text });
			this.show({ kind: 'user', text });
			const tools = useTools ? await this.connectTools() : { defs: [] as ToolDef[], routes: new Map<string, Route>() };
			for (let round = 0; ; round++) {
				const reply = await callProvider(provider, { model: this.models()[provider], apiKey, system: SYSTEM_PROMPT, turns: this.turns, tools: tools.defs });
				this.turns.push({ role: 'assistant', text: reply.text, calls: reply.calls });
				const { prose, edits } = parseEditBlocks(reply.text);
				this.show({ kind: 'assistant', text: prose, edits: edits.map(e => this.proposeEdit(e)) });
				if (!reply.calls.length) break;
				const limited = round >= MAX_TOOL_ROUNDS;
				const results: ToolResult[] = [];
				for (const call of reply.calls) results.push(limited ? { id: call.id, name: call.name, text: 'Tool call limit reached.', isError: true } : await this.runTool(call, tools.routes));
				this.turns.push({ role: 'tool', results });
				if (limited) break;
			}
		} catch (e) {
			// roll back so the next send does not follow a half-finished tool exchange
			this.turns.length = start;
			this.show({ kind: 'error', text: (e as Error).message });
		} finally {
			this.busy = false;
			this.post({ type: 'busy', on: false });
		}
	}

	private proposeEdit(e: ProposedEdit): ShownEdit {
		const id = this.nextId++;
		let error = e.error;
		if (!error && !this.root) error = 'Open a folder first.';
		if (!error && !this.inside(e.path)) error = 'The path is outside the workspace.';
		if (!error) this.pending.set(id, { path: e.path, content: e.content });
		return { id, path: e.path, error, state: 'open' };
	}

	private setEditState(id: number, state: ShownEdit['state']) {
		for (const item of this.shown) for (const e of item.edits ?? []) if (e.id === id) e.state = state;
		this.post({ type: 'editState', id, state });
	}

	private editUri(id: number, rel: string, side: 'before' | 'after') {
		return vscode.Uri.from({ scheme: EDIT_SCHEME, path: '/' + rel.split(/[\\/]/).join('/'), query: `id=${id}&side=${side}` });
	}

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const q = new URLSearchParams(uri.query);
		const p = this.pending.get(Number(q.get('id')));
		if (!p) return '';
		if (q.get('side') === 'after') return p.content;
		if (!this.root) return '';
		try {
			return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(this.root, p.path))));
		} catch {
			return ''; // a new file has no "before" side
		}
	}

	private async review(id: number) {
		const p = this.pending.get(id);
		if (!p) return;
		await vscode.commands.executeCommand('vscode.diff', this.editUri(id, p.path, 'before'), this.editUri(id, p.path, 'after'), `${p.path} (proposed by AI)`);
	}

	private async apply(id: number) {
		const p = this.pending.get(id);
		if (!p || !this.root || !this.inside(p.path)) return;
		const target = vscode.Uri.file(path.resolve(this.root, p.path));
		if (vscode.workspace.textDocuments.some(d => d.isDirty && d.uri.toString() === target.toString())) {
			return vscode.window.showWarningMessage(`Save or discard your changes to ${p.path} first.`).then(() => undefined);
		}
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
		await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(p.content));
		this.pending.delete(id);
		this.setEditState(id, 'applied');
	}

	private discard(id: number) {
		if (!this.pending.delete(id)) return;
		this.setEditState(id, 'discarded');
	}

	private async connectTools(): Promise<{ defs: ToolDef[]; routes: Map<string, Route> }> {
		const defs: ToolDef[] = [];
		const routes = new Map<string, Route>();
		const { servers, errors } = validateMcpServers(vscode.workspace.getConfiguration('codeler').get<unknown>('mcpServers', []));
		for (const err of errors) this.show({ kind: 'error', text: err });
		if (!servers.length) {
			this.show({ kind: 'note', text: 'No MCP servers are set up. Use Manage MCP servers to add one.' });
			return { defs, routes };
		}
		if (!this.ctx.globalState.get<boolean>(MCP_WARNED_KEY)) {
			await this.ctx.globalState.update(MCP_WARNED_KEY, true);
			await vscode.window.showWarningMessage('MCP servers run programs on this computer. Only add servers you trust.', 'OK');
		}
		for (const s of servers) {
			let client = this.clients.get(s.name);
			if (!client) {
				try {
					client = await this.connect(s);
					this.clients.set(s.name, client);
				} catch {
					this.show({ kind: 'error', text: `Could not start MCP server "${s.name}".` });
					continue;
				}
			}
			try {
				const { tools } = await client.listTools();
				for (const t of tools) {
					const name = toolName(s.name, t.name);
					defs.push({ name, description: t.description ?? '', inputSchema: t.inputSchema as Record<string, unknown> });
					routes.set(name, { server: s.name, tool: t.name, client });
				}
			} catch {
				this.show({ kind: 'error', text: `Could not list tools from "${s.name}".` });
			}
		}
		return { defs, routes };
	}

	// Env values can hold secrets, so they are passed to the child process only and never shown.
	private async connect(s: McpServerConfig): Promise<Client> {
		const client = new Client({ name: 'codeler', version: '0.1.0' });
		const transport = s.url
			? new StreamableHTTPClientTransport(new URL(s.url))
			: new StdioClientTransport({ command: s.command ?? '', args: s.args, env: { ...getDefaultEnvironment(), ...(s.env ?? {}) }, stderr: 'ignore' });
		await client.connect(transport);
		return client;
	}

	private async runTool(call: ToolCall, routes: Map<string, Route>): Promise<ToolResult> {
		const route = routes.get(call.name);
		const fail = (text: string): ToolResult => ({ id: call.id, name: call.name, text, isError: true });
		if (!route) return fail('Unknown tool.');
		const args = capText(JSON.stringify(call.args, null, 2), 2000);
		const answer = await vscode.window.showWarningMessage(`Allow "${route.server}" to run "${route.tool}"?`, { modal: true, detail: `Server: ${route.server}\nTool: ${route.tool}\n\nArguments:\n${args}` }, 'Allow');
		if (answer !== 'Allow') return fail('The user did not allow this tool call.');
		try {
			const res = await route.client.callTool({ name: route.tool, arguments: call.args });
			const content = Array.isArray(res.content) ? res.content : [];
			const text = content.map(c => c.type === 'text' ? String(c.text) : `[${c.type}]`).join('\n');
			this.show({ kind: 'note', text: `Ran ${route.tool} on ${route.server}.` });
			return { id: call.id, name: call.name, text: capText(text), isError: res.isError === true };
		} catch (e) {
			return fail(capText(`The tool failed: ${(e as Error).message}`));
		}
	}

	async closeClients() {
		const open = [...this.clients.values()];
		this.clients.clear();
		await Promise.all(open.map(c => c.close().catch(() => undefined)));
	}
}

export function startAi(ctx: vscode.ExtensionContext): vscode.Disposable {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	const view = new AiView(ctx, root);
	return vscode.Disposable.from(
		vscode.window.registerWebviewViewProvider('codeler.ai', view, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.workspace.registerTextDocumentContentProvider(EDIT_SCHEME, view),
		vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('codeler.mcpServers')) void view.closeClients(); }),
		vscode.commands.registerCommand('codeler.ai.manageMcp', () => vscode.commands.executeCommand('workbench.action.openSettings', 'codeler.mcpServers')),
		vscode.commands.registerCommand('codeler.mcp.start', async () => {
			if (!root) return vscode.window.showWarningMessage('Open a folder first.').then(() => undefined);
			const server = path.join(ctx.extensionPath, 'mcp', 'server.js');
			await vscode.env.clipboard.writeText(`claude mcp add codeler -- node "${server}" "${root}"`);
			void vscode.window.showInformationMessage('Copied the Codeler MCP setup line. Paste it into a terminal to add the server to Claude Code. For Codex, use codex mcp add with the same arguments.');
		}),
		{ dispose: () => void view.closeClients() },
	);
}
