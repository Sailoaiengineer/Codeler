import * as fs from 'node:fs';
import * as path from 'node:path';

export const MAX_FILE_SIZE = 2 * 1024 * 1024;
const IGNORED = new Set(['node_modules', '.git', '.codeler', 'dist', 'out', '.next']);

export function isSafeRelativePath(file: string): boolean {
	if (!file || file.includes('\0') || file.startsWith('/') || file.startsWith('\\') || /^[A-Za-z]:/.test(file)) return false;
	const parts = file.replaceAll('\\', '/').split('/');
	return parts.every(Boolean) && !parts.includes('..') && !parts.some(p => IGNORED.has(p));
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

