import * as vscode from 'vscode';
import { execFile, spawn, ChildProcess } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import { cloudflaredArgs, cloudflaredCandidates, cloudflaredUrl, candidatePorts, describeService, nextState, parseTitle, shareMinutes, shouldAutoStop, ShareState } from './logic';

type Process = ChildProcess & { kill?: (signal?: NodeJS.Signals | number) => boolean };
const needsCloudflared = 'Preview sharing needs cloudflared.';

// Returns what answers on the port (title or Server header), or undefined when nothing does.
async function probe(port: number): Promise<{ title?: string; server?: string } | undefined> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 1000);
	try {
		const response = await fetch(`http://127.0.0.1:${port}`, { signal: controller.signal });
		if (!response.ok) return undefined;
		return { title: parseTitle(await response.text()), server: response.headers.get('server') ?? undefined };
	} catch { return undefined; }
	finally { clearTimeout(timer); }
}

async function findPort(): Promise<{ port: number; service: string } | undefined> {
	const output = vscode.window.terminals.map(t => t.name).join('\n');
	for (const port of candidatePorts(output)) {
		const info = await probe(port);
		if (info) return { port, service: describeService(info) };
	}
	return undefined;
}

// Looks in PATH folders (absolute ones only) and the usual install folders. The open project folder is never searched.
async function executable(): Promise<string> {
	if (process.platform !== 'win32') return 'cloudflared';
	const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((value): value is string => Boolean(value));
	for (const file of cloudflaredCandidates(process.env.PATH ?? '', programFiles)) {
		try { await fsp.access(file); return file; } catch { /* keep looking */ }
	}
	throw new Error(needsCloudflared);
}

function killTree(child: Process): Promise<void> {
	if (!child.pid) return Promise.resolve();
	if (process.platform === 'win32') return new Promise(resolve => execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => { child.kill?.(); resolve(); }));
	child.kill?.('SIGTERM');
	return Promise.resolve();
}

export function startShare(ctx: vscode.ExtensionContext, onChange?: (sharing: boolean) => void): vscode.Disposable {
	let state: ShareState = 'idle';
	let child: Process | undefined;
	let port: number | undefined;
	let status: vscode.StatusBarItem | undefined;
	let poll: ReturnType<typeof setInterval> | undefined;
	let failedSince: number | undefined;

	const stop = async () => {
		if (state === 'idle' || state === 'stopping') return;
		state = nextState(state, 'stop');
		if (poll) clearInterval(poll);
		poll = undefined; failedSince = undefined;
		if (child) await killTree(child);
		child = undefined; port = undefined;
		status?.dispose(); status = undefined;
		state = nextState(state, 'stopped');
		onChange?.(false);
	};

	const start = async () => {
		if (state !== 'idle') return void stop();
		const found = await findPort();
		if (!found) return void vscode.window.showInformationMessage('Start your site with Run first.');
		const selected = found.port;
		const choice = await vscode.window.showWarningMessage(`Share http://localhost:${selected}? It is ${found.service}. Anyone with the link can open it while sharing is on.`, { modal: true }, 'Share', 'Cancel');
		if (choice !== 'Share') return;
		state = nextState(state, 'start'); port = selected;
		const maxMinutes = shareMinutes(vscode.workspace.getConfiguration('codeler').get<unknown>('share.maxMinutes', 120));
		const startedAt = Date.now();
		try {
			const command = await executable();
			child = spawn(command, cloudflaredArgs(selected), { shell: false, windowsHide: true }) as Process;
			let output = '';
			const url = await new Promise<string>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('cloudflared did not provide a public link within 30 seconds.')), 30000);
				const onData = (chunk: Buffer) => { output += chunk.toString(); const link = cloudflaredUrl(output); if (link) { clearTimeout(timer); resolve(link); } };
				child?.stdout?.on('data', onData); child?.stderr?.on('data', onData);
				child?.once('error', reject); child?.once('exit', code => code ? reject(new Error(`cloudflared exited with code ${code}.`)) : undefined);
			});
			state = nextState(state, 'started');
			onChange?.(true);
			status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 998);
			status.text = `$(broadcast) Sharing ${selected}`; status.tooltip = 'Stop preview sharing'; status.command = 'codeler.share'; status.show();
			await vscode.env.clipboard.writeText(url);
			vscode.window.showInformationMessage(`Preview link copied to the clipboard: ${url}`);
			poll = setInterval(async () => {
				if (shouldAutoStop(startedAt, Date.now(), maxMinutes)) {
					await stop();
					void vscode.window.showInformationMessage(`Preview sharing stopped after ${maxMinutes} minutes. Start it again to share.`);
					return;
				}
				if (await probe(selected)) failedSince = undefined; else if (!failedSince) failedSince = Date.now(); else if (Date.now() - failedSince >= 30000) await stop();
			}, 5000);
		} catch (error) {
			await killTree(child ?? {} as Process); child = undefined; state = nextState(state, 'failed'); state = nextState(state, 'stopped'); onChange?.(false);
			const message = error instanceof Error && error.message === needsCloudflared ? needsCloudflared : error instanceof Error ? error.message : 'Could not start preview sharing.';
			const action = await vscode.window.showErrorMessage(message, ...(message === needsCloudflared ? ['Install cloudflared'] : []));
			if (action === 'Install cloudflared') void vscode.env.openExternal(vscode.Uri.parse('https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'));
		}
	};

	const disposable = vscode.commands.registerCommand('codeler.share', () => start());
	return vscode.Disposable.from(disposable, new vscode.Disposable(() => { void stop(); }));
}
