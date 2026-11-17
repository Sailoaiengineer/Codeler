import * as vscode from 'vscode';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { ConvexClient } from 'convex/browser';
import * as Y from 'yjs';
import { Auth } from '../auth';
import { recordActivity, recordChange } from '../activity';
import { isIgnored, looksBinary, safePath } from './safety';
import { applyEditorText, loadDocument, PendingUpdates, textDiff } from './logic';

type FileRow = { _id: string; path: string; version: number };
type State = { file: string; doc: Y.Doc; text: Y.Text; disk: string; synced: string; version: number; queued: PendingUpdates; applying: boolean; unsubscribe?: () => void; fileId?: string };
type ProjectArgs = { projectId: string }; type FileArgs = ProjectArgs & { path: string }; type PushArgs = FileArgs & { updates: Uint8Array[]; size: number }; type RenameArgs = FileArgs & { newPath: string };
type SyncRpc = { query(name: 'sync:loadFile', args: FileArgs): Promise<any>; query(name: 'sync:listFiles', args: ProjectArgs): Promise<any>; mutation(name: 'sync:pushUpdates', args: PushArgs): Promise<number>; mutation(name: 'sync:saveSnapshot', args: FileArgs & { version: number; state: Uint8Array; size: number }): Promise<void>; mutation(name: 'sync:deleteFile', args: FileArgs): Promise<void>; mutation(name: 'sync:renameFile', args: RenameArgs): Promise<void>; onUpdate(name: 'sync:listFiles', args: ProjectArgs, callback: (value: FileRow[]) => void): () => void; onUpdate(name: 'sync:updates', args: FileArgs & { afterVersion: number }, callback: (value: any) => void): () => void };

export function startSync(ctx: vscode.ExtensionContext, auth: Auth): vscode.Disposable {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	const projectId = vscode.workspace.getConfiguration('codeler').get<string>('projectId', '');
	const convexUrl = vscode.workspace.getConfiguration('codeler').get<string>('convexUrl', '');
	if (!root || !projectId || !convexUrl) return new vscode.Disposable(() => undefined);
	const client = new ConvexClient(convexUrl); client.setAuth(async () => (await auth.convexToken()) ?? null);
	const rpc = client as unknown as SyncRpc; const states = new Map<string, State>();
	const disposables: vscode.Disposable[] = [new vscode.Disposable(() => client.close())];
	const relative = (uri: vscode.Uri) => path.relative(root, uri.fsPath).split(path.sep).join('/');
	const readDisk = async (file: string) => { const target = safePath(root, file); if (!target) return undefined; const data = await fsp.readFile(target).catch(() => undefined); if (!data || data.byteLength > 2 * 1024 * 1024 || looksBinary(data)) return undefined; return new TextDecoder().decode(data); };
	const writeDisk = async (file: string, value: string) => { const target = safePath(root, file); if (target) { await fsp.mkdir(path.dirname(target), { recursive: true }); await fsp.writeFile(target, value, 'utf8'); } };
	const openEditor = (file: string) => vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && relative(d.uri) === file);
	const push = async (state: State) => { const merged = state.queued.takeMerged(); if (!merged) return; try { state.version = await rpc.mutation('sync:pushUpdates', { projectId, path: state.file, updates: [merged], size: new TextEncoder().encode(state.text.toString()).byteLength }); } catch (e) { state.queued.restore(merged); if (String(e).includes('needs a snapshot')) await rpc.mutation('sync:saveSnapshot', { projectId, path: state.file, version: state.version, state: Y.encodeStateAsUpdate(state.doc), size: new TextEncoder().encode(state.text.toString()).byteLength }).catch(() => undefined); } };
	const subscribe = (state: State) => { const from = state.version; state.unsubscribe?.(); state.unsubscribe = rpc.onUpdate('sync:updates', { projectId, path: state.file, afterVersion: state.version }, (result) => { if (!states.has(state.file)) return; for (const row of result?.updates ?? []) { state.applying = true; Y.applyUpdate(state.doc, row.update, 'remote'); state.applying = false; state.version = Math.max(state.version, row.version); } if (state.version > from) subscribe(state); }); };
	const applyRemoteEditor = async (state: State, before: string, after: string) => { const editor = openEditor(state.file); const diff = textDiff(before, after); if (!diff) return; if (!editor) { state.disk = after; await writeDisk(state.file, after); return; } const edit = new vscode.WorkspaceEdit(); edit.replace(editor.uri, new vscode.Range(editor.positionAt(diff.index), editor.positionAt(diff.index + diff.deleteCount)), diff.insert); state.applying = true; await vscode.workspace.applyEdit(edit); state.applying = false; };
	const ensure = async (file: string): Promise<State | undefined> => {
		if (states.has(file)) return states.get(file); if (isIgnored(file)) return undefined; const diskRead = await readDisk(file); const target = safePath(root, file); const existsOnDisk = target ? await fsp.stat(target).then(() => true).catch(() => false) : false;
		const loaded = await rpc.query('sync:loadFile', { projectId, path: file }).catch(() => undefined); if (diskRead === undefined && existsOnDisk) return undefined; const disk = diskRead ?? ''; const server = loaded ? { exists: Boolean(loaded.file), snapshot: loaded.snapshot as Uint8Array, updates: (loaded.updates ?? []).map((u: any) => u.update as Uint8Array) } : { exists: false, updates: [] }; const hydrated = loadDocument(server, disk);
		const state: State = { file, doc: hydrated.doc, text: hydrated.text, disk, synced: hydrated.text.toString(), version: loaded?.file?.version ?? 0, queued: new PendingUpdates(), applying: false, fileId: loaded?.file?._id }; states.set(file, state);
		// Every local change (editor or disk) is queued here; remote ones arrive with origin 'remote'.
		state.doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== 'remote') state.queued.add(update); });
		state.text.observe(event => { const next = state.text.toString(); if (event.transaction.origin === 'remote') void applyRemoteEditor(state, state.synced, next); state.synced = next; });
		if (!server.exists) { const first = Y.encodeStateAsUpdate(state.doc); if (first.byteLength) state.queued.add(first); await push(state); } else if (hydrated.offlineUpdate?.byteLength) { state.queued.add(hydrated.offlineUpdate); await push(state); }
		subscribe(state); return state;
	};
	const syncDisk = async (file: string) => { const state = await ensure(file); if (!state || openEditor(file)) return; const next = await readDisk(file); if (next === undefined || next === state.disk) return; const diff = textDiff(state.disk, next); if (!diff) return; state.applying = true; state.text.delete(diff.index, diff.deleteCount); state.text.insert(diff.index, diff.insert); state.applying = false; state.disk = next; recordChange(file); await push(state); };
	const deleteLocal = async (file: string) => { const state = states.get(file); if (state?.queued.length) { void vscode.window.showWarningMessage(`Kept ${file}; it has unsent edits.`); return; } states.delete(file); if (state) void recordActivity('file_deleted', file); await rpc.mutation('sync:deleteFile', { projectId, path: file }).catch(() => undefined); };
	const syncEditor = async (event: vscode.TextDocumentChangeEvent) => { if (event.document.uri.scheme !== 'file') return; const state = await ensure(relative(event.document.uri)); if (!state || !applyEditorText(state.text, event.document.getText())) return; recordChange(state.file); await push(state); };
	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), '**/*')); disposables.push(watcher, watcher.onDidCreate(uri => { const file = relative(uri); const known = states.has(file); void ensure(file).then(state => { if (state && !known) void recordActivity('file_created', file); }); }), watcher.onDidChange(uri => void syncDisk(relative(uri))), watcher.onDidDelete(uri => void deleteLocal(relative(uri))));
	disposables.push(vscode.workspace.onDidChangeTextDocument(event => void syncEditor(event)));
	disposables.push(vscode.workspace.onDidRenameFiles(event => { for (const item of event.files) { const oldPath = relative(item.oldUri); const newPath = relative(item.newUri); const state = states.get(oldPath); if (state) { states.delete(oldPath); state.file = newPath; states.set(newPath, state); void recordActivity('file_renamed', newPath); void rpc.mutation('sync:renameFile', { projectId, path: oldPath, newPath }).then(() => subscribe(state)); } } }));
	const reconcile = async (rows: FileRow[]) => { const byId = new Map(rows.map(row => [row._id, row])); for (const row of rows) { const existing = [...states.values()].find(s => s.fileId === row._id); if (existing && existing.file !== row.path) { states.delete(existing.file); existing.file = row.path; states.set(row.path, existing); subscribe(existing); } else await ensure(row.path); } for (const [file, state] of states) if (state.fileId && !byId.has(state.fileId)) { if (state.queued.length) void vscode.window.showWarningMessage(`Kept ${file}; it has unsent edits.`); else { states.delete(file); if (!openEditor(file)) await fsp.rm(safePath(root, file) ?? file, { force: true }).catch(() => undefined); } } };
	const listUnsubscribe = rpc.onUpdate('sync:listFiles', { projectId }, (rows: FileRow[]) => void reconcile(rows ?? [])); disposables.push(new vscode.Disposable(listUnsubscribe));
	const interval = setInterval(() => { for (const state of states.values()) void push(state); }, 500); disposables.push(new vscode.Disposable(() => clearInterval(interval)));
	return vscode.Disposable.from(...disposables);
}
