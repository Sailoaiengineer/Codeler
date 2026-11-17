export type DeviceTokenResponse = { ok: boolean; status: number; access_token?: string; error?: string };
export interface SecretStore { store(key: string, value: string): PromiseLike<void> }

export const storeSessionToken = (secrets: SecretStore, token: string) => secrets.store('codeler.session', token);

export function allowedVerificationUrl(value: string, site: string): boolean {
	try { return new URL(value, site).origin === new URL(site).origin; } catch { return false; }
}

// The session token and Convex calls go only to https, or to this computer's own http server.
export function sessionUrlAllowed(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'));
	} catch { return false; }
}

export async function pollDeviceToken(
	request: () => Promise<DeviceTokenResponse>,
	options: { intervalMs: number; expiresInMs: number; sleep?: (ms: number) => Promise<void>; now?: () => number; cancelled?: () => boolean },
): Promise<{ token?: string; reason: 'success' | 'access_denied' | 'expired' | 'cancelled' }> {
	let interval = Math.max(options.intervalMs, 5_000);
	const sleep = options.sleep ?? ((ms) => new Promise<void>(resolve => setTimeout(resolve, ms)));
	const now = options.now ?? Date.now;
	const deadline = now() + options.expiresInMs;
	while (!(options.cancelled?.() ?? false) && now() < deadline) {
		await sleep(interval);
		if (options.cancelled?.() ?? false) return { reason: 'cancelled' };
		let response: DeviceTokenResponse;
		try { response = await request(); } catch { continue; }
		if (response.ok && response.access_token) return { token: response.access_token, reason: 'success' };
		if (response.error === 'slow_down') { interval += 5_000; continue; }
		if (response.error === 'access_denied') return { reason: 'access_denied' };
		if (response.error === 'expired_token' || response.error === 'invalid_grant') return { reason: 'expired' };
	}
	return { reason: (options.cancelled?.() ?? false) ? 'cancelled' : 'expired' };
}
