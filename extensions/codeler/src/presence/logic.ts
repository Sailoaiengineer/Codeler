export const TAG_COLORS = ['#3fbf5c', '#2684f5', '#f2842b', '#b26bd1'];
export type Presence = { userId: string; name: string; image?: string | null; path: string; line: number; character: number; selection: { startLine: number; startCharacter: number; endLine: number; endCharacter: number } };

export function colorFor(userId: string) {
	let hash = 0; for (const c of userId) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
	return TAG_COLORS[hash % TAG_COLORS.length];
}
export function throttle<T extends (...args: any[]) => void>(fn: T, wait: number) {
	let timer: ReturnType<typeof setTimeout> | undefined; let last = 0;
	return (...args: Parameters<T>) => { const delay = Math.max(0, wait - (Date.now() - last)); clearTimeout(timer); timer = setTimeout(() => { last = Date.now(); fn(...args); }, delay); };
}
export function fileDecorations(rows: Presence[]) {
	const out = new Map<string, { initials: string; color: string }[]>();
	for (const row of rows) { const initials = row.name.split(/\s+/).map(s => s[0] ?? '').join('').slice(0, 2).toUpperCase(); const values = out.get(row.path) ?? []; values.push({ initials, color: colorFor(row.userId) }); out.set(row.path, values); }
	return out;
}
export function followTarget(current: { userId: string; active: boolean } | undefined, action: 'follow' | 'stop', userId?: string) {
	if (action === 'stop') return undefined;
	if (!userId) return current;
	return { userId, active: true };
}
