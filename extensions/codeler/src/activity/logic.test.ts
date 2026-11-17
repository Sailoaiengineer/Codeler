import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANGE_WINDOW_MS, activityDetail, admitChange } from './logic.ts';

test('a file changes at most once per five minutes', () => {
	const last = new Map<string, number>();
	assert.equal(admitChange(last, 'a.ts', 0), true);
	assert.equal(admitChange(last, 'a.ts', 1000), false);
	assert.equal(admitChange(last, 'a.ts', CHANGE_WINDOW_MS - 1), false);
	assert.equal(admitChange(last, 'a.ts', CHANGE_WINDOW_MS), true);
});

test('each file has its own window', () => {
	const last = new Map<string, number>();
	assert.equal(admitChange(last, 'a.ts', 0), true);
	assert.equal(admitChange(last, 'b.ts', 1), true);
});

test('a dropped edit does not restart the window', () => {
	const last = new Map<string, number>();
	admitChange(last, 'a.ts', 0);
	admitChange(last, 'a.ts', 200_000);
	assert.equal(admitChange(last, 'a.ts', CHANGE_WINDOW_MS), true);
});

test('details are trimmed, capped at 300 characters, and empty ones are dropped', () => {
	assert.equal(activityDetail('  src/a.ts  '), 'src/a.ts');
	assert.equal(activityDetail('x'.repeat(400))?.length, 300);
	assert.equal(activityDetail('   '), undefined);
});
