#!/usr/bin/env node
// Codeler MCP server: list, read and write files inside one workspace folder over stdio.
// Usage: node server.js <workspace folder>   (stdout is the protocol; log to stderr only)
// Exports the path rule for tests; the server only starts when this file is run directly.
'use strict';
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || process.cwd());
const MAX_LIST = 2000;
const MAX_READ = 1024 * 1024;

// Shared project path rule. The same rule lives in extensions/codeler/src/sync/safety.ts and web/convex/projectPath.ts: keep all three identical.
const BLOCKED = new Set(['node_modules', '.git', '.codeler', 'dist', 'out', '.next']);
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/;
function isSafeRelativePath(file) {
	if (typeof file !== 'string' || file.length === 0 || file.length > 500 || /[\u0000-\u001f\u007f]/.test(file)) return false;
	if (file.startsWith('/') || file.startsWith('\\') || /^[A-Za-z]:/.test(file)) return false;
	return file.replaceAll('\\', '/').split('/').every(seg => {
		if (!seg || seg === '.' || seg === '..' || /[. ]$/.test(seg) || seg.includes(':')) return false;
		if (RESERVED.test(seg.split('.')[0].trim().toUpperCase())) return false;
		return !BLOCKED.has(seg.toLowerCase());
	});
}

// Returns the absolute path for a workspace-relative path, or throws.
function resolveInside(p, base = root) {
	if (!isSafeRelativePath(p)) throw new Error('Path is not allowed. Use a relative path without "..", drive letters, reserved names or .git/.codeler/node_modules folders.');
	const abs = path.resolve(base, p);
	if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('Path is outside the workspace.');
	return abs;
}

// Symlinks could point outside the folder, so the nearest existing ancestor must resolve inside it too.
function assertRealInside(abs, base = root) {
	const realRoot = fsSync.realpathSync.native(base);
	let probe = abs;
	for (;;) {
		try {
			const real = fsSync.realpathSync.native(probe);
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
		const abs = path.join(dir, ent.name);
		const rel = path.relative(root, abs).split(path.sep).join('/');
		if (!isSafeRelativePath(rel)) continue;
		if (ent.isDirectory()) await walk(abs, out);
		else if (ent.isFile()) out.push(rel);
	}
}

async function run(name, args) {
	if (name === 'list_files') {
		const start = args.dir ? resolveInside(args.dir) : root;
		if (args.dir) assertRealInside(start);
		const files = [];
		await walk(start, files);
		return files.length ? files.join('\n') + (files.length >= MAX_LIST ? `\n[stopped at ${MAX_LIST} files]` : '') : 'No files found.';
	}
	if (name === 'read_file') {
		const abs = resolveInside(args.path);
		assertRealInside(abs);
		const stat = await fs.stat(abs);
		if (!stat.isFile()) throw new Error('Not a file.');
		if (stat.size > MAX_READ) throw new Error('File is larger than 1 MB.');
		return fs.readFile(abs, 'utf8');
	}
	if (name === 'write_file') {
		if (typeof args.content !== 'string') throw new Error('content must be text.');
		const abs = resolveInside(args.path);
		assertRealInside(abs);
		await fs.mkdir(path.dirname(abs), { recursive: true });
		await fs.writeFile(abs, args.content, 'utf8');
		return `Wrote ${Buffer.byteLength(args.content, 'utf8')} bytes to ${path.relative(root, abs).split(path.sep).join('/')}.`;
	}
	throw new Error(`Unknown tool: ${name}`);
}

function startServer() {
	const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
	const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
	const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
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
}

if (require.main === module) startServer();
module.exports = { isSafeRelativePath, resolveInside, assertRealInside };
