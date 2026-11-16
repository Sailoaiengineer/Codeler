import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { detectRunCommand, packageManager, toolForLanguage, validateRunConfig } from './logic.ts';

test('detects package scripts and lockfile package managers', () => {
	assert.deepEqual(detectRunCommand(['package.json', 'pnpm-lock.yaml'], { 'package.json': '{"scripts":{"dev":"vite"}}' }), { name: 'Dev server', command: 'pnpm run dev' });
	assert.equal(packageManager(['yarn.lock']), 'yarn');
	assert.equal(packageManager(['bun.lock']), 'bun');
});
test('detects each supported project rule', () => {
	const cases: [string[], Record<string, string>, string][] = [
		[['pyproject.toml'], {}, 'python main.py'], [['main.py'], {}, 'python main.py'], [['go.mod'], {}, 'go run .'], [['Cargo.toml'], {}, 'cargo run'], [['pom.xml'], {}, 'mvn exec:java'], [['build.gradle'], {}, 'gradle run'], [['App.csproj'], {}, 'dotnet run'], [['index.php'], {}, 'php -S localhost:8000'], [['index.c'], {}, 'gcc "index.c" -o "index.codeler-run" && "index.codeler-run"'], [['index.html'], {}, 'codeler.openHtml']
	];
	for (const [files, contents, command] of cases) assert.equal(detectRunCommand(files, contents)?.command, command);
});
test('rejects broken run configuration and preserves commands exactly', () => {
	assert.equal(validateRunConfig({ commands: [{ name: 'x', command: ' a && b ' }], default: 'missing' }), undefined);
	assert.deepEqual(validateRunConfig({ commands: [{ name: 'x', command: ' a && b ' }], default: 'x' })?.commands[0].command, ' a && b ');
});
test('maps language tools', () => { assert.equal(toolForLanguage('python'), 'python'); assert.equal(toolForLanguage('cpp'), 'gcc'); assert.equal(toolForLanguage('rust'), 'cargo'); });
