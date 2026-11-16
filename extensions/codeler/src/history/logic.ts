// Codeler version history: snapshots stored in <root>/.codeler/history. No vscode imports, so tests can run it directly.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const IGNORED = new Set(['node_modules', '.git', '.codeler', 'dist', 'out', '.next']);
export const MAX_FILE_SIZE = 2 * 1024 * 1024;

export type Files = Record<string, string>; // project-relative posix path -> sha256
export interface Snapshot { id: string; message: string; createdAt: number; files: Files }
export interface Change { path: string; status: 'A' | 'M' | 'D' }

const historyDir = (root: string) => path.join(root, '.codeler', 'history');
const blobPath = (root: string, sha: string) => path.join(historyDir(root), 'blobs', sha);

export const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** True when the path is a safe project-relative posix path (no `..`, not absolute, no backslashes or drive letters). */
export function isSafePath(rel: string): boolean {
	if (!rel || rel.includes('\\') || rel.includes('\0') || path.posix.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) { return false; }
	return rel.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

export const isIgnored = (rel: string) => rel.split('/').some(part => IGNORED.has(part));
export const isTracked = (rel: string) => isSafePath(rel) && !isIgnored(rel);

export const isBinary = (data: Uint8Array) => data.subarray(0, 8192).includes(0);

/** Reads every tracked text file. Symlinks are skipped, so nothing outside the root is read. */
// shortcut: holds all tracked files in memory (each capped at 2 MB); stream if huge projects become common.
export async function scan(root: string): Promise<Map<string, Buffer>> {
	const out = new Map<string, Buffer>();
	const walk = async (dir: string, prefix: string) => {
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			const rel = prefix + entry.name;
			if (entry.isSymbolicLink() || !isTracked(rel)) { continue; }
			const abs = path.join(dir, entry.name);
			if (entry.isDirectory()) { await walk(abs, rel + '/'); continue; }
			if (!entry.isFile() || (await fs.stat(abs)).size > MAX_FILE_SIZE) { continue; }
			const data = await fs.readFile(abs);
			if (!isBinary(data)) { out.set(rel, data); }
		}
	};
	await walk(root, '');
	return out;
}

export async function currentFiles(root: string): Promise<Files> {
	const files: Files = {};
	for (const [rel, data] of await scan(root)) { files[rel] = sha256(data); }
	return files;
}

let lastTime = 0;
/** Ids sort by creation time as plain strings; ties within one millisecond get bumped forward. */
export function newId(now: number): string {
	lastTime = Math.max(now, lastTime + 1);
	return String(lastTime).padStart(15, '0');
}

export async function saveSnapshot(root: string, message: string, now = Date.now()): Promise<Snapshot> {
	const files: Files = {};
	await fs.mkdir(path.join(historyDir(root), 'blobs'), { recursive: true });
	await fs.mkdir(path.join(historyDir(root), 'snapshots'), { recursive: true });
	for (const [rel, data] of await scan(root)) {
		const sha = files[rel] = sha256(data);
		await fs.writeFile(blobPath(root, sha), data, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'EEXIST') { throw e; } });
	}
	const snapshot: Snapshot = { id: newId(now), message, createdAt: now, files };
	await fs.writeFile(path.join(historyDir(root), 'snapshots', snapshot.id + '.json'), JSON.stringify(snapshot, null, '\t'));
	return snapshot;
}

/** All snapshots, newest first. Manifests that can't be read are skipped. */
export async function listSnapshots(root: string): Promise<Snapshot[]> {
	const dir = path.join(historyDir(root), 'snapshots');
	const names = await fs.readdir(dir).catch(() => [] as string[]);
	const snaps: Snapshot[] = [];
	for (const name of names.filter(n => n.endsWith('.json'))) {
		try {
			const s = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as Snapshot;
			if (typeof s.id === 'string' && s.files && typeof s.files === 'object') { snaps.push(s); }
		} catch { /* damaged manifest: leave it out */ }
	}
	return snaps.sort((a, b) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

export async function readBlob(root: string, sha: string): Promise<Buffer> {
	if (!/^[0-9a-f]{64}$/.test(sha)) { throw new Error(`Bad snapshot file id: ${sha}`); }
	return fs.readFile(blobPath(root, sha));
}

/** What changed going from `base` to `next`, sorted by path. */
export function diff(base: Files | undefined, next: Files): Change[] {
	const changes: Change[] = [];
	for (const [p, sha] of Object.entries(next)) {
		if (!base || !(p in base)) { changes.push({ path: p, status: 'A' }); }
		else if (base[p] !== sha) { changes.push({ path: p, status: 'M' }); }
	}
	for (const p of Object.keys(base ?? {})) { if (!(p in next)) { changes.push({ path: p, status: 'D' }); } }
	return changes.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** Files to write and tracked files to remove so the folder matches the snapshot. Unsafe or ignored paths are refused. */
export function planRestore(snapshot: Files, current: Files): { write: [string, string][]; remove: string[] } {
	for (const p of Object.keys(snapshot)) { if (!isTracked(p)) { throw new Error(`The snapshot contains a path that isn't allowed: ${p}`); } }
	return {
		write: Object.entries(snapshot).filter(([p, sha]) => current[p] !== sha),
		remove: Object.keys(current).filter(p => !(p in snapshot) && isTracked(p)),
	};
}

/** Saves "Before restoring <name>", then makes the tracked files match `snapshot`. Returns the safety snapshot. */
export async function restoreSnapshot(root: string, snapshot: Snapshot, now = Date.now()): Promise<Snapshot> {
	const before = await saveSnapshot(root, `Before restoring ${snapshot.message}`, now);
	const plan = planRestore(snapshot.files, before.files);
	const realRoot = await fs.realpath(root);
	const inside = (p: string) => p === realRoot || p.startsWith(realRoot + path.sep);
	for (const [rel, sha] of plan.write) {
		const abs = path.join(root, ...rel.split('/'));
		await fs.mkdir(path.dirname(abs), { recursive: true });
		// Don't write through a symlinked folder that points outside the project.
		if (!inside(await fs.realpath(path.dirname(abs)))) { throw new Error(`Refusing to write outside the project: ${rel}`); }
		await fs.writeFile(abs, await readBlob(root, sha));
	}
	for (const rel of plan.remove) { await fs.rm(path.join(root, ...rel.split('/')), { force: true }); }
	return before;
}

export function relativeTime(then: number, now = Date.now()): string {
	const s = Math.round((now - then) / 1000);
	const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'} ago`;
	if (s < 60) { return 'just now'; }
	if (s < 3600) { return unit(Math.floor(s / 60), 'minute'); }
	if (s < 86400) { return unit(Math.floor(s / 3600), 'hour'); }
	if (s < 86400 * 30) { return unit(Math.floor(s / 86400), 'day'); }
	return new Date(then).toLocaleDateString();
}
