#!/usr/bin/env node
// Codeler MCP server: list, read and write files inside one workspace folder over stdio.
// Usage: node server.js <workspace folder>   (stdout is the protocol; log to stderr only)
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const root = path.resolve(process.argv[2] || process.cwd());
const SKIP = new Set(['node_modules', '.git', '.codeler']);
const MAX_LIST = 2000;
const MAX_READ = 1024 * 1024;

// Returns the absolute path for a workspace-relative path, or throws.
function resolveInside(p) {
	if (typeof p !== 'string' || !p || p.includes('\0')) throw new Error('Invalid path.');
	if (path.isAbsolute(p) || /^[A-Za-z]:/.test(p) || /^[\\/]/.test(p)) throw new Error('Path must be relative to the workspace.');
	const parts = p.split(/[\\/]+/);
	if (parts.includes('..')) throw new Error('Path must not contain "..".');
	if (parts.some(s => SKIP.has(s))) throw new Error('That folder is not available.');
	const abs = path.resolve(root, p);
	if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Path is outside the workspace.');
	return abs;
}

// Symlinks could point outside the folder, so the nearest existing ancestor must resolve inside it too.
async function assertRealInside(abs) {
	const realRoot = await fs.realpath(root);
	let probe = abs;
	for (;;) {
		try {
			const real = await fs.realpath(probe);
			if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error('Path is outside the workspace.');
			return;
		} catch (e) {
			if (e.message === 'Path is outside the workspace.') throw e;
			const up = path.dirname(probe);
			if (up === probe) throw e;
			probe = up;
		}
	}
}

async function walk(dir, out) {
	for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
		if (out.length >= MAX_LIST) return;
		if (SKIP.has(ent.name)) continue;
		const abs = path.join(dir, ent.name);
		if (ent.isDirectory()) await walk(abs, out);
		else if (ent.isFile()) out.push(path.relative(root, abs).split(path.sep).join('/'));
	}
}

async function run(name, args) {
	if (name === 'list_files') {
		const start = args.dir ? resolveInside(args.dir) : root;
		if (args.dir) await assertRealInside(start);
		const files = [];
		await walk(start, files);
		return files.length ? files.join('\n') + (files.length >= MAX_LIST ? `\n[stopped at ${MAX_LIST} files]` : '') : 'No files found.';
	}
	if (name === 'read_file') {
		const abs = resolveInside(args.path);
		await assertRealInside(abs);
		const stat = await fs.stat(abs);
		if (!stat.isFile()) throw new Error('Not a file.');
		if (stat.size > MAX_READ) throw new Error('File is larger than 1 MB.');
		return fs.readFile(abs, 'utf8');
	}
	if (name === 'write_file') {
		if (typeof args.content !== 'string') throw new Error('content must be text.');
		const abs = resolveInside(args.path);
		await assertRealInside(abs);
		await fs.mkdir(path.dirname(abs), { recursive: true });
		await fs.writeFile(abs, args.content, 'utf8');
		return `Wrote ${Buffer.byteLength(args.content, 'utf8')} bytes to ${path.relative(root, abs).split(path.sep).join('/')}.`;
	}
	throw new Error(`Unknown tool: ${name}`);
}

const TOOLS = [
	{ name: 'list_files', description: 'List files in the workspace folder. Optionally limit to a folder inside it.', inputSchema: { type: 'object', properties: { dir: { type: 'string', description: 'Folder inside the workspace (optional).' } }, additionalProperties: false } },
	{ name: 'read_file', description: 'Read a text file inside the workspace folder.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Path relative to the workspace folder.' } }, required: ['path'], additionalProperties: false } },
	{ name: 'write_file', description: 'Write a text file inside the workspace folder. Creates folders as needed.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Path relative to the workspace folder.' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } },
];

const server = new Server({ name: 'codeler', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async req => {
	try {
		const text = await run(req.params.name, req.params.arguments ?? {});
		return { content: [{ type: 'text', text }] };
	} catch (e) {
		return { content: [{ type: 'text', text: String(e.message ?? e) }], isError: true };
	}
});
server.connect(new StdioServerTransport()).catch(e => { process.stderr.write(`codeler mcp: ${e.message}\n`); process.exit(1); });
