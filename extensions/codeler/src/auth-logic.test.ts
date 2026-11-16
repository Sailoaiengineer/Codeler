import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedVerificationUrl, pollDeviceToken, storeSessionToken } from './auth-logic.ts';

const clock = () => {
	let time = 0;
	const waits: number[] = [];
	return { waits, now: () => time, sleep: async (ms: number) => { waits.push(ms); time += ms; } };
};

test('device flow succeeds and waits for the polling interval', async () => {
	const c = clock(); const result = await pollDeviceToken(async () => ({ ok: true, status: 200, access_token: 'secret' }), { intervalMs: 5_000, expiresInMs: 20_000, ...c });
	assert.deepEqual(result, { token: 'secret', reason: 'success' }); assert.deepEqual(c.waits, [5_000]);
});
test('slow_down backs off before the next poll', async () => {
	const c = clock(); let n = 0; const result = await pollDeviceToken(async () => ++n === 1 ? ({ ok: false, status: 400, error: 'slow_down' }) : ({ ok: true, status: 200, access_token: 'secret' }), { intervalMs: 5_000, expiresInMs: 30_000, ...c });
	assert.equal(result.token, 'secret'); assert.deepEqual(c.waits, [5_000, 10_000]);
});
test('denied and expired device codes stop with distinct reasons', async () => {
	const denied = clock(); assert.deepEqual(await pollDeviceToken(async () => ({ ok: false, status: 400, error: 'access_denied' }), { intervalMs: 5_000, expiresInMs: 10_000, ...denied }), { reason: 'access_denied' });
	const expired = clock(); assert.deepEqual(await pollDeviceToken(async () => ({ ok: false, status: 400, error: 'expired_token' }), { intervalMs: 5_000, expiresInMs: 10_000, ...expired }), { reason: 'expired' });
});
test('offline polling retries and a foreign verification origin is rejected', async () => {
	const c = clock(); let n = 0; const result = await pollDeviceToken(async () => { if (++n === 1) throw new TypeError('offline'); return { ok: true, status: 200, access_token: 'secret' }; }, { intervalMs: 5_000, expiresInMs: 20_000, ...c });
	assert.equal(result.token, 'secret'); assert.equal(c.waits.length, 2); assert.equal(allowedVerificationUrl('https://evil.example/device', 'https://codeler.example'), false);
});
test('the access token is written only through SecretStorage', async () => {
	const values = new Map<string, string>(); const secrets = { store: async (key: string, value: string) => { values.set(key, value); } };
	await storeSessionToken(secrets, 'session-token');
	assert.deepEqual([...values.entries()], [['codeler.session', 'session-token']]);
});
