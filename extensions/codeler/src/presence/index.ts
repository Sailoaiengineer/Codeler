import * as vscode from 'vscode';
import * as path from 'node:path';
import { ConvexClient } from 'convex/browser';
import { Auth } from '../auth';
import { colorFor, followSelection, Presence, recentRows, TAG_COLORS } from './logic';
import { isSafeRelativePath } from '../sync/safety';

export type PresenceRow = Presence;
export type PresenceBridge = { onRows: (rows: PresenceRow[]) => void; follow: (userId: string) => void; stopFollowing: () => void };
type Rpc = { mutation(name: 'presence:heartbeat', args: any): Promise<void>; onUpdate(name: 'presence:list', args: { projectId: string }, cb: (rows: PresenceRow[]) => void): () => void };

const safeRelative = (root: string, uri: vscode.Uri) => {
	const value = path.relative(root, uri.fsPath).split(path.sep).join('/');
	return isSafeRelativePath(value) ? value : undefined;
};
// A teammate's path is only opened when it passes the shared rule and resolves inside the workspace root.
const insideUri = (root: string, file: string) => {
	const abs = path.resolve(root, file);
	return isSafeRelativePath(file) && abs.startsWith(root + path.sep) ? vscode.Uri.file(abs) : undefined;
};

export function startPresence(ctx: vscode.ExtensionContext, auth: Auth, bridge: PresenceBridge): vscode.Disposable {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	const projectId = vscode.workspace.getConfiguration('codeler').get<string>('projectId', '');
	const convexUrl = vscode.workspace.getConfiguration('codeler').get<string>('convexUrl', '');
	if (!root || !projectId || !convexUrl) return new vscode.Disposable(() => undefined);
	const client = new ConvexClient(convexUrl); client.setAuth(async () => (await auth.convexToken()) ?? null); const rpc = client as unknown as Rpc;
	const windowId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	let lastActivity = Date.now(); let lastHeartbeat = 0; let stopped = false; let unsubscribe: (() => void) | undefined;
	let followed: string | undefined; let latest: PresenceRow[] = [];
	const active = () => vscode.window.activeTextEditor;
	const heartbeat = async () => {
		if (stopped || !auth.me) return;
		const now = Date.now(); const minimum = now - lastActivity < 15_000 ? 2_000 : 15_000;
		if (now - lastHeartbeat < minimum) return;
		const editor = active(); if (!editor || editor.document.uri.scheme !== 'file') return;
		const file = safeRelative(root, editor.document.uri); if (!file) return;
		const s = editor.selection;
		lastHeartbeat = now;
		await rpc.mutation('presence:heartbeat', { projectId, window: windowId, path: file, cursor: { line: s.active.line, character: s.active.character }, selection: { startLine: s.start.line, startCharacter: s.start.character, endLine: s.end.line, endCharacter: s.end.character } }).catch(() => undefined);
	};
	const markActive = (kind?: vscode.TextEditorSelectionChangeKind) => { lastActivity = Date.now(); void heartbeat(); if (kind === vscode.TextEditorSelectionChangeKind.Keyboard || kind === vscode.TextEditorSelectionChangeKind.Mouse) followed = followSelection(followed ? { userId: followed, active: true } : undefined, kind === vscode.TextEditorSelectionChangeKind.Keyboard ? 'keyboard' : 'mouse')?.userId; };
	const timer = setInterval(() => { if (Date.now() - lastActivity < 15_000 || Date.now() % 15_000 < 2_000) void heartbeat(); }, 2_000);
	const refresh = (rows: PresenceRow[]) => {
		latest = recentRows(rows ?? []);
		bridge.onRows(latest);
		if (!followed) return;
		const target = latest.find(row => row.userId === followed); if (!target) return;
		const uri = insideUri(root, target.path); if (!uri) return;
		const line = Math.max(0, target.line); const character = Math.max(0, target.character);
		void vscode.window.showTextDocument(uri, { selection: new vscode.Range(line, character, line, character), preview: false });
	};
	const subscribe = () => { unsubscribe?.(); if (auth.me) unsubscribe = rpc.onUpdate('presence:list', { projectId }, refresh); };
	subscribe();
	const authChange = auth.onDidChange(() => { subscribe(); markActive(); });
	const expiryTimer = setInterval(() => bridge.onRows(recentRows(latest)), 10_000);
	const disposables: vscode.Disposable[] = [new vscode.Disposable(() => { stopped = true; clearInterval(timer); clearInterval(expiryTimer); unsubscribe?.(); client.close(); }), authChange,
		vscode.window.onDidChangeTextEditorSelection(event => markActive(event.kind)), vscode.window.onDidChangeActiveTextEditor(() => markActive())];
	const handle: PresenceBridge = { onRows: bridge.onRows, follow: (userId) => { followed = userId; refresh(latest); }, stopFollowing: () => { followed = undefined; } };
	// Keep the bridge methods live without exposing mutable internals to the caller.
	bridge.follow = handle.follow; bridge.stopFollowing = handle.stopFollowing;
	void heartbeat();
	return vscode.Disposable.from(...disposables);
}

export function presenceDecorationProvider(rows: PresenceRow[], getFile = (uri: vscode.Uri) => uri.path.split('/').filter(Boolean).join('/')): vscode.FileDecorationProvider {
	return { provideFileDecoration(uri, _token) { const file = getFile(uri); const people = rows.filter(r => r.path === file); if (!people.length) return undefined; const index = TAG_COLORS.indexOf(colorFor(people[0].userId)) + 1; return { badge: people.map(p => p.name.split(/\s+/).map(s => s[0] ?? '').join('').slice(0, 1).toUpperCase()).join('').slice(0, 2), color: new vscode.ThemeColor(`codeler.person${index}`), tooltip: people.map(p => p.name).join(', ') }; } };
}
