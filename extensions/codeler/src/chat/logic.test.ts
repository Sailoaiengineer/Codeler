import test from 'node:test';
import assert from 'node:assert/strict';
import { admitSend, fileError, messageError, mentionedNames, panelActivity, panelMessage } from './logic.ts';

test('mentions match whole member names, case-insensitively', () => {
	assert.deepEqual(mentionedNames('hey @sam can you look', ['Sam', 'Jordan']), ['Sam']);
	assert.deepEqual(mentionedNames('@Sam, @Jordan!', ['Sam', 'Jordan']), ['Sam', 'Jordan']);
	assert.deepEqual(mentionedNames('email me at a@Sam.dev', ['Sam']), []);
	assert.deepEqual(mentionedNames('@Samuel is not @Sam', ['Sam', 'Samuel']), ['Sam', 'Samuel']);
});

test('a full name with a space is one mention and does not also ping its first name', () => {
	assert.deepEqual(mentionedNames('ping @Sam Lee now', ['Sam', 'Sam Lee']), ['Sam Lee']);
});

test('no names means no mentions', () => {
	assert.deepEqual(mentionedNames('@Sam', []), []);
});

test('messages must be 1 to 4000 characters after trimming', () => {
	assert.ok(messageError('   '));
	assert.equal(messageError('  hi  '), undefined);
	assert.ok(messageError('x'.repeat(4001)));
	assert.equal(messageError('x'.repeat(4000)), undefined);
});

test('files are limited to 10 MB and the allowed types', () => {
	assert.equal(fileError({ type: 'image/png', size: 1024 }), undefined);
	assert.ok(fileError({ type: 'image/png', size: 10 * 1024 * 1024 + 1 }));
	assert.ok(fileError({ type: 'application/x-msdownload', size: 10 }));
	assert.ok(fileError({ type: 'text/html', size: 10 }));
});

test('rate limit allows 30 sends in a minute and then waits for the window to pass', () => {
	let sent: number[] = [];
	for (let i = 0; i < 30; i++) {
		const next = admitSend(sent, 1_000 + i);
		assert.ok(next, `send ${i + 1} should be allowed`);
		sent = next;
	}
	assert.equal(admitSend(sent, 40_000), undefined);
	// sends at 1000..1015 have left the window, so 14 remain and this one is admitted
	assert.equal(admitSend(sent, 61_015)?.length, 15);
});

test('a chat row maps to a panel message with initials, colour and ownership', () => {
	const row = { _id: 'm1', userId: 'u-sam', name: 'Sam Lee', text: 'hi', createdAt: Date.UTC(2026, 0, 1), attachment: null };
	const out = panelMessage(row, 'u-sam');
	assert.equal(out.who, 'Sam Lee');
	assert.equal(out.initials, 'SL');
	assert.equal(out.text, 'hi');
	assert.equal(out.mine, true);
	assert.match(out.time, /\d{1,2}:\d{2}/);
	assert.equal(panelMessage(row, 'someone-else').mine, false);
});

test('an activity row becomes a plain sentence split into name and rest', () => {
	const out = panelActivity({ _id: 'a1', userId: 'u1', name: 'Sam', kind: 'file_changed', detail: 'src/app.ts', createdAt: 0 });
	assert.equal(out.who, 'Sam');
	assert.equal(out.text, 'edited src/app.ts');
});
