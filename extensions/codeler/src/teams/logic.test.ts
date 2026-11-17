import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAvatar, cleanCreate, cleanJoin, cleanProjectName, projectLimitReached } from './logic.ts';

test('team input is bounded and normalized', () => {
	assert.deepEqual(cleanCreate('  A   team ', ' desc ', 'password', [{ email: 'a@b.com', role: 'member' }]), { name: 'A team', description: 'desc', password: 'password', invites: [{ email: 'a@b.com', role: 'member' }] });
});
test('join codes accept the displayed and unspaced form', () => assert.equal(cleanJoin(' abcd-efgh ', 'password').joinCode, 'ABCD-EFGH'));
test('project names are trimmed, collapsed and bounded to 60 characters', () => {
	assert.deepEqual(cleanProjectName('  Web   app '), { name: 'Web app' });
	assert.ok(cleanProjectName('   ').error);
	assert.deepEqual(cleanProjectName('a'.repeat(60)), { name: 'a'.repeat(60) });
	assert.ok(cleanProjectName('a'.repeat(61)).error);
});
test('a team stops at 100 projects', () => {
	assert.equal(projectLimitReached(99), false);
	assert.equal(projectLimitReached(100), true);
});
test('avatars must be PNG, JPEG or WebP and at most 1 MB', () => {
	assert.equal(checkAvatar('image/png', 1000), undefined);
	assert.equal(checkAvatar('image/webp', 1024 * 1024), undefined);
	assert.ok(checkAvatar('image/gif', 1000));
	assert.ok(checkAvatar('image/png', 1024 * 1024 + 1));
	assert.ok(checkAvatar('image/png', 0));
});
