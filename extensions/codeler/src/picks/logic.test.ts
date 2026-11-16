import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, AI_TOOLS, THEME_EXTENSIONS, LANGUAGE_PACKS, BUILTIN_ITEM, actionFor, extensionIdOf, probeSpec, statusLabel, toolIdOf } from './logic.ts';

test('AI tools are the three CLIs, in order, with their install pages', () => {
	assert.deepEqual(AI_TOOLS.map(t => [t.id, t.label, t.docs]), [
		['claude', 'Claude Code', 'https://docs.claude.com/en/docs/claude-code/overview'],
		['codex', 'OpenAI Codex', 'https://developers.openai.com/codex/cli'],
		['gemini', 'Gemini CLI', 'https://github.com/google-gemini/gemini-cli'],
	]);
});

test('theme and language lists have the approved ids', () => {
	assert.deepEqual(THEME_EXTENSIONS.map(t => t.id), ['dracula-theme.theme-dracula', 'GitHub.github-vscode-theme', 'zhuangtongfa.material-theme', 'PKief.material-icon-theme']);
	assert.deepEqual(LANGUAGE_PACKS.map(l => l.id), ['ms-python.python', 'redhat.java', 'llvm-vs-code-extensions.vscode-clangd', 'muhammad-sammy.csharp', 'golang.go', 'rust-lang.rust-analyzer', 'bmewburn.vscode-intelephense-client']);
});

test('items fall into the three groups with the built-in theme first', () => {
	const count = (g: string) => ITEMS.filter(i => i.group === g).length;
	assert.equal(count('ai'), 3);
	assert.equal(count('themes'), 1 + THEME_EXTENSIONS.length);
	assert.equal(count('languages'), LANGUAGE_PACKS.length);
	assert.equal(ITEMS.find(i => i.group === 'themes')?.id, BUILTIN_ITEM);
	assert.equal(new Set(ITEMS.map(i => i.id)).size, ITEMS.length);
});

test('status labels follow the install state', () => {
	assert.equal(statusLabel(BUILTIN_ITEM, undefined), 'Built in');
	assert.equal(statusLabel('tool:claude', undefined), 'Checking');
	assert.equal(statusLabel('lang:golang.go', true), 'Installed');
	assert.equal(statusLabel('lang:golang.go', false), 'Not installed');
});

test('ids map back to their tool and extension', () => {
	assert.equal(toolIdOf('tool:gemini'), 'gemini');
	assert.equal(toolIdOf('lang:golang.go'), undefined);
	assert.equal(extensionIdOf('theme:PKief.material-icon-theme'), 'PKief.material-icon-theme');
	assert.equal(extensionIdOf('lang:rust-lang.rust-analyzer'), 'rust-lang.rust-analyzer');
});

test('a CLI opens a terminal when installed and its install page when missing', () => {
	assert.deepEqual(actionFor('tool:codex', true), { type: 'terminal', name: 'OpenAI Codex', command: 'codex' });
	assert.deepEqual(actionFor('tool:codex', false), { type: 'url', url: 'https://developers.openai.com/codex/cli' });
});

test('Codeler Dark applies the built-in theme', () => {
	assert.deepEqual(actionFor(BUILTIN_ITEM, true), { type: 'setTheme', name: 'Codeler Dark' });
});

test('uninstalled themes and language packs search for their id', () => {
	assert.deepEqual(actionFor('theme:dracula-theme.theme-dracula', false), { type: 'search', query: 'dracula-theme.theme-dracula' });
	assert.deepEqual(actionFor('lang:ms-python.python', false), { type: 'search', query: 'ms-python.python' });
	assert.deepEqual(actionFor('lang:ms-python.python', true), { type: 'search', query: 'ms-python.python' });
});

test('installed themes open the matching picker', () => {
	assert.deepEqual(actionFor('theme:GitHub.github-vscode-theme', true), { type: 'picker', command: 'workbench.action.selectTheme' });
	assert.deepEqual(actionFor('theme:PKief.material-icon-theme', true), { type: 'picker', command: 'workbench.action.selectIconTheme' });
});

test('every listed item has an action in both states', () => {
	for (const item of ITEMS) for (const installed of [true, false]) assert.ok(actionFor(item.id, installed), item.id);
});

test('commands are never built from user input', () => {
	assert.equal(probeSpec('claude; rm -rf /'), undefined);
	assert.equal(probeSpec('--help'), undefined);
	for (const t of AI_TOOLS) assert.deepEqual(probeSpec(t.id, 'linux'), { file: t.id, args: ['--version'] });
	for (const t of AI_TOOLS) assert.deepEqual(probeSpec(t.id, 'win32'), { file: 'where', args: [t.id] });
	assert.equal(actionFor('tool:claude && calc', true), undefined);
	assert.equal(actionFor('lang:ms-python.python; evil', false), undefined);
	assert.equal(actionFor('theme:x', true), undefined);
	for (const item of ITEMS) for (const installed of [true, false]) {
		const action = actionFor(item.id, installed);
		if (action?.type === 'terminal') assert.ok(AI_TOOLS.some(t => t.id === action.command));
	}
});
