import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { textDiff } from './safety.ts';

test('two concurrent edits are both retained', () => {
	const a = new Y.Doc(); const b = new Y.Doc();
	a.getText('file').insert(0, 'hello');
	Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
	const updateA = (() => { a.getText('file').insert(5, ' A'); return Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)); })();
	const updateB = (() => { b.getText('file').insert(5, ' B'); return Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)); })();
	Y.applyUpdate(a, updateB); Y.applyUpdate(b, updateA);
	assert.equal(a.getText('file').toString().includes(' A'), true);
	assert.equal(a.getText('file').toString().includes(' B'), true);
});

test('disk diff applied as a Yjs update produces the new text', () => {
	const doc = new Y.Doc(); const text = doc.getText('file'); text.insert(0, 'old text');
	const diff = textDiff(text.toString(), 'new text'); assert.ok(diff);
	text.delete(diff!.index, diff!.deleteCount); text.insert(diff!.index, diff!.insert);
	assert.equal(text.toString(), 'new text');
});
