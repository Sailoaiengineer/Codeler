export type ShareState = 'idle' | 'starting' | 'sharing' | 'stopping';

const commonPorts = [3000, 5173, 4321, 8000, 8080];

export function parsePorts(lines: string): number[] {
	const found = new Set<number>();
	for (const match of lines.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))?/gi)) {
		const port = Number(match[1]);
		if (port >= 1 && port <= 65535) found.add(port);
	}
	return [...found];
}

export function candidatePorts(terminalOutput: string): number[] {
	return [...new Set([...parsePorts(terminalOutput), ...commonPorts])];
}

export function cloudflaredUrl(output: string): string | undefined {
	const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com(?:[^\s]*)?/i);
	return match?.[0].replace(/[),.;]+$/, '');
}

export function cloudflaredArgs(port: number): string[] {
	return ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'];
}

export function nextState(current: ShareState, event: 'start' | 'started' | 'stop' | 'stopped' | 'failed'): ShareState {
	if (event === 'start' && current === 'idle') return 'starting';
	if (event === 'started' && current === 'starting') return 'sharing';
	if ((event === 'stop' || event === 'failed') && (current === 'starting' || current === 'sharing')) return 'stopping';
	if (event === 'stopped') return 'idle';
	return current;
}

export const sharePorts = commonPorts;

// Title from the first part of an HTML page. Control characters are removed and the text is kept short.
export function parseTitle(html: string): string | undefined {
	const match = html.slice(0, 20000).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const title = match?.[1].replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
	return title || undefined;
}

// What the consent dialog shows: the page title, else the Server header, else a plain fallback.
export function describeService(info: { title?: string; server?: string } | undefined): string {
	if (info?.title) return `"${info.title}"`;
	if (info?.server) return `a server (${info.server.slice(0, 80)})`;
	return 'an unknown service';
}

export const defaultShareMinutes = 120;

// Keeps the codeler.share.maxMinutes setting in a sane range.
export function shareMinutes(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.min(1440, Math.max(1, Math.floor(value))) : defaultShareMinutes;
}

export function shouldAutoStop(startedAt: number, now: number, maxMinutes: number): boolean {
	return now - startedAt >= maxMinutes * 60_000;
}

// Only absolute Windows folders from PATH count. Relative entries (such as "." or "bin") would resolve against the open folder.
export function cloudflaredCandidates(pathValue: string, programFiles: string[]): string[] {
	const folders = [...pathValue.split(';'), ...programFiles.map(folder => `${folder}\\cloudflared`)];
	const files = folders
		.map(folder => folder.trim().replace(/^"(.*)"$/, '$1'))
		.filter(folder => /^[A-Za-z]:[\\/]/.test(folder) || folder.startsWith('\\\\'))
		.map(folder => `${folder.replace(/[\\/]+$/, '')}\\cloudflared.exe`);
	return [...new Set(files)];
}
