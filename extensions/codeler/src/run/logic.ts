import { createHash } from 'node:crypto';

export type RunCommand = { name: string; command: string };
export type RunConfig = { commands: RunCommand[]; default?: string };

// Trust is kept per workspace as hashes of the exact command text, so any edit asks again.
export const commandFingerprint = (command: string): string => createHash('sha256').update(command, 'utf8').digest('hex');
export const isCommandTrusted = (trusted: string[], command: string): boolean => trusted.includes(commandFingerprint(command));
export function trustCommand(trusted: string[], command: string): string[] {
	const hash = commandFingerprint(command);
	return trusted.includes(hash) ? trusted : [...trusted, hash].slice(-200);
}

const max = 500;
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= max;

export function validateRunConfig(value: unknown): RunConfig | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const input = value as { commands?: unknown; default?: unknown };
	if (!Array.isArray(input.commands) || input.commands.length > 50) return undefined;
	const commands: RunCommand[] = [];
	for (const item of input.commands) {
		if (!item || typeof item !== 'object') return undefined;
		const command = item as { name?: unknown; command?: unknown };
		if (!text(command.name) || !text(command.command)) return undefined;
		commands.push({ name: command.name, command: command.command });
	}
	if (input.default !== undefined && !text(input.default)) return undefined;
	if (input.default !== undefined && !commands.some(c => c.name === input.default)) return undefined;
	return { commands, ...(input.default === undefined ? {} : { default: input.default }) };
}

export function packageManager(files: string[]): 'npm' | 'pnpm' | 'yarn' | 'bun' {
	if (files.some(f => /(^|\/)bun\.lockb?$/.test(f))) return 'bun';
	if (files.some(f => /(^|\/)pnpm-lock\.yaml$/.test(f))) return 'pnpm';
	if (files.some(f => /(^|\/)yarn\.lock$/.test(f))) return 'yarn';
	return 'npm';
}

export function detectRunCommand(files: string[], contents: Record<string, string>): RunCommand | undefined {
	const names = files.map(f => f.replaceAll('\\', '/'));
	const has = (name: string) => names.includes(name) || names.some(f => f.endsWith('/' + name));
	const rootFile = (name: string) => names.find(f => f === name || f.endsWith('/' + name));
	const packageFile = rootFile('package.json');
	if (packageFile) {
		try {
			const scripts = (JSON.parse(contents[packageFile] ?? '{}') as { scripts?: Record<string, unknown> }).scripts ?? {};
			const pm = packageManager(names);
			for (const script of ['dev', 'start', 'serve']) if (typeof scripts[script] === 'string') return { name: script === 'dev' ? 'Dev server' : script[0].toUpperCase() + script.slice(1), command: `${pm} run ${script}` };
		} catch { /* an invalid package file is not a run command */ }
	}
	const py = has('pyproject.toml') ? undefined : rootFile('main.py') ?? rootFile('app.py');
	if (has('pyproject.toml') || py) return { name: 'Python', command: `python ${py ? py.split('/').pop() : 'main.py'}` };
	if (has('go.mod')) return { name: 'Go', command: 'go run .' };
	if (has('Cargo.toml')) return { name: 'Rust', command: 'cargo run' };
	if (has('pom.xml')) return { name: 'Java', command: 'mvn exec:java' };
	if (has('build.gradle')) return { name: 'Gradle', command: 'gradle run' };
	if (names.some(f => f.endsWith('.csproj'))) return { name: 'C#', command: 'dotnet run' };
	if (has('index.php')) return { name: 'PHP', command: 'php -S localhost:8000' };
	const native = names.filter(f => /\.(c|cpp)$/.test(f));
	if (native.length === 1) {
		const file = native[0].split('/').pop()!;
		const compiler = file.endsWith('.cpp') ? 'g++' : 'gcc';
		return { name: 'Build and run', command: `${compiler} "${file}" -o "${file.replace(/\.(c|cpp)$/, '')}.codeler-run" && "${file.replace(/\.(c|cpp)$/, '')}.codeler-run"` };
	}
	if (has('index.html') && names.every(f => f === 'index.html' || f.endsWith('/index.html'))) return { name: 'Open preview', command: 'codeler.openHtml' };
	return undefined;
}

export type Language = 'python' | 'javascript' | 'typescript' | 'java' | 'cpp' | 'csharp' | 'go' | 'rust' | 'php';
export function languageForFile(file: string): Language | undefined {
	const ext = file.toLowerCase().split('.').pop();
	return ({ py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', java: 'java', c: 'cpp', cc: 'cpp', cpp: 'cpp', h: 'cpp', hpp: 'cpp', cs: 'csharp', go: 'go', rs: 'rust', php: 'php' } as Record<string, Language>)[ext ?? ''];
}

export function toolForLanguage(language: Language): string | undefined {
	return ({ python: 'python', javascript: 'node', typescript: 'node', java: 'java', cpp: 'gcc', csharp: 'dotnet', go: 'go', rust: 'cargo', php: 'php' } as Record<Language, string>)[language];
}
