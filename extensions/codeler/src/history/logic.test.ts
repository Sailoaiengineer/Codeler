import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { diff, isSafePath, isTracked, listSnapshots, newId, planRestore, readBlob, restoreSnapshot, saveSnapshot, scan, currentFiles } from './logic.ts';

async function project(files: Record<string, string | Uint8Array>) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeler-history-'));
	for (const [rel, data] of Object.entries(files)) {
		await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
		await fs.writeFile(path.join(root, rel), data);
	}
	return root;
}
const read = (root: string, rel: string) => fs.readFile(path.join(root, rel), 'utf8');
const exists = (root: string, rel: string) => fs.access(path.join(root, rel)).then(() => true, () => false);

test('unsafe and ignored paths are rejected', () => {
	for (const bad of ['../x', 'a/../b', '/etc/passwd', 'C:/x', 'a\\b', '', 'a//b', './a']) { assert.equal(isSafePath(bad), false, bad); }
	assert.equal(isSafePath('src/a.ts'), true);
	for (const ignored of ['node_modules/x.js', 'a/.git/HEAD', '.codeler/history/x', 'pkg/dist/a.js', 'out/a', 'web/.next/a']) { assert.equal(isTracked(ignored), false, ignored); }
	assert.throws(() => planRestore({ '../evil.txt': 'a'.repeat(64) }, {}), /isn't allowed/);
	assert.throws(() => planRestore({ 'node_modules/x.js': 'a'.repeat(64) }, {}), /isn't allowed/);
});

test('scan skips ignored folders, binary files and files over 2 MB', async () => {
	const root = await project({
		'a.txt': 'hello', 'src/b.ts': 'code', 'node_modules/m.js': 'x', 'deep/dist/d.js': 'x',
		'img.bin': Uint8Array.from([1, 0, 2]), 'big.txt': 'x'.repeat(2 * 1024 * 1024 + 1),
	});
	assert.deepEqual([...(await scan(root)).keys()].sort(), ['a.txt', 'src/b.ts']);
});

test('ids sort by time even within the same millisecond', () => {
	const ids = [newId(1000), newId(1000), newId(999), newId(5000)];
	assert.deepEqual([...ids].sort(), ids);
	assert.equal(new Set(ids).size, ids.length);
});

test('saving writes a manifest and identical content shares one blob', async () => {
	const root = await project({ 'a.txt': 'same', 'b/c.txt': 'same', 'd.txt': 'other' });
	const snap = await saveSnapshot(root, 'First');
	assert.equal(snap.files['a.txt'], snap.files['b/c.txt']);
	assert.equal((await fs.readdir(path.join(root, '.codeler/history/blobs'))).length, 2);
	assert.equal((await readBlob(root, snap.files['d.txt'])).toString(), 'other');
	const [listed] = await listSnapshots(root);
	assert.deepEqual(listed, snap);
	await assert.rejects(readBlob(root, '../../a.txt'));
});

test('diff finds added, modified and deleted files', async () => {
	const root = await project({ 'keep.txt': '1', 'edit.txt': '1', 'gone.txt': '1' });
	const snap = await saveSnapshot(root, 'Base');
	await fs.writeFile(path.join(root, 'edit.txt'), '2');
	await fs.rm(path.join(root, 'gone.txt'));
	await fs.writeFile(path.join(root, 'new.txt'), '1');
	assert.deepEqual(diff(snap.files, await currentFiles(root)), [
		{ path: 'edit.txt', status: 'M' }, { path: 'gone.txt', status: 'D' }, { path: 'new.txt', status: 'A' },
	]);
	assert.deepEqual(diff(undefined, { 'x': 'y' }), [{ path: 'x', status: 'A' }]);
});

test('restore brings files back, deletes extra tracked files, leaves ignored folders alone and saves a "before restoring" snapshot', async () => {
	const root = await project({ 'a.txt': 'v1', 'sub/b.txt': 'v1', 'node_modules/lib.js': 'lib' });
	const v1 = await saveSnapshot(root, 'Version one', 1000);
	await fs.writeFile(path.join(root, 'a.txt'), 'v2');
	await fs.rm(path.join(root, 'sub'), { recursive: true });
	await fs.writeFile(path.join(root, 'extra.txt'), 'new');
	await fs.mkdir(path.join(root, 'dist'));
	await fs.writeFile(path.join(root, 'dist/build.js'), 'built');

	const before = await restoreSnapshot(root, v1, 2000);

	assert.equal(await read(root, 'a.txt'), 'v1');
	assert.equal(await read(root, 'sub/b.txt'), 'v1');
	assert.equal(await exists(root, 'extra.txt'), false);
	assert.equal(await read(root, 'node_modules/lib.js'), 'lib');
	assert.equal(await read(root, 'dist/build.js'), 'built');
	assert.equal(before.message, 'Before restoring Version one');
	assert.deepEqual(Object.keys(before.files).sort(), ['a.txt', 'extra.txt']);
	const snaps = await listSnapshots(root);
	assert.deepEqual(snaps.map(s => s.message), ['Before restoring Version one', 'Version one']);

	// Undo: restoring the safety snapshot gets the work back.
	await restoreSnapshot(root, before, 3000);
	assert.equal(await read(root, 'a.txt'), 'v2');
	assert.equal(await read(root, 'extra.txt'), 'new');
	assert.equal(await exists(root, 'sub/b.txt'), false);
});
