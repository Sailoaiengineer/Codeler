import * as vscode from 'vscode';
import { execFile, spawn, ChildProcess } from 'node:child_process';
import { cloudflaredArgs, cloudflaredUrl, candidatePorts, nextState, ShareState } from './logic';

type Process = ChildProcess & { kill?: (signal?: NodeJS.Signals | number) => boolean };

async function answers(port: number): Promise<boolean> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 1000);
	try { const response = await fetch(`http://127.0.0.1:${port}`, { signal: controller.signal }); return response.ok; }
	catch { return false; }
	finally { clearTimeout(timer); }
}

async function findPort(): Promise<number | undefined> {
	const output = vscode.window.terminals.map(t => t.name).join('\n');
	for (const port of candidatePorts(output)) if (await answers(port)) return port;
	return undefined;
}

function executable(): Promise<string> {
	if (process.platform !== 'win32') return Promise.resolve('cloudflared');
	return new Promise((resolve, reject) => execFile('where', ['cloudflared.exe'], (error, stdout) => error ? reject(error) : resolve(stdout.split(/\r?\n/)[0].trim())));
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
		const selected = await findPort();
		if (!selected) return void vscode.window.showInformationMessage('Start your site with Run first.');
		const choice = await vscode.window.showWarningMessage(`Anyone with the link can open your site while sharing is on. Share http://localhost:${selected}?`, { modal: true }, 'Share', 'Cancel');
		if (choice !== 'Share') return;
		state = nextState(state, 'start'); port = selected;
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
			poll = setInterval(async () => { if (await answers(selected)) failedSince = undefined; else if (!failedSince) failedSince = Date.now(); else if (Date.now() - failedSince >= 30000) await stop(); }, 5000);
		} catch (error) {
			await killTree(child ?? {} as Process); child = undefined; state = nextState(state, 'failed'); state = nextState(state, 'stopped'); onChange?.(false);
			const message = error instanceof Error && error.message.includes('where') ? 'Preview sharing needs cloudflared.' : error instanceof Error ? error.message : 'Could not start preview sharing.';
			const action = await vscode.window.showErrorMessage(message, ...(message === 'Preview sharing needs cloudflared.' ? ['Install cloudflared'] : []));
			if (action === 'Install cloudflared') void vscode.env.openExternal(vscode.Uri.parse('https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'));
		}
	};

	const disposable = vscode.commands.registerCommand('codeler.share', () => start());
	return vscode.Disposable.from(disposable, new vscode.Disposable(() => { void stop(); }));
}
