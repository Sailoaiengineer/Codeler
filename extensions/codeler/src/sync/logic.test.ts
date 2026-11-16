import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { applyContentChanges, applyEditorText, loadDocument, PendingUpdates } from './logic.ts';

const update = (doc: Y.Doc) => Y.encodeStateAsUpdate(doc);

test('two clients load the same server state exactly once', () => {
	const source = new Y.Doc(); source.getText('file').insert(0, 'same text'); const state = { exists: true, snapshot: update(source), updates: [] };
	assert.equal(loadDocument(state, 'same text').text.toString(), 'same text');
	assert.equal(loadDocument(state, 'same text').text.toString(), 'same text');
});
test('offline disk edits are applied once on top of server state', () => {
	const source = new Y.Doc(); source.getText('file').insert(0, 'server');
	assert.equal(loadDocument({ exists: true, snapshot: update(source), updates: [] }, 'server + offline').text.toString(), 'server + offline');
});
test('VS Code content changes, including multi-cursor changes, match the editor text', () => {
	const doc = new Y.Doc(); const text = doc.getText('file'); text.insert(0, 'abcd');
	applyContentChanges(text, [{ rangeOffset: 0, rangeLength: 1, text: 'A' }, { rangeOffset: 2, rangeLength: 1, text: 'C' }]);
	assert.equal(text.toString(), 'AbCd');
});
test('failed push retains a merged backlog and the next push converges', () => {
	const pending = new PendingUpdates(); const a = new Y.Doc(); a.getText('file').insert(0, 'a'); pending.add(update(a)); a.getText('file').insert(1, 'b'); pending.add(update(a));
	const merged = pending.takeMerged(); assert.ok(merged); pending.restore(merged!); const sent = pending.takeMerged(); assert.ok(sent); const b = new Y.Doc(); Y.applyUpdate(b, sent!); assert.equal(b.getText('file').toString(), 'ab');
});
test('concurrent edits at one position converge', () => {
	const a = new Y.Doc(); a.getText('file').insert(0, 'x'); const b = new Y.Doc(); Y.applyUpdate(b, update(a)); const va = Y.encodeStateVector(a); const vb = Y.encodeStateVector(b); a.getText('file').insert(1, 'A'); b.getText('file').insert(1, 'B'); const ua = Y.encodeStateAsUpdate(a, vb); const ub = Y.encodeStateAsUpdate(b, va); Y.applyUpdate(a, ub); Y.applyUpdate(b, ua); assert.equal(a.getText('file').toString(), b.getText('file').toString());
});

test('typing queues an update the other client can apply; an already-matching editor queues nothing', () => {
	const a = new Y.Doc(); const text = a.getText('file'); text.insert(0, 'hello');
	const b = new Y.Doc(); Y.applyUpdate(b, update(a));
	const pending = new PendingUpdates();
	a.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'remote') pending.add(u); });
	assert.equal(applyEditorText(text, 'hello world'), true);
	assert.equal(pending.length, 1);
	Y.applyUpdate(b, pending.takeMerged()!, 'remote');
	assert.equal(b.getText('file').toString(), 'hello world');
	assert.equal(applyEditorText(text, 'hello world'), false); // echo of our own state: no-op
	assert.equal(pending.length, 0);
});
test('a remote update applied with origin remote is not queued to be sent back', () => {
	const a = new Y.Doc(); const b = new Y.Doc(); const pending = new PendingUpdates();
	b.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'remote') pending.add(u); });
	a.getText('file').insert(0, 'from a'); Y.applyUpdate(b, update(a), 'remote');
	assert.equal(pending.length, 0);
});
