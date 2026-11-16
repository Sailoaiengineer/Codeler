import * as vscode from 'vscode';
import { allowedVerificationUrl, pollDeviceToken, storeSessionToken } from './auth-logic';

// Desktop sign-in (OAuth device flow through Better Auth). The session token lives in the OS keychain
// via SecretStorage; it never goes into settings or files.
const CLIENT_ID = 'codeler-desktop';
const SECRET_KEY = 'codeler.session';

export interface Me { id: string; name: string; email: string; image: string | null }

// shortcut: localhost until the hosted Codeler site exists; then set the real URL as the default
export const siteUrl = () => vscode.workspace.getConfiguration('codeler').get<string>('siteUrl', 'http://localhost:3000').replace(/\/+$/, '');
const convexUrl = () => vscode.workspace.getConfiguration('codeler').get<string>('convexUrl', '').replace(/\/+$/, '');

async function post<T>(path: string, body: unknown, token?: string): Promise<{ ok: boolean; status: number; data: T }> {
	const res = await fetch(siteUrl() + path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: JSON.stringify(body),
	});
	return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) as T };
}

export class Auth {
	private readonly changed = new vscode.EventEmitter<Me | undefined>();
	readonly onDidChange = this.changed.event;
	me: Me | undefined;

	constructor(private readonly secrets: vscode.SecretStorage) { }

	/** Restores the saved session on startup. */
	async init() {
		if (await this.secrets.get(SECRET_KEY)) await this.refreshMe();
	}

	async signIn(): Promise<void> {
		let start;
		try {
			start = await post<{ device_code: string; user_code: string; verification_uri: string; verification_uri_complete: string; expires_in: number; interval: number }>(
				'/api/auth/device/code', { client_id: CLIENT_ID });
		} catch {
			vscode.window.showErrorMessage(`Can't reach Codeler at ${siteUrl()}. Check your internet connection.`);
			return;
		}
		if (!start.ok) { vscode.window.showErrorMessage('Codeler sign-in is unavailable right now. Try again in a minute.'); return; }
		const { device_code, user_code, verification_uri_complete, expires_in } = start.data;
		let interval = Math.max(start.data.interval || 5, 5) * 1000;

		// Only open our own site, whatever the server says.
		if (!allowedVerificationUrl(verification_uri_complete, siteUrl())) { vscode.window.showErrorMessage('Codeler sign-in returned an unexpected address.'); return; }
		const page = new URL(verification_uri_complete, siteUrl());
		await vscode.env.openExternal(vscode.Uri.parse(page.toString()));

		const token = await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Sign in to Codeler: check that your browser shows ${user_code}, then click Allow.`,
			cancellable: true,
		}, async (_p, cancel) => {
			const result = await pollDeviceToken(async () => {
				const res = await post<{ access_token?: string; error?: string }>('/api/auth/device/token', {
						grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code, client_id: CLIENT_ID,
					});
				return { ok: res.ok, status: res.status, ...res.data };
			}, { intervalMs: interval, expiresInMs: expires_in * 1000, cancelled: () => cancel.isCancellationRequested });
			if (result.reason === 'access_denied') vscode.window.showWarningMessage('Sign-in was denied in the browser.');
			else if (result.reason === 'expired') vscode.window.showWarningMessage('The sign-in code expired. Try again.');
			return result.token;
		});
		if (!token) return;
		await storeSessionToken(this.secrets, token);
		await this.refreshMe();
		if (this.me) vscode.window.showInformationMessage(`Signed in as ${this.me.email}.`);
	}

	async signOut() {
		const token = await this.secrets.get(SECRET_KEY);
		await this.secrets.delete(SECRET_KEY);
		if (token) post('/api/auth/sign-out', {}, token).catch(() => { /* already signed out locally */ });
		this.me = undefined;
		this.changed.fire(undefined);
	}

	/** Short-lived Convex token for this session, for queries and live updates. */
	async convexToken(): Promise<string | undefined> {
		const session = await this.secrets.get(SECRET_KEY);
		if (!session) return undefined;
		const res = await fetch(`${siteUrl()}/api/auth/convex/token`, { headers: { Authorization: `Bearer ${session}` } }).catch(() => undefined);
		if (res?.status === 401) { await this.signOut(); return undefined; } // session revoked or expired
		if (!res?.ok) return undefined;
		const body = await res.json().catch(() => ({})) as { token?: string };
		return body.token;
	}

	/** Runs a Convex query over HTTP with the user's token. */
	async query<T>(path: string, args: Record<string, unknown> = {}): Promise<T | undefined> {
		const url = convexUrl();
		const jwt = await this.convexToken();
		if (!url || !jwt) return undefined;
		const res = await fetch(`${url}/api/query`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
			body: JSON.stringify({ path, args, format: 'json' }),
		}).catch(() => undefined);
		const body = await res?.json().catch(() => undefined) as { status?: string; value?: T } | undefined;
		return body?.status === 'success' ? body.value : undefined;
	}

	private async refreshMe() {
		this.me = await this.query<Me | null>('users:me') ?? undefined;
		this.changed.fire(this.me);
	}
}
