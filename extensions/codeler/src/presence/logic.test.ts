import test from 'node:test';
import assert from 'node:assert/strict';
import { colorFor, fileDecorations, followTarget, throttle } from './logic.ts';

test('color assignment is deterministic and uses approved colors', () => { assert.equal(colorFor('user-1'), colorFor('user-1')); assert.match(colorFor('user-1'), /^#(?:3fbf5c|2684f5|f2842b|b26bd1)$/); });
test('presence rows map to file badges', () => { const map = fileDecorations([{ userId: 'u', name: 'Alex Doe', path: 'src/a.ts', line: 0, character: 0, selection: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 } }]); assert.deepEqual(map.get('src/a.ts')?.[0].initials, 'AD'); });
test('follow state starts, switches, and stops', () => { assert.deepEqual(followTarget(undefined, 'follow', 'a'), { userId: 'a', active: true }); assert.deepEqual(followTarget({ userId: 'a', active: true }, 'follow', 'b'), { userId: 'b', active: true }); assert.equal(followTarget({ userId: 'b', active: true }, 'stop'), undefined); });
test('throttle coalesces rapid calls', async () => { let count = 0; const fn = throttle(() => count++, 15); fn(); fn(); await new Promise(r => setTimeout(r, 30)); assert.equal(count, 1); });
