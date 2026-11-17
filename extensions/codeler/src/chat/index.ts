import * as vscode from 'vscode';
import { ConvexClient } from 'convex/browser';
import { ConvexError } from 'convex/values';
import { Auth, convexUrl as appConvexUrl } from '../auth';
import { ActivityRow, ChatRow, admitSend, fileError, messageError, panelActivity, panelMessage } from './logic';

// Live chat and activity. Signed out, or with no project set, nothing is pushed and the panels keep their sample data.
// The panels only get data once main extension.ts calls attachChat(webview, page) for each chat/activity webview.

type Rpc = {
	mutation(name: string, args: Record<string, unknown>): Promise<any>;
	onUpdate(name: string, args: Record<string, unknown>, callback: (value: any) => void): () => void;
};
type Page = 'chat' | 'activity';
type FromPanel = { type: string; text?: string; url?: string; file?: { name: string; type: string; data: string } };

const views = new Map<vscode.Webview, Page>();
const state = { live: false, me: undefined as string | undefined, messages: [] as ChatRow[], activity: [] as ActivityRow[], members: [] as { userId: string; name: string }[], unread: 0 };
const unreadEvent = new vscode.EventEmitter<number>();
let rpc: Rpc | undefined;
let projectId = '';
let unsubs: Array<() => void> = [];
let sentAt: number[] = [];

/** Unread mentions for the current project. Feeds the title bar later. */
export function unreadCount(): number { return state.unread; }
export const onDidChangeUnread = unreadEvent.event;

function sendTo(webview: vscode.Webview, page: Page) {
	if (!state.live) { void webview.postMessage({ type: 'live', on: false }); return; }
	if (page === 'chat') void webview.postMessage({ type: 'chat', messages: state.messages.map(m => panelMessage(m, state.me)), members: state.members });
	else void webview.postMessage({ type: 'activity', items: state.activity.map(panelActivity) });
}

function pushAll() { for (const [webview, page] of views) sendTo(webview, page); }

function setUnread(n: number) { state.unread = n; unreadEvent.fire(n); }

async function sendChat(webview: vscode.Webview, text: string, file: FromPanel['file']) {
	const fail = (message: string) => void webview.postMessage({ type: 'error', text: message });
	if (!rpc || !state.live) return fail('Sign in and pick a project to send messages.');
	// A file-only message is sent under the file's name, since messages need text.
	const body = text.trim() || file?.name || '';
	const error = messageError(body);
	if (error) return fail(error);
	const sent = admitSend(sentAt, Date.now());
	if (!sent) return fail('Slow down: 30 messages a minute is the limit.');
	sentAt = sent;
	// atob, not Buffer: Buffer's typing with this tsconfig's lib set does not accept a base64 string.
	const bytes = file ? Uint8Array.from(atob(file.data), c => c.charCodeAt(0)) : undefined;
	const fileProblem = file && bytes ? fileError({ type: file.type, size: bytes.byteLength }) : undefined;
	if (fileProblem) return fail(fileProblem);
	try {
		const messageId = await rpc.mutation('chat:send', { projectId, text: body });
		if (file && bytes) {
			const uploadUrl: string = await rpc.mutation('chat:generateUploadUrl', { projectId });
			const res = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.type }, body: bytes });
			if (!res.ok) throw new Error('upload failed');
			const { storageId } = await res.json() as { storageId: string };
			await rpc.mutation('chat:attach', { projectId, messageId, storageId, name: file.name });
		}
	} catch (e) {
		fail(e instanceof ConvexError && typeof e.data === 'string' ? e.data : 'That didn\'t go through. Try again.');
	}
}

/** Connects one chat or activity webview. Call it from the panel's render code in extension.ts. */
export function attachChat(webview: vscode.Webview, page: Page): vscode.Disposable {
	views.set(webview, page);
	const listener = webview.onDidReceiveMessage((m: FromPanel) => {
		if (m.type === 'ready') {
			sendTo(webview, page);
			if (page === 'chat' && state.live && rpc) void rpc.mutation('chat:markRead', { projectId }).catch(() => undefined);
		} else if (m.type === 'chatSend' && page === 'chat') {
			void sendChat(webview, m.text ?? '', m.file);
		} else if (m.type === 'chatOpenFile' && typeof m.url === 'string' && m.url.startsWith('https://')) {
			void vscode.env.openExternal(vscode.Uri.parse(m.url));
		}
	});
	return vscode.Disposable.from(listener, new vscode.Disposable(() => { views.delete(webview); }));
}

export function startChat(_ctx: vscode.ExtensionContext, auth: Auth): vscode.Disposable {
	const settings = vscode.workspace.getConfiguration('codeler');
	const convexUrl = appConvexUrl();
	projectId = settings.get<string>('projectId', '');
	if (!projectId || !convexUrl) return new vscode.Disposable(() => undefined);
	const client = new ConvexClient(convexUrl);
	client.setAuth(async () => (await auth.convexToken()) ?? null);
	rpc = client as unknown as Rpc;
	const pid = projectId;

	const stop = () => {
		for (const off of unsubs) off();
		unsubs = [];
		const wasLive = state.live;
		Object.assign(state, { live: false, me: undefined, messages: [], activity: [], members: [] });
		setUnread(0);
		if (wasLive) pushAll();
	};
	const start = () => {
		stop();
		if (!auth.me || !rpc) return;
		state.live = true;
		state.me = auth.me.id;
		unsubs = [
			rpc.onUpdate('chat:list', { projectId: pid }, (rows: ChatRow[]) => { state.messages = rows; pushAll(); }),
			rpc.onUpdate('chat:members', { projectId: pid }, (rows: { userId: string; name: string }[]) => { state.members = rows; pushAll(); }),
			rpc.onUpdate('activity:list', { projectId: pid }, (rows: ActivityRow[]) => { state.activity = rows; pushAll(); }),
			rpc.onUpdate('chat:unread', { projectId: pid }, (n: number) => setUnread(n)),
		];
	};

	start();
	const authChange = auth.onDidChange(() => (auth.me ? start() : stop()));
	return vscode.Disposable.from(authChange, unreadEvent, new vscode.Disposable(() => { stop(); client.close(); rpc = undefined; }));
}
