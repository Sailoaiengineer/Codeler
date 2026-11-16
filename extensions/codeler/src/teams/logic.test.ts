import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCreate, cleanJoin } from './logic.ts';

test('team input is bounded and normalized', () => {
	assert.deepEqual(cleanCreate('  A   team ', ' desc ', 'password', [{ email: 'a@b.com', role: 'member' }]), { name: 'A team', description: 'desc', password: 'password', invites: [{ email: 'a@b.com', role: 'member' }] });
});
test('join codes accept the displayed and unspaced form', () => assert.equal(cleanJoin(' abcd-efgh ', 'password').joinCode, 'ABCD-EFGH'));
