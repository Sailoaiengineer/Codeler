import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { checkDocument } from './tools';
import { recordActivity } from '../activity';
import { detectRunCommand, RunCommand, RunConfig, validateRunConfig } from './logic';

const configName = '.codeler/run.json';
type Item = RunCommand & { contextValue: string };

class CommandsProvider implements vscode.TreeDataProvider<Item> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;
	constructor(private getConfig: () => Promise<RunConfig>) { }
	async getChildren(): Promise<Item[]> {
		const config = await this.getConfig();
		return config.commands.map(command => ({ ...command, contextValue: config.default === command.name ? 'codelerRunCommandDefault' : 'codelerRunCommand' }));
	}
	getTreeItem(item: Item): vscode.TreeItem {
		const tree = new vscode.TreeItem(item.name, vscode.TreeItemCollapsibleState.None);
		tree.description = item.command;
		tree.tooltip = item.command;
		tree.contextValue = item.contextValue;
		return tree;
	}
	refresh() { this.changed.fire(); }
}

async function workspaceRoot(): Promise<string | undefined> {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function readConfig(): Promise<RunConfig> {
	const root = await workspaceRoot();
	if (!root) return { commands: [] };
	try {
		const value = JSON.parse(await fs.readFile(path.join(root, configName), 'utf8')) as unknown;
		const valid = validateRunConfig(value);
		if (!valid) {
			void vscode.window.showErrorMessage('Codeler run.json is invalid. Fix it before running; Codeler will not overwrite it.');
			return { commands: [] };
		}
		return valid;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') void vscode.window.showErrorMessage('Codeler could not read .codeler/run.json. Fix it before running; Codeler will not overwrite it.');
		return { commands: [] };
	}
}

async function saveConfig(config: RunConfig): Promise<void> {
	const root = await workspaceRoot();
	if (!root) return;
	await fs.mkdir(path.join(root, '.codeler'), { recursive: true });
	await fs.writeFile(path.join(root, configName), JSON.stringify(config, null, 2) + '\n', 'utf8');
}

async function detect(): Promise<RunCommand | undefined> {
	const root = await workspaceRoot();
	if (!root) return undefined;
	const uris = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,dist,build,.codeler}/**');
	const files: string[] = [];
	const contents: Record<string, string> = {};
	for (const uri of uris) {
		const relative = path.relative(root, uri.fsPath).split(path.sep).join('/');
		files.push(relative);
		if (path.basename(relative) === 'package.json') {
			try { contents[relative] = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'); } catch { /* detection can continue */ }
		}
	}
	return detectRunCommand(files, contents);
}

async function configWithDefault(): Promise<RunConfig> {
	const config = await readConfig();
	if (config.default || config.commands.length) return config;
	const found = await detect();
	if (!found) return config;
	const choice = await vscode.window.showInformationMessage(`Codeler detected ${found.command}. Save it as the default run command?`, 'Save', 'Not now');
	if (choice !== 'Save') return { commands: [found] };
	const saved = { commands: [found], default: found.name };
	await saveConfig(saved);
	return saved;
}

let terminal: vscode.Terminal | undefined;
let running = false;
async function runCommand(command: RunCommand): Promise<void> {
	if (!terminal || terminal.exitStatus !== undefined) terminal = vscode.window.createTerminal(`Codeler: ${command.name}`);
	terminal.show(true);
	if (running) { terminal.sendText('\u0003', false); await new Promise(resolve => setTimeout(resolve, 100)); }
	terminal.sendText(command.command, true);
	running = true;
	void recordActivity('run', command.name);
}

async function inputCommand(existing?: RunCommand): Promise<RunCommand | undefined> {
	const name = await vscode.window.showInputBox({ prompt: 'Run command name', value: existing?.name, validateInput: value => value.length > 500 ? 'Use 500 characters or fewer.' : undefined });
	if (name === undefined) return undefined;
	const command = await vscode.window.showInputBox({ prompt: 'Command', value: existing?.command, validateInput: value => value.length > 500 ? 'Use 500 characters or fewer.' : undefined });
	return command === undefined ? undefined : { name, command };
}

export function startRun(ctx: vscode.ExtensionContext): vscode.Disposable {
	const provider = new CommandsProvider(configWithDefault);
	const subscriptions: vscode.Disposable[] = [
		vscode.window.registerTreeDataProvider('codeler.runCommands', provider),
		vscode.workspace.onDidOpenTextDocument(document => { void checkDocument(ctx, document); }),
		vscode.window.onDidCloseTerminal(item => { if (item === terminal) running = false; }),
		vscode.commands.registerCommand('codeler.openHtml', async () => {
			const editor = vscode.window.activeTextEditor;
			if (editor) await vscode.commands.executeCommand('simpleBrowser.show', editor.document.uri.toString());
		}),
		vscode.commands.registerCommand('codeler.run', async () => {
			const config = await configWithDefault();
			const command = config.commands.find(item => item.name === config.default) ?? config.commands[0];
			if (!command) return void vscode.window.showErrorMessage('Codeler could not find a run command for this project.');
			await runCommand(command);
		}),
		vscode.commands.registerCommand('codeler.runCommand', (item: RunCommand) => runCommand(item)),
		vscode.commands.registerCommand('codeler.addRunCommand', async () => { const item = await inputCommand(); if (!item) return; const config = await readConfig(); config.commands.push(item); if (!config.default) config.default = item.name; await saveConfig(config); provider.refresh(); }),
		vscode.commands.registerCommand('codeler.editRunCommand', async (item: RunCommand) => { const replacement = await inputCommand(item); if (!replacement) return; const config = await readConfig(); const index = config.commands.findIndex(value => value.name === item.name); if (index < 0) return; config.commands[index] = replacement; if (config.default === item.name) config.default = replacement.name; await saveConfig(config); provider.refresh(); }),
		vscode.commands.registerCommand('codeler.deleteRunCommand', async (item: RunCommand) => { const config = await readConfig(); config.commands = config.commands.filter(value => value.name !== item.name); if (config.default === item.name) delete config.default; await saveConfig(config); provider.refresh(); }),
		vscode.commands.registerCommand('codeler.setDefaultRunCommand', async (item: RunCommand) => { const config = await readConfig(); config.default = item.name; await saveConfig(config); provider.refresh(); })
	];
	void checkDocument(ctx, vscode.window.activeTextEditor?.document);
	return vscode.Disposable.from(...subscriptions);
}
