import test from 'node:test';
import assert from 'node:assert/strict';
import { isIgnored, isSafeRelativePath, textDiff } from './safety.ts';

test('rejects traversal, absolute, drive and nul paths', () => {
	for (const value of ['../x', '/x', '\\x', 'C:\\x', 'a\0b', 'a/../b']) assert.equal(isSafeRelativePath(value), false);
	assert.equal(isSafeRelativePath('src/main.ts'), true);
});
test('ignores generated, dependency and oversized files', () => {
	for (const value of ['node_modules/a.js', '.git/index', '.codeler/x', 'dist/a.js', 'out/a.js', '.next/a.js']) assert.equal(isIgnored(value), true);
	assert.equal(isIgnored('src/a.ts', 2 * 1024 * 1024 + 1), true);
});
test('disk diff is a minimal edit', () => assert.deepEqual(textDiff('hello world', 'hello brave world'), { index: 6, deleteCount: 0, insert: 'brave ' }));
