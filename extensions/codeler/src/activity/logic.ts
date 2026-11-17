// Pure rules for activity events. No imports of repo files, so tests can run it directly.

export type ActivityKind = 'file_created' | 'file_changed' | 'file_deleted' | 'file_renamed' | 'run' | 'snapshot';

export const CHANGE_WINDOW_MS = 5 * 60 * 1000;
export const MAX_DETAIL = 300;

/** One file_changed per file per window. Edits inside the window are dropped, not queued. */
export function admitChange(last: Map<string, number>, file: string, now: number): boolean {
	const previous = last.get(file);
	if (previous !== undefined && now - previous < CHANGE_WINDOW_MS) return false;
	last.set(file, now);
	return true;
}

/** The server rejects details outside 1 to 300 characters; long paths are cut rather than dropped. */
export function activityDetail(text: string): string | undefined {
	const value = text.trim().slice(0, MAX_DETAIL);
	return value.length ? value : undefined;
}
