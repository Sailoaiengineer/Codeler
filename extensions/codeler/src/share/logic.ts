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
