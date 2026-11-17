// Codeler version history: the "Changes" view, snapshot commands and the editor gutter. Logic lives in ./logic.
import * as vscode from 'vscode';
import { recordActivity } from '../activity';
import { isSafeRelativePath } from '../sync/safety';
import { Change, currentFiles, diff, listSnapshots, readBlob, relativeTime, restoreSnapshot, saveSnapshot, Snapshot } from './logic';

const SCHEME = 'codeler-history';
const LABEL: Record<Change['status'], string> = { A: 'Added', M: 'Modified', D: 'Deleted' };
const COLOR: Record<Change['status'], string> = { A: 'gitDecoration.addedResourceForeground', M: 'gitDecoration.modifiedResourceForeground', D: 'gitDecoration.deletedResourceForeground' };

export function startHistory(_ctx: vscode.ExtensionContext): vscode.Disposable {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		// No folder open: commands exist but do nothing.
		return vscode.Disposable.from(...['codeler.saveSnapshot', 'codeler.history', 'codeler.restoreSnapshot'].map(id => vscode.commands.registerCommand(id, () => undefined)));
	}
	const rootUri = folder.uri;
	const root = rootUri.fsPath;
	const fileUri = (rel: string) => vscode.Uri.joinPath(rootUri, ...rel.split('/'));
	const relOf = (uri: vscode.Uri) => uri.scheme === 'file' && uri.fsPath.startsWith(root) ? vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/') : undefined;
	// sha in the query; empty query means "no file" (the empty side of an added/deleted diff).
	const historyUri = (rel: string, sha = '') => vscode.Uri.from({ scheme: SCHEME, path: '/' + rel, query: sha });

	let latest: Snapshot | undefined;
	let changes = new Map<string, Change['status']>();
	const decoChanged = new vscode.EventEmitter<vscode.Uri[]>();

	const sc = vscode.scm.createSourceControl('codeler', 'Changes', rootUri);
	sc.inputBox.placeholder = 'Snapshot name';
	sc.acceptInputCommand = { command: 'codeler.saveSnapshot', title: 'Save snapshot' };
	sc.quickDiffProvider = { provideOriginalResource: uri => { const rel = relOf(uri); const sha = rel && latest?.files[rel]; return sha ? historyUri(rel, sha) : undefined; } };
	const group = sc.createResourceGroup('changes', 'Changes');
	group.hideWhenEmpty = false;

	const diffArgs = (rel: string, status: Change['status'], snapshot?: Snapshot) => {
		const left = historyUri(rel, snapshot?.files[rel]);
		const right = status === 'D' ? historyUri(rel) : fileUri(rel);
		return { left, right, title: `${rel.split('/').pop()} (${LABEL[status].toLowerCase()} since ${snapshot ? `'${snapshot.message}'` : 'no snapshot'})` };
	};

	const refresh = async () => {
		try {
			latest = (await listSnapshots(root))[0];
			const list = diff(latest?.files, await currentFiles(root));
			const old = [...changes.keys()];
			changes = new Map(list.map(c => [c.path, c.status]));
			group.resourceStates = list.map(c => {
				const { left, right, title } = diffArgs(c.path, c.status, latest);
				return {
					resourceUri: fileUri(c.path),
					decorations: { strikeThrough: c.status === 'D', faded: c.status === 'D', tooltip: LABEL[c.status] },
					command: { command: 'vscode.diff', title: 'Open changes', arguments: [left, right, title] },
				};
			});
			sc.count = list.length;
			decoChanged.fire([...new Set([...old, ...changes.keys()])].map(fileUri));
		} catch (e) {
			console.error('[codeler history] refresh failed', e);
		}
	};
	let timer: ReturnType<typeof setTimeout> | undefined;
	const scheduleRefresh = (uri?: vscode.Uri) => {
		if (uri && /[\\/](node_modules|\.git|\.codeler|dist|out|\.next)([\\/]|$)/.test(uri.fsPath.slice(root.length))) { return; }
		clearTimeout(timer); timer = setTimeout(refresh, 300);
	};

	const pickSnapshot = async (placeHolder: string): Promise<Snapshot | undefined> => {
		const snaps = await listSnapshots(root);
		if (!snaps.length) { vscode.window.showInformationMessage('No snapshots yet. Name one in the Changes view and press Ctrl+Enter.'); return; }
		const items = snaps.map((s, i) => {
			const n = diff(snaps[i + 1]?.files, s.files).length;
			return { label: s.message || '(no name)', description: relativeTime(s.createdAt), detail: `${n} file${n === 1 ? '' : 's'} changed`, snapshot: s };
		});
		return (await vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true }))?.snapshot;
	};

	const save = async () => {
		let message = sc.inputBox.value.trim();
		if (!message) {
			message = (await vscode.window.showInputBox({ prompt: 'Name this snapshot', placeHolder: 'Snapshot name', validateInput: v => v.trim() ? undefined : 'Type a name for the snapshot.' }))?.trim() ?? '';
			if (!message) { return; }
		}
		try {
			await saveSnapshot(root, message);
			void recordActivity('snapshot', message);
			sc.inputBox.value = '';
			vscode.window.setStatusBarMessage(`Snapshot '${message}' saved`, 3000);
		} catch (e) {
			vscode.window.showErrorMessage(`Couldn't save the snapshot: ${(e as Error).message}. Check that the project folder can be written to, then try again.`);
		}
		await refresh();
	};

	const restore = async (snapshot?: Snapshot) => {
		snapshot ??= await pickSnapshot('Pick a snapshot to restore');
		if (!snapshot) { return; }
		// Manifests can come from a cloned repo, so every path gets the shared project rule before anything is written.
		const bad = Object.keys(snapshot.files).find(p => !isSafeRelativePath(p));
		if (bad) { vscode.window.showErrorMessage(`Couldn't restore '${snapshot.message}': the snapshot contains a path that isn't allowed: ${bad}`); return; }
		const ok = await vscode.window.showWarningMessage(`Restore '${snapshot.message}'? Your current files will be replaced.`,
			{ modal: true, detail: 'A snapshot of your current work is saved first so you can undo this.' }, 'Restore');
		if (ok !== 'Restore') { return; }
		try {
			await vscode.workspace.saveAll(false);
			await restoreSnapshot(root, snapshot);
			vscode.window.setStatusBarMessage(`Restored '${snapshot.message}'`, 3000);
		} catch (e) {
			vscode.window.showErrorMessage(`Couldn't restore '${snapshot.message}': ${(e as Error).message}. Your work was saved as 'Before restoring ${snapshot.message}' if that step finished. Open history to check.`);
		}
		await refresh();
	};

	const compare = async (snapshot: Snapshot) => {
		const list = diff(snapshot.files, await currentFiles(root));
		if (!list.length) { vscode.window.showInformationMessage(`Your files match '${snapshot.message}'.`); return; }
		const resources = list.map(c => { const { left, right } = diffArgs(c.path, c.status, snapshot); return [fileUri(c.path), left, right]; });
		await vscode.commands.executeCommand('vscode.changes', `'${snapshot.message}' ↔ current files`, resources);
	};

	const history = async () => {
		const snapshot = await pickSnapshot('Version history');
		if (!snapshot) { return; }
		const action = await vscode.window.showQuickPick(['Restore this snapshot', 'Compare with current'], { placeHolder: snapshot.message });
		if (action === 'Restore this snapshot') { await restore(snapshot); }
		else if (action === 'Compare with current') { await compare(snapshot); }
	};

	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
	void refresh();
	return vscode.Disposable.from(
		sc, decoChanged, watcher,
		vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
			provideTextDocumentContent: async uri => uri.query ? String(await readBlob(root, uri.query)) : '',
		}),
		vscode.window.registerFileDecorationProvider({
			onDidChangeFileDecorations: decoChanged.event,
			provideFileDecoration: uri => {
				const rel = relOf(uri); const status = rel && changes.get(rel);
				return status ? { badge: status, tooltip: LABEL[status], color: new vscode.ThemeColor(COLOR[status]) } : undefined;
			},
		}),
		watcher.onDidCreate(scheduleRefresh), watcher.onDidChange(scheduleRefresh), watcher.onDidDelete(scheduleRefresh),
		vscode.workspace.onDidSaveTextDocument(d => scheduleRefresh(d.uri)),
		vscode.workspace.onDidRenameFiles(() => scheduleRefresh()),
		vscode.commands.registerCommand('codeler.saveSnapshot', save),
		vscode.commands.registerCommand('codeler.history', history),
		vscode.commands.registerCommand('codeler.restoreSnapshot', (s?: Snapshot) => restore(s?.files ? s : undefined)),
		{ dispose: () => clearTimeout(timer) },
	);
}
