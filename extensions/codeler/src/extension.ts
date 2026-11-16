import * as vscode from 'vscode';
import * as path from 'node:path';
import { sample } from './sample';
import { Auth } from './auth';
import { startSync } from './sync';
import { startPresence, presenceDecorationProvider, PresenceRow } from './presence';
import { colorFor, cursorRows } from './presence/logic';
import { TeamClient } from './teams/client';
import { cleanCreate, cleanJoin } from './teams/logic';
import { startRun } from './run';
import { startHistory } from './history';

const presenceViews = new Set<vscode.Webview>();
let presenceRows: PresenceRow[] = [];
let followingUserId: string | undefined;
let currentUserId: string | undefined;
let follow: (userId: string) => void = () => undefined;
let stopFollowing: () => void = () => undefined;
const presencePeople = () => presenceRows.map(p => ({ userId: p.userId, isMe: p.isMe, name: p.name, initials: p.name.split(/\s+/).map(s => s[0] ?? '').join('').slice(0, 2).toUpperCase(), color: colorFor(p.userId), photo: p.image ?? undefined, online: true, file: p.path, cursorLine: p.line + 1 }));

// Panels are plain HTML files in media/; each gets the shared stylesheet and a strict CSP.
class Panel implements vscode.WebviewViewProvider {
	constructor(private ctx: vscode.ExtensionContext, private page: string, private teams: TeamClient, private auth: Auth) { }
	resolveWebviewView(view: vscode.WebviewView) {
		const webview = view.webview;
		render(this.ctx, webview, this.page, this.teams, this.auth);
		view.onDidDispose(() => presenceViews.delete(webview));
	}
}

function render(ctx: vscode.ExtensionContext, webview: vscode.Webview, page: string, teams?: TeamClient, auth?: Auth) {
	presenceViews.add(webview);
	const media = vscode.Uri.joinPath(ctx.extensionUri, 'media');
	webview.options = { enableScripts: true, localResourceRoots: [media] };
	const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
	const read = (f: string) => vscode.workspace.fs.readFile(vscode.Uri.joinPath(media, f)).then(b => Buffer.from(b).toString("utf8"));
	read(page + '.html').then(html => {
		webview.html = html
			.replaceAll('{{csp}}', `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';`)
			.replaceAll('{{nonce}}', nonce)
			.replaceAll('{{css}}', webview.asWebviewUri(vscode.Uri.joinPath(media, 'codeler.css')).toString())
			.replaceAll('{{js}}', webview.asWebviewUri(vscode.Uri.joinPath(media, 'codeler.js')).toString())
			.replace('{{data}}', JSON.stringify(sample).replaceAll('<', '\\u003c'));
	});
	const refresh = async () => {
		if (!teams || !auth) return;
		const signedIn = Boolean(auth.me);
		if (!signedIn) { void webview.postMessage({ type: 'teamData', signedIn: false }); return; }
		try {
			const mine = await teams.mine();
			const projectId = vscode.workspace.getConfiguration('codeler').get<string>('projectId', '');
			const current = mine.find(t => t.projects?.some(p => p.id === projectId));
			const members = current ? await teams.people(current.teamId) : undefined;
			void webview.postMessage({ type: 'teamData', signedIn: true, teams: mine, members });
		} catch (error) { void webview.postMessage({ type: 'teamError', error: TeamClient.error(error) }); }
	};
	webview.onDidReceiveMessage(async (m: { type: string; file?: string; line?: number; text?: string; userId?: string; name?: string; description?: string; password?: string; invites?: { email: string; role: 'Admin' | 'Member' }[]; joinCode?: string; memberId?: string; projectId?: string; projectName?: string }) => {
		if (m.type === 'openLine' && m.file) {
			// shortcut: sample links resolve inside the first workspace folder only, until real project paths come from Convex
			const root = vscode.workspace.workspaceFolders?.[0]?.uri;
			if (root) vscode.window.showTextDocument(vscode.Uri.joinPath(root, m.file), { selection: new vscode.Range((m.line ?? 1) - 1, 0, (m.line ?? 1) - 1, 0) });
		} else if (m.type === 'close') {
			vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		} else if (m.type === 'notReady') {
			vscode.window.showInformationMessage(`${m.text} works once login and teams are connected.`);
		} else if (m.type === 'ready') {
			void refresh();
		} else if (m.type === 'signIn') {
			void auth?.signIn();
		} else if (m.type === 'createTeam' && teams && auth) {
			try {
				if (!auth.me) return void vscode.commands.executeCommand('codeler.signIn');
				const result = await teams.create(cleanCreate(m.name ?? '', m.description ?? '', m.password ?? '', (m.invites ?? []).map(i => ({ email: i.email, role: i.role.toLowerCase() as 'admin' | 'member' }))));
				void webview.postMessage({ type: 'teamCreated', joinCode: result.joinCode });
			} catch (error) { void webview.postMessage({ type: 'teamError', error: TeamClient.error(error) }); }
		} else if (m.type === 'joinTeam' && teams && auth) {
			try {
				if (!auth.me) return void vscode.commands.executeCommand('codeler.signIn');
				const result = await vscode.commands.executeCommand<{ status: 'pending' | 'active' }>('codeler.joinTeam', { joinCode: cleanJoin(m.joinCode ?? '', m.password ?? '').joinCode, password: m.password ?? '' });
				void webview.postMessage({ type: 'joinResult', status: result.status });
			} catch (error) { void webview.postMessage({ type: 'teamError', error: TeamClient.error(error) }); }
		} else if (m.type === 'project' && m.projectId) {
			await vscode.workspace.getConfiguration('codeler').update('projectId', m.projectId, vscode.ConfigurationTarget.Global);
			if (m.projectName) await vscode.workspace.getConfiguration('codeler').update('projectName', m.projectName, vscode.ConfigurationTarget.Global);
			await vscode.commands.executeCommand('workbench.action.reloadWindow');
		} else if (m.type === 'approve' && teams && m.memberId) {
			try { await teams.approve(m.memberId); await refresh(); } catch (error) { void webview.postMessage({ type: 'teamError', error: TeamClient.error(error) }); }
		} else if (m.type === 'deny' && teams && m.memberId) {
			try { await teams.deny(m.memberId); await refresh(); } catch (error) { void webview.postMessage({ type: 'teamError', error: TeamClient.error(error) }); }
		} else if (m.type === 'remove' && teams && m.memberId) {
			try { await teams.remove(m.memberId); await refresh(); } catch (error) { void webview.postMessage({ type: 'teamError', error: TeamClient.error(error) }); }
		} else if (m.type === 'follow' && m.userId) {
			follow(m.userId);
		} else if (m.type === 'stopFollowing') {
			stopFollowing();
		}
	});
}

// Name-tag cursors as in the reference image: a coloured caret plus a label after the line.
const tagTypes = sample.people.map(p => vscode.window.createTextEditorDecorationType({
	borderStyle: 'solid', borderColor: p.color, borderWidth: '0 0 0 2px',
	after: { contentText: p.name, backgroundColor: p.color, color: '#ffffff', margin: '0 0 0 4px', fontWeight: '600', textDecoration: ';font-size:12px;padding:1px 6px;border-radius:4px;font-family:Inter,Segoe UI,sans-serif' },
}));
const realTagTypes = new Map<string, vscode.TextEditorDecorationType>();
let showCursors = false;
function paintCursors(editor = vscode.window.activeTextEditor) {
	if (!editor) return;
	if (presenceRows.length) {
		const visible = new Set<string>();
		for (const p of cursorRows(presenceRows, currentUserId)) {
			const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			const file = root ? path.relative(root, editor.document.uri.fsPath).split(path.sep).join('/') : '';
			if (p.path !== file) continue;
			visible.add(p.userId);
			let type = realTagTypes.get(p.userId);
			if (!type) { type = vscode.window.createTextEditorDecorationType({ borderStyle: 'solid', borderColor: colorFor(p.userId), borderWidth: '0 0 0 2px', after: { contentText: p.name, backgroundColor: colorFor(p.userId), color: '#ffffff', margin: '0 0 0 4px', fontWeight: '600', textDecoration: ';font-size:12px;padding:1px 6px;border-radius:4px;font-family:Inter,Segoe UI,sans-serif' } }); realTagTypes.set(p.userId, type); }
			const line = Math.min(Math.max(0, p.line), editor.document.lineCount - 1); const character = Math.min(Math.max(0, p.character), editor.document.lineAt(line).text.length); const pos = new vscode.Position(line, character);
			editor.setDecorations(type, showCursors ? [new vscode.Range(pos, pos)] : []);
		}
		for (const [id, type] of realTagTypes) if (!visible.has(id)) editor.setDecorations(type, []);
		return;
	}
	sample.people.forEach((p, i) => {
		const line = Math.min(p.cursorLine - 1, editor.document.lineCount - 1);
		const end = editor.document.lineAt(Math.max(line, 0)).range.end;
		editor.setDecorations(tagTypes[i], showCursors && line >= 0 ? [new vscode.Range(end, end)] : []);
	});
}

export function activate(ctx: vscode.ExtensionContext) {
	const auth = new Auth(ctx.secrets);
	const teams = new TeamClient(auth);
	currentUserId = auth.me?.id;
	ctx.subscriptions.push(startSync(ctx, auth));
	ctx.subscriptions.push(startRun(ctx));
	ctx.subscriptions.push(startHistory(ctx));
	const projectId = () => Boolean(vscode.workspace.getConfiguration('codeler').get<string>('projectId', '') && auth.me);
	for (const [id, page] of [['codeler.chat', 'chat'], ['codeler.activity', 'activity'], ['codeler.collaborators', 'collaborators'], ['codeler.workspaces', 'workspaces']])
		ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(id, new Panel(ctx, page, teams, auth), { webviewOptions: { retainContextWhenHidden: true } }));
	// Clicking Team in the activity bar opens the full Team page instead of a narrow side panel.
	ctx.subscriptions.push(vscode.window.registerWebviewViewProvider('codeler.team', {
		resolveWebviewView(view) {
			view.webview.html = '';
			const open = () => view.visible && vscode.commands.executeCommand('codeler.createTeam');
			view.onDidChangeVisibility(open);
			open();
		},
	}));

	const connected = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
	connected.text = '$(circle-filled) Connected';
	connected.color = '#30c760';
	connected.tooltip = 'Connected to Codeler';
	const people = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 999);
	people.text = `$(organization) ${sample.people.length} collaborators`;
	people.command = 'workbench.view.extension.codeler-collaborators';
	connected.show();

	// shortcut: team vs solo comes from a preview setting until real teams exist (login step)
	const mode = () => vscode.workspace.getConfiguration('codeler').get<'team' | 'solo'>('layoutPreview', 'team');
	let teamPageActive = false;
	let decorationEvent: vscode.EventEmitter<vscode.Uri | undefined> | undefined;
	const pushTitlebar = () => {
		const team = mode() === 'team';
		const activeTeam = projectId();
		const root = vscode.workspace.workspaceFolders?.[0];
		vscode.commands.executeCommand('_codeler.titlebar.setState', {
			mode: mode(),
			project: team ? (vscode.workspace.getConfiguration('codeler').get<string>('projectName', '') || sample.teams[0].name) : root?.name ?? 'Open project',
			branch: 'main',
			people: team ? (activeTeam ? presencePeople() : sample.people) : [],
			unread: team ? 1 : 0,
			page: teamPageActive ? 'team' : undefined,
			account: auth.me ? { name: auth.me.name, photo: auth.me.image ?? undefined } : undefined,
			dirty: vscode.workspace.textDocuments.some(d => d.isDirty),
		}).then(undefined, () => { /* running in stock VSCodium: no Codeler title bar to fill */ });
		team ? people.show() : people.hide();
		showCursors = team;
		paintCursors();
	};
	const presenceBridge = { onRows: (rows: PresenceRow[]) => {
		presenceRows = rows; for (const view of presenceViews) void view.postMessage({ type: 'presence', people: presencePeople(), rows, followingUserId });
		pushTitlebar(); paintCursors(); decorationEvent?.fire(undefined);
	}, follow: (userId: string) => undefined, stopFollowing: () => undefined };
	decorationEvent = new vscode.EventEmitter<vscode.Uri | undefined>();
	const presence = startPresence(ctx, auth, presenceBridge); ctx.subscriptions.push(presence);
	follow = (userId: string) => { followingUserId = userId; presenceBridge.follow(userId); for (const view of presenceViews) void view.postMessage({ type: 'presence', people: presencePeople(), followingUserId }); };
	stopFollowing = () => { followingUserId = undefined; presenceBridge.stopFollowing(); for (const view of presenceViews) void view.postMessage({ type: 'presence', people: presencePeople(), followingUserId }); };
	(ctx.subscriptions as vscode.Disposable[]).push(vscode.window.registerFileDecorationProvider({
		onDidChangeFileDecorations: decorationEvent.event,
		provideFileDecoration(uri, _token) { const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; return presenceDecorationProvider(presenceRows, u => root ? path.relative(root, u.fsPath).split(path.sep).join('/') : '').provideFileDecoration(uri, _token); },
	}));
	const applyLayout = () => {
		pushTitlebar();
		if (mode() === 'team') {
			vscode.commands.executeCommand('workbench.view.extension.codeler-chat');
		} else {
			vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
			vscode.commands.executeCommand('workbench.action.terminal.focus');
		}
	};
	applyLayout();
	auth.init();

	let teamPanel: vscode.WebviewPanel | undefined;
	ctx.subscriptions.push(
		connected, people, ...tagTypes,
		vscode.commands.registerCommand('codeler.createTeam', () => {
			// Image 3: the Team page fills the window, the side bar hides and the activity bar shows labels.
			const expand = (on: boolean) => {
				teamPageActive = on;
				pushTitlebar();
				vscode.commands.executeCommand('_codeler.activitybar.setExpanded', on).then(undefined, () => { /* stock VSCodium */ });
			};
			vscode.commands.executeCommand('workbench.action.closeSidebar');
			vscode.commands.executeCommand('workbench.action.closePanel');
			vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
			expand(true);
			if (teamPanel) return teamPanel.reveal();
			teamPanel = vscode.window.createWebviewPanel('codeler.team', 'Create your team', vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media')] });
			teamPanel.iconPath = new vscode.ThemeIcon('organization');
			teamPanel.onDidChangeViewState(e => expand(e.webviewPanel.active));
			const teamWebview = teamPanel.webview; // a disposed panel's .webview throws, so keep our own reference
			teamPanel.onDidDispose(() => { presenceViews.delete(teamWebview); teamPanel = undefined; expand(false); });
			 render(ctx, teamWebview, 'team', teams, auth);
		}),
		vscode.commands.registerCommand('codeler.share', () => vscode.window.showInformationMessage('Sharing your preview works once teams are connected.')),
		vscode.commands.registerCommand('codeler.toggleSampleCursors', () => { showCursors = !showCursors; paintCursors(); }),
		vscode.commands.registerCommand('codeler.pickProject', async () => {
			const mine = auth.me ? await teams.mine().catch(() => []) : [];
			const picks = mine.flatMap(t => (t.projects ?? []).map(p => ({ label: p.name, description: t.name, id: p.id })));
			const pick = await vscode.window.showQuickPick([...picks, { label: '$(folder-opened) Open a folder on this PC…', description: '', id: '' }], { placeHolder: 'Switch project' });
			if (pick?.label.startsWith('$(folder-opened)')) return void vscode.commands.executeCommand('workbench.action.files.openFolder');
			if (pick?.id) { await vscode.workspace.getConfiguration('codeler').update('projectId', pick.id, vscode.ConfigurationTarget.Global); await vscode.workspace.getConfiguration('codeler').update('projectName', pick.label, vscode.ConfigurationTarget.Global); await vscode.commands.executeCommand('workbench.action.reloadWindow'); }
		}),
		vscode.commands.registerCommand('codeler.joinTeam', async (args?: { joinCode?: string; password?: string }) => args?.joinCode && args.password ? teams.join(cleanJoin(args.joinCode, args.password).joinCode, args.password) : undefined),
		vscode.commands.registerCommand('codeler.pickBranch', () => vscode.window.showInformationMessage('Version history comes with the Changes view.')),
		vscode.commands.registerCommand('codeler.notifications', () => vscode.commands.executeCommand('notifications.showList')),
		vscode.commands.registerCommand('codeler.signIn', () => auth.signIn()),
		vscode.commands.registerCommand('codeler.signOut', () => auth.signOut()),
		vscode.commands.registerCommand('codeler.account', async () => {
			if (!auth.me) return auth.signIn();
			const pick = await vscode.window.showQuickPick([{ label: '$(sign-out) Sign out', id: 'out' }], { placeHolder: `Signed in as ${auth.me.email}` });
			if (pick?.id === 'out') await auth.signOut();
		}),
		auth.onDidChange(() => { currentUserId = auth.me?.id; pushTitlebar(); paintCursors(); }),
		vscode.commands.registerCommand('codeler.switchLayoutPreview', async () => {
			await vscode.workspace.getConfiguration('codeler').update('layoutPreview', mode() === 'team' ? 'solo' : 'team', vscode.ConfigurationTarget.Global);
		}),
		vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('codeler.layoutPreview')) applyLayout(); }),
		vscode.window.onDidChangeActiveTextEditor(e => paintCursors(e)),
	);
}

export function deactivate() { }
