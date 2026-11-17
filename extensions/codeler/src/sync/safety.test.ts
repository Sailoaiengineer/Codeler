import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isIgnored, isSafeRelativePath, safePath } from './safety.ts';
import { textDiff } from './logic.ts';

// Shared rule cases. The same lists run in web/convex/projectPath.test.ts and extensions/codeler/mcp/server.test.js.
const REFUSED = ['../x', '/x', '\\x', 'C:\\x', 'C:x', 'a\0b', 'a\u0001b', 'a/../b', '.. ', '..\u0020', 'a/.. /b', 'a/b.', 'a/b ', 'x:stream', 'CON', 'con.txt', 'a/NUL.tar.gz', 'LPT1', 'a/com9.log', '.GIT/hooks/x', 'Node_Modules/x', '.Codeler/x', 'DIST/a.js', 'a//b', '', '\\\\server\\share\\x', 'x'.repeat(501)];
const ACCEPTED = ['src/app.ts', '.vscode/settings.json', '.github/workflows/a.yml', 'src/CONSOLE.md', 'a/b.c', 'src/.gitignore'];

test('rejects traversal, absolute, drive, nul and Windows-trimmed paths', () => {
	for (const value of REFUSED) assert.equal(isSafeRelativePath(value), false, JSON.stringify(value));
});
test('accepts normal project paths, including team config folders', () => {
	for (const value of ACCEPTED) assert.equal(isSafeRelativePath(value), true, value);
});
test('ignores generated, dependency and oversized files', () => {
	for (const value of ['node_modules/a.js', '.git/index', '.codeler/x', 'dist/a.js', 'out/a.js', '.next/a.js']) assert.equal(isIgnored(value), true);
	assert.equal(isIgnored('src/a.ts', 2 * 1024 * 1024 + 1), true);
});
test('safePath refuses a ".. " segment instead of resolving it', () => {
	const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codeler-safe-')), 'proj');
	fs.mkdirSync(root);
	assert.equal(safePath(root, 'a/.. /x.txt'), undefined);
	assert.notEqual(safePath(root, 'src/app.ts'), undefined);
});
test('disk diff is a minimal edit', () => assert.deepEqual(textDiff('hello world', 'hello brave world'), { index: 6, deleteCount: 0, insert: 'brave ' }));
