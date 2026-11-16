import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { ConvexClient } from 'convex/browser';
// Yjs is ESM-first; the VSCodium bundler resolves this import for the extension host.
// @ts-expect-error VSCodium's CommonJS extension build consumes the ESM package through its bundler.
import * as Y from 'yjs';
import { Auth } from '../auth';
import { isIgnored, looksBinary, safePath, textDiff } from './safety';

type State = { doc: Y.Doc; text: Y.Text; disk: string; version: number; applying: boolean; queued: Uint8Array[]; lastSnapshot: number };
const bytes = (v: Uint8Array | ArrayBuffer) => v instanceof Uint8Array ? v : new Uint8Array(v);

export function startSync(ctx: vscode.ExtensionContext, auth: Auth): vscode.Disposable {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	const projectId = vscode.workspace.getConfiguration('codeler').get<string>('projectId', '');
	const convexUrl = vscode.workspace.getConfiguration('codeler').get<string>('convexUrl', '');
	if (!root || !projectId || !convexUrl) return new vscode.Disposable(() => undefined);
	const client = new ConvexClient(convexUrl);
	client.setAuth(async () => (await auth.convexToken()) ?? null);
	const states = new Map<string, State>();
	const disposables: vscode.Disposable[] = [new vscode.Disposable(() => client.close())];
	const relative = (uri: vscode.Uri) => path.relative(root, uri.fsPath).split(path.sep).join('/');
	const readDisk = async (file: string) => {
		const target = safePath(root, file); if (!target) return undefined;
		const data = await fsp.readFile(target).catch(() => undefined);
		if (!data || data.byteLength > 2 * 1024 * 1024 || looksBinary(data)) return undefined;
		return new TextDecoder().decode(data);
	};
	const writeLocal = async (file: string, value: string) => { const target = safePath(root, file); if (target) { await fsp.mkdir(path.dirname(target), { recursive: true }); await fsp.writeFile(target, value, 'utf8'); } };
	const push = async (file: string, state: State) => {
		if (!state.queued.length) return;
		const updates = state.queued.splice(0);
		const version = await (client as any).mutation('sync:pushUpdates', { projectId, path: file, updates, size: new TextEncoder().encode(state.text.toString()).byteLength }).catch(() => undefined);
		if (typeof version === 'number') state.version = Math.max(state.version, version);
	};
	const ensure = async (file: string): Promise<State | undefined> => {
		if (states.has(file)) return states.get(file);
		const disk = await readDisk(file); if (disk === undefined || isIgnored(file)) return undefined;
		const doc = new Y.Doc(); const text = doc.getText('file'); text.insert(0, disk);
		const state: State = { doc, text, disk, version: 0, applying: false, queued: [], lastSnapshot: Date.now() }; states.set(file, state);
		const loaded = await (client as any).query('sync:loadFile', { projectId, path: file }).catch(() => undefined);
		if (loaded) { state.applying = true; Y.applyUpdate(doc, bytes(loaded.snapshot)); for (const row of loaded.updates ?? []) { Y.applyUpdate(doc, bytes(row.update)); state.version = Math.max(state.version, row.version); } state.applying = false; state.disk = text.toString(); await writeLocal(file, state.disk); }
		doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== 'remote') state.queued.push(update); });
		return state;
	};
	const syncDisk = async (file: string) => { if (isIgnored(file)) return; const state = await ensure(file); if (!state) return; const next = await readDisk(file); if (next === undefined || next === state.disk) return; const diff = textDiff(state.disk, next); if (!diff) return; state.applying = true; state.text.delete(diff.index, diff.deleteCount); state.text.insert(diff.index, diff.insert); state.applying = false; state.disk = next; await push(file, state); };
	const applyRemote = async (file: string, result: any) => { const state = await ensure(file); if (!state) return; for (const row of result?.updates ?? []) { state.applying = true; Y.applyUpdate(state.doc, bytes(row.update), 'remote'); state.applying = false; state.version = Math.max(state.version, row.version); } state.disk = state.text.toString(); await writeLocal(file, state.disk); };
	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), '**/*'));
	for (const event of [watcher.onDidCreate, watcher.onDidChange]) disposables.push(event(uri => void syncDisk(relative(uri))));
	disposables.push(watcher, vscode.workspace.onDidChangeTextDocument(e => { if (e.document.uri.scheme !== 'file') return; void (async () => { const file = relative(e.document.uri); const state = await ensure(file); if (!state || state.applying) return; state.disk = e.document.getText(); await push(file, state); })(); }));
	disposables.push(vscode.workspace.onDidOpenTextDocument(doc => { if (doc.uri.scheme === 'file') void ensure(relative(doc.uri)); }));
	const interval = setInterval(() => { for (const [file, state] of states) void (async () => { await push(file, state); if (state.version > 0 && Date.now() - state.lastSnapshot > 30_000) { const snapshot = Y.encodeStateAsUpdate(state.doc); await (client as any).mutation('sync:saveSnapshot', { projectId, path: file, version: state.version, state: snapshot, size: new TextEncoder().encode(state.text.toString()).byteLength }).catch(() => undefined); state.lastSnapshot = Date.now(); } })(); }, 500);
	disposables.push(new vscode.Disposable(() => clearInterval(interval)));
	void (async () => { for (const file of await walk(root)) { await ensure(file); (client as any).onUpdate('sync:updates', { projectId, path: file, afterVersion: states.get(file)?.version ?? 0 }, (result: any) => void applyRemote(file, result)); } })();
	return vscode.Disposable.from(...disposables);
}

async function walk(root: string): Promise<string[]> {
	const output: string[] = [];
	async function visit(dir: string) { for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [] as fs.Dirent[])) { const rel = path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/'); if (isIgnored(rel)) continue; if (entry.isDirectory()) await visit(path.join(dir, entry.name)); else output.push(rel); } }
	await visit(root); return output;
}
