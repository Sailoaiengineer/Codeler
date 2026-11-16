import * as vscode from 'vscode';
import * as path from 'node:path';
import { ConvexClient } from 'convex/browser';
import { Auth } from '../auth';
import { colorFor, Presence } from './logic';

export type PresenceRow = Presence;
export type PresenceBridge = { onRows: (rows: PresenceRow[]) => void; follow: (userId: string) => void; stopFollowing: () => void };
type Rpc = { mutation(name: 'presence:heartbeat', args: any): Promise<void>; onUpdate(name: 'presence:list', args: { projectId: string }, cb: (rows: PresenceRow[]) => void): () => void };

const safeRelative = (root: string, uri: vscode.Uri) => {
	const value = path.relative(root, uri.fsPath).split(path.sep).join('/');
	if (!value || value.startsWith('../') || value === '..' || value.startsWith('/') || value.includes('\0') || /^[A-Za-z]:/.test(value)) return undefined;
	const parts = value.split('/');
	return parts.some(p => ['node_modules', '.git', '.codeler', 'dist', 'out', '.next'].includes(p)) ? undefined : value;
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
	let ignoreNextMove = false;
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
	const markActive = () => { lastActivity = Date.now(); if (followed && !ignoreNextMove) followed = undefined; ignoreNextMove = false; void heartbeat(); };
	const timer = setInterval(() => { if (Date.now() - lastActivity < 15_000 || Date.now() % 15_000 < 2_000) void heartbeat(); }, 2_000);
	const refresh = (rows: PresenceRow[]) => {
		latest = rows ?? [];
		bridge.onRows(rows ?? []);
		if (!followed) return;
		const target = (rows ?? []).find(row => row.userId === followed); if (!target) return;
		const uri = vscode.Uri.joinPath(vscode.Uri.file(root), ...target.path.split('/'));
		const line = Math.max(0, target.line); const character = Math.max(0, target.character);
		ignoreNextMove = true; void vscode.window.showTextDocument(uri, { selection: new vscode.Range(line, character, line, character), preview: false });
	};
	const subscribe = () => { unsubscribe?.(); if (auth.me) unsubscribe = rpc.onUpdate('presence:list', { projectId }, refresh); };
	subscribe();
	const authChange = auth.onDidChange(() => { subscribe(); markActive(); });
	const disposables: vscode.Disposable[] = [new vscode.Disposable(() => { stopped = true; clearInterval(timer); unsubscribe?.(); client.close(); }), authChange,
		vscode.window.onDidChangeTextEditorSelection(markActive), vscode.window.onDidChangeActiveTextEditor(markActive)];
	const handle: PresenceBridge = { onRows: bridge.onRows, follow: (userId) => { followed = userId; refresh(latest); }, stopFollowing: () => { followed = undefined; } };
	// Keep the bridge methods live without exposing mutable internals to the caller.
	bridge.follow = handle.follow; bridge.stopFollowing = handle.stopFollowing;
	void heartbeat();
	return vscode.Disposable.from(...disposables);
}

export function presenceDecorationProvider(rows: PresenceRow[], getFile = (uri: vscode.Uri) => uri.path.split('/').filter(Boolean).join('/')): vscode.FileDecorationProvider {
	return { provideFileDecoration(uri, _token) { const file = getFile(uri); const people = rows.filter(r => r.path === file); if (!people.length) return undefined; return { badge: people.map(p => p.name.split(/\s+/).map(s => s[0] ?? '').join('').slice(0, 1).toUpperCase()).join('').slice(0, 2), color: new vscode.ThemeColor(colorFor(people[0].userId)), tooltip: people.map(p => p.name).join(', ') }; } };
}
