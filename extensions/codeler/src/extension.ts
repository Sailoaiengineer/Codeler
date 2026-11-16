import * as vscode from 'vscode';
import { sample } from './sample';
import { Auth } from './auth';

// Panels are plain HTML files in media/; each gets the shared stylesheet and a strict CSP.
class Panel implements vscode.WebviewViewProvider {
	constructor(private ctx: vscode.ExtensionContext, private page: string) { }
	resolveWebviewView(view: vscode.WebviewView) {
		render(this.ctx, view.webview, this.page);
	}
}

function render(ctx: vscode.ExtensionContext, webview: vscode.Webview, page: string) {
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
	webview.onDidReceiveMessage((m: { type: string; file?: string; line?: number; text?: string }) => {
		if (m.type === 'openLine' && m.file) {
			// shortcut: sample links resolve inside the first workspace folder only, until real project paths come from Convex
			const root = vscode.workspace.workspaceFolders?.[0]?.uri;
			if (root) vscode.window.showTextDocument(vscode.Uri.joinPath(root, m.file), { selection: new vscode.Range((m.line ?? 1) - 1, 0, (m.line ?? 1) - 1, 0) });
		} else if (m.type === 'close') {
			vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		} else if (m.type === 'notReady') {
			vscode.window.showInformationMessage(`${m.text} works once login and teams are connected.`);
		}
	});
}

// Name-tag cursors as in the reference image: a coloured caret plus a label after the line.
const tagTypes = sample.people.map(p => vscode.window.createTextEditorDecorationType({
	borderStyle: 'solid', borderColor: p.color, borderWidth: '0 0 0 2px',
	after: { contentText: p.name, backgroundColor: p.color, color: '#ffffff', margin: '0 0 0 4px', fontWeight: '600', textDecoration: ';font-size:12px;padding:1px 6px;border-radius:4px;font-family:Inter,Segoe UI,sans-serif' },
}));
let showCursors = false;
function paintCursors(editor = vscode.window.activeTextEditor) {
	if (!editor) return;
	sample.people.forEach((p, i) => {
		const line = Math.min(p.cursorLine - 1, editor.document.lineCount - 1);
		const end = editor.document.lineAt(Math.max(line, 0)).range.end;
		editor.setDecorations(tagTypes[i], showCursors && line >= 0 ? [new vscode.Range(end, end)] : []);
	});
}

export function activate(ctx: vscode.ExtensionContext) {
	const auth = new Auth(ctx.secrets);
	for (const [id, page] of [['codeler.chat', 'chat'], ['codeler.activity', 'activity'], ['codeler.collaborators', 'collaborators'], ['codeler.workspaces', 'workspaces']])
		ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(id, new Panel(ctx, page), { webviewOptions: { retainContextWhenHidden: true } }));
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
	const pushTitlebar = () => {
		const team = mode() === 'team';
		const root = vscode.workspace.workspaceFolders?.[0];
		vscode.commands.executeCommand('_codeler.titlebar.setState', {
			mode: mode(),
			project: team ? sample.teams[0].name : root?.name ?? 'Open project',
			branch: 'main',
			people: team ? sample.people : [],
			unread: team ? 1 : 0,
			page: teamPageActive ? 'team' : undefined,
			account: auth.me ? { name: auth.me.name, photo: auth.me.image ?? undefined } : undefined,
			dirty: vscode.workspace.textDocuments.some(d => d.isDirty),
		}).then(undefined, () => { /* running in stock VSCodium: no Codeler title bar to fill */ });
		team ? people.show() : people.hide();
		showCursors = team;
		paintCursors();
	};
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
			teamPanel.onDidDispose(() => { teamPanel = undefined; expand(false); });
			render(ctx, teamPanel.webview, 'team');
		}),
		vscode.commands.registerCommand('codeler.share', () => vscode.window.showInformationMessage('Sharing your preview works once teams are connected.')),
		vscode.commands.registerCommand('codeler.run', () => vscode.commands.executeCommand('workbench.action.debug.run')),
		vscode.commands.registerCommand('codeler.toggleSampleCursors', () => { showCursors = !showCursors; paintCursors(); }),
		vscode.commands.registerCommand('codeler.pickProject', async () => {
			const pick = await vscode.window.showQuickPick([...sample.teams.flatMap(t => t.projects.map(p => ({ label: p, description: t.name }))), { label: '$(folder-opened) Open a folder on this PC…', description: '' }], { placeHolder: 'Switch project' });
			if (pick?.label.startsWith('$(folder-opened)')) vscode.commands.executeCommand('workbench.action.files.openFolder');
		}),
		vscode.commands.registerCommand('codeler.pickBranch', () => vscode.window.showInformationMessage('Version history comes with the Changes view.')),
		vscode.commands.registerCommand('codeler.notifications', () => vscode.commands.executeCommand('notifications.showList')),
		vscode.commands.registerCommand('codeler.signIn', () => auth.signIn()),
		vscode.commands.registerCommand('codeler.signOut', () => auth.signOut()),
		vscode.commands.registerCommand('codeler.account', async () => {
			if (!auth.me) return auth.signIn();
			const pick = await vscode.window.showQuickPick([{ label: '$(sign-out) Sign out', id: 'out' }], { placeHolder: `Signed in as ${auth.me.email}` });
			if (pick?.id === 'out') await auth.signOut();
		}),
		auth.onDidChange(() => pushTitlebar()),
		vscode.commands.registerCommand('codeler.switchLayoutPreview', async () => {
			await vscode.workspace.getConfiguration('codeler').update('layoutPreview', mode() === 'team' ? 'solo' : 'team', vscode.ConfigurationTarget.Global);
		}),
		vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('codeler.layoutPreview')) applyLayout(); }),
		vscode.window.onDidChangeActiveTextEditor(e => paintCursors(e)),
	);
}

export function deactivate() { }
