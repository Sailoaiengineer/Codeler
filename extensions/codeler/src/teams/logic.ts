export type Invite = { email: string; role: 'admin' | 'member' };
export function cleanCreate(name: string, description: string, password: string, invites: Invite[]) {
	return { name: name.trim().replace(/\s+/g, ' ').slice(0, 60), description: description.trim().slice(0, 500), password, invites: invites.slice(0, 50) };
}
export function cleanJoin(code: string, password: string) {
	return { joinCode: code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2'), password };
}
export const PROJECT_LIMIT = 100;
export function projectLimitReached(count: number) {
	return count >= PROJECT_LIMIT;
}
/** Returns the cleaned name, or an error to show the person. */
export function cleanProjectName(raw: string): { name?: string; error?: string } {
	const name = raw.trim().replace(/\s+/g, ' ');
	if (name.length < 1) return { error: 'Give the project a name.' };
	if (name.length > 60) return { error: 'Project names can be at most 60 characters.' };
	return { name };
}
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const AVATAR_MAX_BYTES = 1024 * 1024;
/** Returns an error to show the person, or undefined when the image is fine. */
export function checkAvatar(type: string, bytes: number): string | undefined {
	if (!AVATAR_TYPES.includes(type)) return 'Use a PNG, JPEG or WebP image.';
	if (bytes < 1 || bytes > AVATAR_MAX_BYTES) return 'Image must be under 1 MB.';
	return undefined;
}
