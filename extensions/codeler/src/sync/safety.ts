import * as fs from 'node:fs';
import * as path from 'node:path';

export const MAX_FILE_SIZE = 2 * 1024 * 1024;
// Shared project path rule. The same rule lives in web/convex/projectPath.ts and extensions/codeler/mcp/server.js: keep all three identical.
const BLOCKED = new Set(['node_modules', '.git', '.codeler', 'dist', 'out', '.next']);
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/;

export function isSafeRelativePath(file: string): boolean {
	if (typeof file !== 'string' || file.length === 0 || file.length > 500 || /[\u0000-\u001f\u007f]/.test(file)) return false;
	if (file.startsWith('/') || file.startsWith('\\') || /^[A-Za-z]:/.test(file)) return false;
	return file.replaceAll('\\', '/').split('/').every(seg => {
		if (!seg || seg === '.' || seg === '..' || /[. ]$/.test(seg) || seg.includes(':')) return false;
		if (RESERVED.test(seg.split('.')[0].trim().toUpperCase())) return false;
		return !BLOCKED.has(seg.toLowerCase());
	});
}

export function isIgnored(file: string, size?: number): boolean {
	return !isSafeRelativePath(file) || (size !== undefined && size > MAX_FILE_SIZE);
}

export function looksBinary(data: Uint8Array): boolean {
	const sample = data.subarray(0, Math.min(data.length, 8192));
	return sample.includes(0) || sample.filter(b => b < 7 || (b > 14 && b < 32)).length > sample.length / 20;
}

export function safePath(root: string, relative: string): string | undefined {
	if (!isSafeRelativePath(relative)) return undefined;
	const rootReal = fs.realpathSync.native(root);
	const candidate = path.resolve(rootReal, relative);
	if (candidate !== rootReal && !candidate.startsWith(rootReal + path.sep)) return undefined;
	try {
		const real = fs.realpathSync.native(candidate);
		return real === rootReal || real.startsWith(rootReal + path.sep) ? real : undefined;
	} catch {
		let parent = path.dirname(candidate);
		while (parent !== rootReal && !fs.existsSync(parent)) parent = path.dirname(parent);
		const parentReal = fs.realpathSync.native(parent);
		return parentReal === rootReal || parentReal.startsWith(rootReal + path.sep) ? candidate : undefined;
	}
}

