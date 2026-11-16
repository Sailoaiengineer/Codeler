// Pure data and status rules for the Codeler picks tree. Imports nothing, so tests run it directly.

export type Group = 'ai' | 'themes' | 'languages';
export type ToolId = 'claude' | 'codex' | 'gemini';
export type Picker = 'workbench.action.selectTheme' | 'workbench.action.selectIconTheme';

export const GROUPS: readonly { id: Group; label: string }[] = [
	{ id: 'ai', label: 'AI tools' },
	{ id: 'themes', label: 'Colour themes' },
	{ id: 'languages', label: 'Language packs' },
];

// The id is the command typed into the terminal and the probe program. Both come only from this table.
export const AI_TOOLS: readonly { id: ToolId; label: string; docs: string }[] = [
	{ id: 'claude', label: 'Claude Code', docs: 'https://docs.claude.com/en/docs/claude-code/overview' },
	{ id: 'codex', label: 'OpenAI Codex', docs: 'https://developers.openai.com/codex/cli' },
	{ id: 'gemini', label: 'Gemini CLI', docs: 'https://github.com/google-gemini/gemini-cli' },
];

export const BUILTIN_THEME = 'Codeler Dark';
export const BUILTIN_ITEM = 'theme:codeler-dark';
export const THEME_EXTENSIONS: readonly { id: string; label: string; picker: Picker }[] = [
	{ id: 'dracula-theme.theme-dracula', label: 'Dracula Official', picker: 'workbench.action.selectTheme' },
	{ id: 'GitHub.github-vscode-theme', label: 'GitHub Theme', picker: 'workbench.action.selectTheme' },
	{ id: 'zhuangtongfa.material-theme', label: 'Material Theme', picker: 'workbench.action.selectTheme' },
	{ id: 'PKief.material-icon-theme', label: 'Material Icon Theme', picker: 'workbench.action.selectIconTheme' },
];

export const LANGUAGE_PACKS: readonly { id: string; label: string }[] = [
	{ id: 'ms-python.python', label: 'Python' },
	{ id: 'redhat.java', label: 'Java' },
	{ id: 'llvm-vs-code-extensions.vscode-clangd', label: 'C/C++' },
	{ id: 'muhammad-sammy.csharp', label: 'C#' },
	{ id: 'golang.go', label: 'Go' },
	{ id: 'rust-lang.rust-analyzer', label: 'Rust' },
	{ id: 'bmewburn.vscode-intelephense-client', label: 'PHP' },
];

export type Item = { id: string; group: Group; label: string };
export const ITEMS: readonly Item[] = [
	...AI_TOOLS.map(t => ({ id: `tool:${t.id}`, group: 'ai' as Group, label: t.label })),
	{ id: BUILTIN_ITEM, group: 'themes', label: BUILTIN_THEME },
	...THEME_EXTENSIONS.map(t => ({ id: `theme:${t.id}`, group: 'themes' as Group, label: t.label })),
	...LANGUAGE_PACKS.map(l => ({ id: `lang:${l.id}`, group: 'languages' as Group, label: l.label })),
];

export function toolIdOf(itemId: string): ToolId | undefined {
	return AI_TOOLS.find(t => `tool:${t.id}` === itemId)?.id;
}

// The Open VSX id behind a theme or language item.
export function extensionIdOf(itemId: string): string {
	return itemId.replace(/^(theme|lang):/, '');
}

export function statusLabel(itemId: string, installed: boolean | undefined): string {
	if (itemId === BUILTIN_ITEM) return 'Built in';
	if (installed === undefined) return 'Checking';
	return installed ? 'Installed' : 'Not installed';
}

// What a tool probe runs. Undefined for anything that is not a listed tool, so nothing else can be run.
export function probeSpec(toolId: string, platform: string = process.platform): { file: string; args: string[] } | undefined {
	const tool = AI_TOOLS.find(t => t.id === toolId);
	if (!tool) return undefined;
	// On Windows the CLIs are .cmd shims that execFile cannot run without a shell, so ask `where` whether they exist.
	return platform === 'win32' ? { file: 'where', args: [tool.id] } : { file: tool.id, args: ['--version'] };
}

export type Action =
	| { type: 'terminal'; name: string; command: ToolId }
	| { type: 'url'; url: string }
	| { type: 'setTheme'; name: string }
	| { type: 'picker'; command: Picker }
	| { type: 'search'; query: string };

// What clicking an item does. Unknown ids get no action.
export function actionFor(itemId: string, installed: boolean): Action | undefined {
	const tool = AI_TOOLS.find(t => `tool:${t.id}` === itemId);
	if (tool) return installed ? { type: 'terminal', name: tool.label, command: tool.id } : { type: 'url', url: tool.docs };
	if (itemId === BUILTIN_ITEM) return { type: 'setTheme', name: BUILTIN_THEME };
	const theme = THEME_EXTENSIONS.find(t => `theme:${t.id}` === itemId);
	if (theme) return installed ? { type: 'picker', command: theme.picker } : { type: 'search', query: theme.id };
	const lang = LANGUAGE_PACKS.find(l => `lang:${l.id}` === itemId);
	if (lang) return { type: 'search', query: lang.id };
	return undefined;
}
