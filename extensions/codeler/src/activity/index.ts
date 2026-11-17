// Records team activity from this desktop app. Best effort: nothing here may throw into the feature that called it.
import * as vscode from 'vscode';
import { ConvexHttpClient } from 'convex/browser';
import { Auth } from '../auth';
import { ActivityKind, activityDetail, admitChange } from './logic';

let auth: Auth | undefined;
let client: ConvexHttpClient | undefined;
let clientUrl = '';
const lastChange = new Map<string, number>();

/** Called once from activate, so call sites only pass a kind and a detail. */
export function bindActivity(value: Auth) { auth = value; }

/** Records one event for the active team project. Does nothing when signed out or no project is set. */
export async function recordActivity(kind: ActivityKind, detail: string): Promise<void> {
	try {
		const settings = vscode.workspace.getConfiguration('codeler');
		const projectId = settings.get<string>('projectId', '');
		const url = settings.get<string>('convexUrl', '').replace(/\/+$/, '');
		const text = activityDetail(detail);
		if (!auth?.me || !projectId || !url || !text) return;
		const token = await auth.convexToken();
		if (!token) return;
		if (!client || clientUrl !== url) { client = new ConvexHttpClient(url); clientUrl = url; }
		client.setAuth(token);
		await (client as any).mutation('activity:record', { projectId, kind, detail: text });
	} catch {
		// Dropped on purpose: a failed activity write must not surface as an error.
	}
}

/** Records a file_changed event at most once per file per five minutes. */
export function recordChange(file: string): void {
	if (admitChange(lastChange, file, Date.now())) void recordActivity('file_changed', file);
}
