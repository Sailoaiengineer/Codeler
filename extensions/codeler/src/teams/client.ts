import { ConvexHttpClient } from 'convex/browser';
import * as vscode from 'vscode';
import { Auth, convexUrl } from '../auth';

export type TeamProject = { id: string; name: string };
export type TeamMine = { teamId: string; name: string; role: string; status: string; waiting?: number; projects?: TeamProject[]; joinCode?: string; imageUrl?: string | null };
export type TeamPerson = { id: string; userId: string; name: string; email: string; image: string | null; role: string };
export type TeamPeople = { me: string; active: TeamPerson[]; pending: TeamPerson[] };

function message(error: unknown): string {
	const value = error as { data?: unknown; message?: unknown };
	if (typeof value?.data === 'string') return value.data;
	if (typeof value?.message === 'string') return value.message.replace(/^Server Error:\s*/i, '');
	return 'The team request failed. Try again.';
}

export class TeamClient {
	private client?: ConvexHttpClient;
	private url = '';

	constructor(private readonly auth: Auth) { }

	private async get(): Promise<ConvexHttpClient> {
		const url = convexUrl();
		if (!url) throw new Error('Codeler backend is not configured.');
		if (!this.client || this.url !== url) {
			this.client = new ConvexHttpClient(url);
			this.url = url;
		}
		const token = await this.auth.convexToken();
		if (!token) throw new Error('Sign in to use teams.');
		this.client.setAuth(token);
		return this.client;
	}

	async mine(): Promise<TeamMine[]> { return await (await this.get() as any).query('teams:mine', {}) as TeamMine[]; }
	async people(teamId: string): Promise<TeamPeople> { return await (await this.get() as any).query('teams:people', { teamId }) as TeamPeople; }
	async create(args: { name: string; description: string; password: string; invites: { email: string; role: 'admin' | 'member' }[] }) { return await (await this.get() as any).action('teamsNode:createTeam', args) as { teamId: string; joinCode: string }; }
	async join(joinCode: string, password: string) { return await (await this.get() as any).action('teamsNode:requestJoin', { joinCode, password }) as { status: 'pending' | 'active' }; }
	async createProject(teamId: string, name: string) { return await (await this.get() as any).mutation('projects:create', { teamId, name }) as string; }
	/** Owner only. Uploads the file to Convex storage, then Convex checks the stored type and size before saving it. */
	async uploadAvatar(teamId: string, bytes: Uint8Array, type: string) {
		const client = await this.get() as any;
		const uploadUrl = await client.mutation('teams:generateAvatarUploadUrl', { teamId }) as string;
		const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': type }, body: bytes.slice().buffer });
		if (!response.ok) throw new Error('The image upload failed. Try again.');
		const { storageId } = await response.json() as { storageId: string };
		await client.mutation('teams:setAvatar', { teamId, storageId });
	}
	async approve(memberId: string) { return await (await this.get() as any).mutation('teams:approve', { memberId }); }
	async deny(memberId: string) { return await (await this.get() as any).mutation('teams:deny', { memberId }); }
	async remove(memberId: string) { return await (await this.get() as any).mutation('teams:remove', { memberId }); }
	static error(error: unknown) { return message(error); }
}
