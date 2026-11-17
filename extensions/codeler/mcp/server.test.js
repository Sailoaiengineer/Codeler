// Run with: node --test mcp/server.test.js. Same path cases as src/sync/safety.test.ts.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isSafeRelativePath, resolveInside } = require('./server.js');

const REFUSED = ['../x', '/x', '\\x', 'C:\\x', 'C:x', 'a\0b', 'a\u0001b', 'a/../b', '.. ', '..\u0020', 'a/.. /b', 'a/b.', 'a/b ', 'x:stream', 'CON', 'con.txt', 'a/NUL.tar.gz', 'LPT1', 'a/com9.log', '.GIT/hooks/x', 'Node_Modules/x', '.Codeler/x', 'DIST/a.js', 'a//b', '', '\\\\server\\share\\x', 'x'.repeat(501)];
const ACCEPTED = ['src/app.ts', '.vscode/settings.json', '.github/workflows/a.yml', 'src/CONSOLE.md', 'a/b.c', 'src/.gitignore'];

test('path rule refuses the same cases as the extension', () => {
	for (const value of REFUSED) assert.equal(isSafeRelativePath(value), false, JSON.stringify(value));
	for (const value of ACCEPTED) assert.equal(isSafeRelativePath(value), true, value);
});

test('resolveInside throws for refused paths and returns inside paths', () => {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'codeler-mcp-'));
	for (const value of REFUSED) assert.throws(() => resolveInside(value, base), undefined, JSON.stringify(value));
	assert.equal(resolveInside('src/app.ts', base), path.join(base, 'src', 'app.ts'));
});
