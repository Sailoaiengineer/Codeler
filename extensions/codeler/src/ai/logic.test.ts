import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, callProvider, checkRelativePath, mcpSetupLine, parseEditBlocks, parseReply, toolName, validateMcpServers, windowsLaunch, type Turn } from './logic.ts';

const turns: Turn[] = [{ role: 'user', text: 'hi' }];
const KEY = 'sk-test-KEY-123';
const base = { model: 'm-1', apiKey: KEY, system: 'sys', turns, tools: [] };

test('edit blocks are parsed and prose is kept', () => {
	const text = 'Here you go.\n```ts path=src/a.ts\nconst a = 1;\n```\nDone.\n```js\nconsole.log(1)\n```';
	const { prose, edits } = parseEditBlocks(text);
	assert.deepEqual(edits, [{ path: 'src/a.ts', content: 'const a = 1;\n', error: undefined }]);
	assert.match(prose, /Here you go\./);
	assert.match(prose, /console\.log\(1\)/);
	assert.doesNotMatch(prose, /const a = 1/);
});

test('an unclosed edit block is rejected, not written', () => {
	const { edits } = parseEditBlocks('```ts path=src/a.ts\nconst a = 1;');
	assert.equal(edits.length, 1);
	assert.match(edits[0].error ?? '', /cut off/);
});

test('a longer closing fence still closes the block', () => {
	const { edits } = parseEditBlocks('````md path=notes.md\n```\ninside\n```\n````');
	assert.equal(edits[0].path, 'notes.md');
	assert.equal(edits[0].content, '```\ninside\n```\n');
});

test('paths outside the workspace or with .. are rejected', () => {
	for (const p of ['../secret.txt', 'src/../../x', '/etc/passwd', '\\\\server\\share\\a', 'C:/Windows/x', 'C:\\x', 'a\0b', '']) {
		assert.ok(checkRelativePath(p), `expected rejection for ${JSON.stringify(p)}`);
	}
	assert.equal(checkRelativePath('src/deep/file.ts'), undefined);
	for (const p of ['.git/config', 'src/.git/HEAD', '.codeler/history/x', 'pkg/.CODELER/y', '.vscode/tasks.json', '.github/workflows/a.yml', '.husky/pre-commit']) {
		assert.ok(checkRelativePath(p), `expected rejection for ${p}`);
	}
	assert.equal(checkRelativePath('src/.gitignore'), undefined);
	const { edits } = parseEditBlocks('```ts path=../outside.ts\nx\n```');
	assert.ok(edits[0].error);
});

test('anthropic request shape and key only in x-api-key', () => {
	const r = buildRequest('anthropic', { ...base, tools: [{ name: 't', description: 'd', inputSchema: { type: 'object' } }] });
	assert.equal(r.url, 'https://api.anthropic.com/v1/messages');
	assert.equal(r.headers['x-api-key'], KEY);
	assert.equal(r.headers['anthropic-version'], '2023-06-01');
	const body = JSON.parse(r.body);
	assert.equal(body.model, 'm-1');
	assert.equal(body.system, 'sys');
	assert.deepEqual(body.tools, [{ name: 't', description: 'd', input_schema: { type: 'object' } }]);
	assert.doesNotMatch(r.body + r.url, new RegExp(KEY));
});

test('openai request shape and key only in Authorization', () => {
	const r = buildRequest('openai', base);
	assert.equal(r.url, 'https://api.openai.com/v1/chat/completions');
	assert.equal(r.headers.authorization, `Bearer ${KEY}`);
	assert.deepEqual(JSON.parse(r.body).messages[0], { role: 'system', content: 'sys' });
	assert.doesNotMatch(r.body + r.url, new RegExp(KEY));
});

test('google request shape and key only in x-goog-api-key', () => {
	const r = buildRequest('google', { ...base, tools: [{ name: 't', description: 'd', inputSchema: { type: 'object', additionalProperties: false, $schema: 'x' } }] });
	assert.equal(r.url, 'https://generativelanguage.googleapis.com/v1beta/models/m-1:generateContent');
	assert.equal(r.headers['x-goog-api-key'], KEY);
	const body = JSON.parse(r.body);
	assert.deepEqual(body.tools[0].functionDeclarations[0].parameters, { type: 'object' });
	assert.doesNotMatch(r.body + r.url, new RegExp(KEY));
});

test('invalid model names and missing keys are refused before any request', () => {
	assert.throws(() => buildRequest('openai', { ...base, model: '../evil' }), /model name/);
	assert.throws(() => buildRequest('openai', { ...base, apiKey: '' }), /No API key/);
});

test('callProvider sends the mocked request and parses tool calls', async () => {
	const seen: { url: string; init: RequestInit }[] = [];
	const fake = (async (url: string, init: RequestInit) => {
		seen.push({ url: String(url), init });
		return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'u1', name: 'read', input: { path: 'a' } }] }), { status: 200 });
	}) as unknown as typeof fetch;
	const reply = await callProvider('anthropic', base, fake);
	assert.equal(seen.length, 1);
	assert.equal((seen[0].init.headers as Record<string, string>)['x-api-key'], KEY);
	assert.equal(reply.text, 'ok');
	assert.deepEqual(reply.calls, [{ id: 'u1', name: 'read', args: { path: 'a' } }]);
});

test('callProvider reports provider errors without the key', async () => {
	const fake = (async () => new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 })) as unknown as typeof fetch;
	await assert.rejects(callProvider('openai', base, fake), (e: Error) => /400: bad request/.test(e.message) && !e.message.includes(KEY));
});

test('provider replies parse text and tool calls', () => {
	assert.deepEqual(parseReply('openai', { choices: [{ message: { content: 'hi', tool_calls: [{ id: 'c1', function: { name: 'x', arguments: '{"a":1}' } }] } }] }), { text: 'hi', calls: [{ id: 'c1', name: 'x', args: { a: 1 } }] });
	assert.deepEqual(parseReply('google', { candidates: [{ content: { parts: [{ text: 'yo' }, { functionCall: { name: 'g', args: { b: 2 } } }] } }] }), { text: 'yo', calls: [{ id: 'call_0', name: 'g', args: { b: 2 } }] });
});

test('MCP config: valid stdio and http entries are kept', () => {
	const { servers, errors } = validateMcpServers([
		{ name: 'files', command: 'node', args: ['s.js'], env: { A: 'b' } },
		{ name: 'remote', url: 'https://example.com/mcp' },
	]);
	assert.deepEqual(errors, []);
	assert.deepEqual(servers, [
		{ name: 'files', command: 'node', args: ['s.js'], env: { A: 'b' } },
		{ name: 'remote', url: 'https://example.com/mcp', args: [] },
	]);
});

test('MCP config: bad entries are reported and skipped', () => {
	const { servers, errors } = validateMcpServers([
		{ name: 'bad name!', command: 'x' },
		{ name: 'nocmd' },
		{ name: 'both', command: 'x', url: 'https://a.b' },
		{ name: 'ftp', url: 'ftp://a.b' },
		{ name: 'args', command: 'x', args: [1] },
		{ name: 'env', command: 'x', env: { A: 1 } },
		{ name: 'dup', command: 'x' },
		{ name: 'dup', command: 'y' },
	]);
	assert.equal(servers.length, 1);
	assert.equal(servers[0].name, 'dup');
	assert.equal(errors.length, 7);
	assert.match(errors.join('\n'), /used twice/);
});

test('MCP config: plain http is allowed only for local addresses', () => {
	for (const url of ['http://localhost:8787/mcp', 'http://127.0.0.1:8787/mcp', 'http://[::1]:8787/mcp']) {
		assert.deepEqual(validateMcpServers([{ name: 'local', url }]).errors, [], url);
	}
	for (const url of ['http://example.com/mcp', 'http://localhost.evil.example/mcp', 'http://192.168.1.5/mcp']) {
		assert.equal(validateMcpServers([{ name: 'remote', url }]).servers.length, 0, url);
		assert.equal(validateMcpServers([{ name: 'remote', url }]).errors.length, 1, url);
	}
	assert.equal(validateMcpServers([{ name: 'remote', url: 'https://example.com/mcp' }]).servers.length, 1);
});

test('MCP setup line quotes paths and refuses unsafe characters', () => {
	assert.deepEqual(mcpSetupLine('C:\\ext\\server.js', 'C:\\Users\\me\\my project'), { line: 'claude mcp add codeler -- node "C:\\ext\\server.js" "C:\\Users\\me\\my project"' });
	for (const bad of ['C:\\a"b', 'C:\\a$b', 'C:\\a`b']) {
		assert.ok('error' in mcpSetupLine('C:\\ext\\server.js', bad), `expected refusal for ${bad}`);
		assert.ok('error' in mcpSetupLine(bad, 'C:\\ok'), `expected refusal for ${bad} as server path`);
	}
});

test('MCP config: a non-list value is an error', () => {
	assert.deepEqual(validateMcpServers({}).errors, ['codeler.mcpServers must be a list.']);
	assert.deepEqual(validateMcpServers(undefined), { servers: [], errors: [] });
});

test('tool names are short and plain', () => {
	assert.equal(toolName('my server', 'list.files'), 'my_server__list_files');
	assert.equal(toolName('s', 'x'.repeat(100)).length, 64);
});

test('Windows MCP commands run through cmd.exe only when every part is plain text', () => {
	assert.deepEqual(windowsLaunch('npx', ['-y', '@scope/pkg@1.2.3'], 'win32'), { command: 'cmd.exe', args: ['/d', '/s', '/c', 'npx', '-y', '@scope/pkg@1.2.3'] });
	assert.deepEqual(windowsLaunch('C:\tools\server.exe', ['a'], 'win32'), { command: 'C:\tools\server.exe', args: ['a'] });
	assert.deepEqual(windowsLaunch('npx', ['x'], 'linux'), { command: 'npx', args: ['x'] });
	for (const args of [['a&calc'], ['a b'], ['$(x)'], ['"q"'], ['a|b']]) {
		assert.ok('error' in windowsLaunch('npx', args, 'win32'), `expected refusal for ${JSON.stringify(args)}`);
	}
	assert.ok('error' in windowsLaunch('npx & calc', [], 'win32'));
});
