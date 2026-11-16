import * as Y from 'yjs';

// No imports of sibling files here: Node's test runner needs '.ts' paths, the compiled extension needs none.

export function textDiff(before: string, after: string): { index: number; deleteCount: number; insert: string } | undefined {
	if (before === after) return undefined;
	let start = 0; while (start < before.length && start < after.length && before[start] === after[start]) start++;
	let endBefore = before.length, endAfter = after.length;
	while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
	return { index: start, deleteCount: endBefore - start, insert: after.slice(start, endAfter) };
}

export type ServerState = { exists: boolean; snapshot?: Uint8Array; updates: Uint8Array[] };

/** Hydrates from the server exactly once, then turns offline disk differences into a normal Yjs edit. */
export function loadDocument(server: ServerState, disk: string): { doc: Y.Doc; text: Y.Text; seeded: boolean; offlineUpdate?: Uint8Array } {
	const doc = new Y.Doc(); const text = doc.getText('file');
	if (!server.exists) { text.insert(0, disk); return { doc, text, seeded: true }; }
	if (server.snapshot?.byteLength) Y.applyUpdate(doc, server.snapshot);
	for (const update of server.updates) Y.applyUpdate(doc, update);
	const diff = textDiff(text.toString(), disk);
  if (diff) { const vector = Y.encodeStateVector(doc); doc.transact(() => { text.delete(diff.index, diff.deleteCount); text.insert(diff.index, diff.insert); }, 'offline'); return { doc, text, seeded: false, offlineUpdate: Y.encodeStateAsUpdate(doc, vector) }; }
  return { doc, text, seeded: false };
}

export function applyContentChanges(text: Y.Text, changes: ReadonlyArray<{ rangeOffset: number; rangeLength: number; text: string }>) {
	text.doc?.transact(() => { for (const change of changes) { text.delete(change.rangeOffset, change.rangeLength); text.insert(change.rangeOffset, change.text); } }, 'local');
}

export class PendingUpdates {
	private pending: Uint8Array[] = [];
	add(update: Uint8Array) { this.pending.push(update); }
	get length() { return this.pending.length; }
	 takeMerged(): Uint8Array | undefined { if (!this.pending.length) return undefined; const merged = Y.mergeUpdates(this.pending); this.pending = []; return merged; }
	restore(update: Uint8Array) { this.pending.unshift(update); }
}

export function applyRemoteDelta(before: string, after: string): { index: number; deleteCount: number; insert: string } | undefined { return textDiff(before, after); }

/** Brings the shared text in line with the editor's full text. Returns false when they already match
 *  (e.g. the editor change was our own remote edit), so remote edits never echo back as local ones. */
export function applyEditorText(text: Y.Text, next: string): boolean {
	const diff = textDiff(text.toString(), next);
	if (!diff) return false;
	text.doc?.transact(() => { text.delete(diff.index, diff.deleteCount); text.insert(diff.index, diff.insert); }, 'local');
	return true;
}
