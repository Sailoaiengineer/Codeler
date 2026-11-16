import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { languageForFile, toolForLanguage, Language } from './logic';

const installIds: Partial<Record<Language, string>> = { python: 'ms-python.python', java: 'redhat.java', cpp: 'llvm-vs-code-extensions.vscode-clangd', csharp: 'muhammad-sammy.csharp', go: 'golang.go', rust: 'rust-lang.rust-analyzer', php: 'bmewburn.vscode-intelephense-client' };
const pages: Record<string, string> = { python: 'https://www.python.org/downloads/', javascript: 'https://nodejs.org/en/download', typescript: 'https://nodejs.org/en/download', java: 'https://adoptium.net/temurin/releases/', go: 'https://go.dev/dl/', rust: 'https://rustup.rs/', csharp: 'https://dotnet.microsoft.com/en-us/download', php: 'https://www.php.net/downloads.php', cpp: 'https://www.msys2.org/' };
const checked = new Map<string, boolean>();

function hasTool(tools: string[]): Promise<boolean> {
	return Promise.all(tools.map(tool => new Promise<boolean>(resolve => execFile(tool, ['--version'], { timeout: 3000, windowsHide: true }, error => resolve(!error))))).then(results => results.some(Boolean));
}

export async function checkDocument(ctx: vscode.ExtensionContext, document: vscode.TextDocument | undefined): Promise<void> {
	if (!document || document.uri.scheme !== 'file') return;
	const language = languageForFile(document.fileName);
	if (!language) return;
	const tool = toolForLanguage(language);
	const candidates = language === 'python' ? ['python', 'py'] : language === 'cpp' ? ['gcc', 'clang'] : tool ? [tool] : [];
	const cacheKey = language;
	if (candidates.length && !checked.has(cacheKey)) checked.set(cacheKey, await hasTool(candidates));
	if (candidates.length && checked.get(cacheKey) === false && !ctx.globalState.get(`toolMissing.${language}`)) {
		const choice = await vscode.window.showWarningMessage(`${language[0].toUpperCase() + language.slice(1)} isn't installed on this computer, so Codeler can't run or debug ${document.fileName.split('.').pop()} files yet.`, 'How to install', "Don't show again");
		if (choice === 'How to install') await vscode.env.openExternal(vscode.Uri.parse(pages[language]));
		if (choice === "Don't show again") await ctx.globalState.update(`toolMissing.${language}`, true);
	}
	const id = installIds[language];
	if (id && !vscode.extensions.getExtension(id) && !ctx.globalState.get(`extensionMissing.${language}`)) {
		const choice = await vscode.window.showInformationMessage(`Install the ${language} language extension for Codeler?`, 'Install', "Don't show again");
		if (choice === 'Install') await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
		if (choice === "Don't show again") await ctx.globalState.update(`extensionMissing.${language}`, true);
	}
}
