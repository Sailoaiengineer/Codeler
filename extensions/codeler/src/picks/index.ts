import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { ITEMS, GROUPS, AI_TOOLS, BUILTIN_ITEM, Group, ToolId, actionFor, extensionIdOf, probeSpec, statusLabel, toolIdOf } from './logic';

// Each CLI is probed once per session. Results are kept so the tree and the click handler share them.
const toolState = new Map<ToolId, boolean>();
const probes = new Map<ToolId, Promise<boolean>>();
function probeTool(toolId: ToolId): Promise<boolean> {
	let probe = probes.get(toolId);
	if (!probe) {
		const spec = probeSpec(toolId);
		probe = spec
			? new Promise<boolean>(resolve => execFile(spec.file, [...spec.args], { timeout: 3000, windowsHide: true }, err => resolve(!err)))
			: Promise.resolve(false);
		probe = probe.then(ok => { toolState.set(toolId, ok); return ok; });
		probes.set(toolId, probe);
	}
	return probe;
}

// Synchronous view of the install state, for the tree. Undefined while a CLI check is still running.
function knownState(itemId: string): boolean | undefined {
	const toolId = toolIdOf(itemId);
	if (toolId) return toolState.get(toolId);
	return itemId === BUILTIN_ITEM || vscode.extensions.getExtension(extensionIdOf(itemId)) !== undefined;
}

async function choose(itemId: unknown) {
	if (typeof itemId !== 'string' || !ITEMS.some(i => i.id === itemId)) return;
	const toolId = toolIdOf(itemId);
	if (toolId) await probeTool(toolId);
	const action = actionFor(itemId, knownState(itemId) ?? false);
	if (!action) return;
	switch (action.type) {
		case 'terminal': {
			const terminal = vscode.window.createTerminal({ name: action.name });
			terminal.show();
			terminal.sendText(action.command);
			break;
		}
		case 'url':
			void vscode.env.openExternal(vscode.Uri.parse(action.url));
			break;
		case 'setTheme':
			await vscode.workspace.getConfiguration().update('workbench.colorTheme', action.name, vscode.ConfigurationTarget.Global);
			break;
		case 'picker':
			await vscode.commands.executeCommand(action.command);
			break;
		case 'search':
			await vscode.commands.executeCommand('workbench.extensions.search', action.query);
			break;
	}
}

export function startPicks(_ctx: vscode.ExtensionContext): vscode.Disposable {
	const changed = new vscode.EventEmitter<string | undefined>();
	const refresh = () => changed.fire(undefined);
	const tree: vscode.TreeDataProvider<string> = {
		onDidChangeTreeData: changed.event,
		getChildren(element?: string): string[] {
			if (!element) return GROUPS.map(g => `group:${g.id}`);
			if (!element.startsWith('group:')) return [];
			const group = element.slice('group:'.length) as Group;
			return ITEMS.filter(i => i.group === group).map(i => i.id);
		},
		getTreeItem(element: string): vscode.TreeItem {
			if (element.startsWith('group:')) {
				const group = GROUPS.find(g => `group:${g.id}` === element);
				return { label: group?.label, id: element, collapsibleState: vscode.TreeItemCollapsibleState.Expanded };
			}
			const item = ITEMS.find(i => i.id === element);
			const state = knownState(element);
			return {
				label: item?.label,
				id: element,
				description: statusLabel(element, state),
				iconPath: new vscode.ThemeIcon(state ? 'check' : 'circle-outline'),
				command: { command: 'codeler.picks.choose', title: 'Open', arguments: [element] },
			};
		},
	};
	const view = vscode.window.createTreeView('codeler.extensionPicks', { treeDataProvider: tree });
	// The CLI checks start the first time the Extensions view shows this tree, not at startup.
	view.onDidChangeVisibility(e => {
		if (!e.visible) return;
		for (const t of AI_TOOLS) void probeTool(t.id).then(refresh);
	});
	return vscode.Disposable.from(
		view,
		changed,
		vscode.extensions.onDidChange(refresh),
		vscode.commands.registerCommand('codeler.picks.choose', choose),
	);
}
