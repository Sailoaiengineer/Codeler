// Pure chat and activity rules. No imports: this file is also run directly by node --test.

export const MAX_MESSAGE = 4000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain', 'application/pdf', 'application/zip'];
const SEND_LIMIT = 30;
const SEND_WINDOW_MS = 60_000;
const TAG_COLORS = ['#3fbf5c', '#2684f5', '#f2842b', '#b26bd1'];

export type ChatRow = { _id: string; userId: string; name: string; text: string; createdAt: number; attachment: { name: string; type: string; size: number; url: string | null } | null };
export type ActivityRow = { _id: string; userId: string; name: string; kind: ActivityKind; detail: string; createdAt: number };
export type ActivityKind = 'joined' | 'left' | 'approved' | 'file_created' | 'file_changed' | 'file_deleted' | 'file_renamed' | 'run' | 'snapshot';

const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

// Finds @Name mentions of the given member names. Longer names win, so "@Sam Lee" does not also ping "Sam".
// Convex keeps a copy of this rule (web/convex/chat.ts); change both together.
export function mentionedNames(text: string, names: string[]): string[] {
	let rest = text.toLowerCase();
	const found = new Set<string>();
	for (const name of [...names].sort((a, b) => b.length - a.length)) {
		const needle = '@' + name.toLowerCase();
		if (needle.length < 2) continue;
		for (let at = rest.indexOf(needle); at !== -1; at = rest.indexOf(needle, at + needle.length)) {
			if (isWord(rest[at - 1]) || isWord(rest[at + needle.length])) continue;
			found.add(name);
			rest = rest.slice(0, at) + ' '.repeat(needle.length) + rest.slice(at + needle.length);
		}
	}
	return names.filter(n => found.has(n));
}

/** Returns the reason a message can't be sent, or undefined when it can. */
export function messageError(text: string): string | undefined {
	const length = text.trim().length;
	return length < 1 || length > MAX_MESSAGE ? `Messages need 1 to ${MAX_MESSAGE} characters.` : undefined;
}

export function fileError(file: { type: string; size: number }): string | undefined {
	if (file.size > MAX_FILE_BYTES) return 'Files can be up to 10 MB.';
	if (!FILE_TYPES.includes(file.type)) return 'That file type isn\'t allowed.';
	return undefined;
}

/** Sliding window: returns the send times with `now` added, or undefined when the user is over the limit. */
export function admitSend(sentAt: number[], now: number, limit = SEND_LIMIT, windowMs = SEND_WINDOW_MS): number[] | undefined {
	const recent = sentAt.filter(t => t > now - windowMs);
	if (recent.length >= limit) return undefined;
	return [...recent, now];
}

export function colorFor(userId: string) {
	let hash = 0; for (const c of userId) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
	return TAG_COLORS[hash % TAG_COLORS.length];
}

export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase();

export function clockLabel(ms: number) {
	return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** A Convex message as the chat panel draws it. */
export function panelMessage(row: ChatRow, me?: string) {
	return {
		id: row._id, who: row.name, initials: initialsOf(row.name), color: colorFor(row.userId),
		text: row.text, time: clockLabel(row.createdAt), mine: row.userId === me,
		attachment: row.attachment,
	};
}

const VERBS: Record<ActivityKind, string> = {
	joined: 'joined', left: 'left', approved: 'was approved to join', file_created: 'created', file_changed: 'edited',
	file_deleted: 'deleted', file_renamed: 'renamed', run: 'ran', snapshot: 'saved a snapshot of',
};

/** One activity row as a plain sentence: "Sam" + "edited src/app.ts". */
export function panelActivity(row: ActivityRow) {
	return {
		who: row.name, initials: initialsOf(row.name), color: colorFor(row.userId),
		text: `${VERBS[row.kind]} ${row.detail}`, time: clockLabel(row.createdAt),
	};
}
