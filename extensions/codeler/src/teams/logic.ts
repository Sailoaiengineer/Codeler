export type Invite = { email: string; role: 'admin' | 'member' };
export function cleanCreate(name: string, description: string, password: string, invites: Invite[]) {
	return { name: name.trim().replace(/\s+/g, ' ').slice(0, 60), description: description.trim().slice(0, 500), password, invites: invites.slice(0, 50) };
}
export function cleanJoin(code: string, password: string) {
	return { joinCode: code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2'), password };
}
