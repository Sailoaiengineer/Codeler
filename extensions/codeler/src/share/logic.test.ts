import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { candidatePorts, cloudflaredArgs, cloudflaredCandidates, cloudflaredUrl, describeService, nextState, parsePorts, parseTitle, shareMinutes, shouldAutoStop } from './logic.ts';

test('consent names the page title, then the server header, else an unknown service', () => {
	assert.equal(parseTitle('<html><head><TITLE>\n My  App\u0007 </title></head>'), 'My App');
	assert.equal(parseTitle('<html>no title</html>'), undefined);
	assert.equal(describeService({ title: 'Vite + React' }), '"Vite + React"');
	assert.equal(describeService({ server: 'Werkzeug/3.0' }), 'a server (Werkzeug/3.0)');
	assert.equal(describeService({}), 'an unknown service');
	assert.equal(describeService(undefined), 'an unknown service');
});

test('sharing auto-stops after the limit and the limit stays in range', () => {
	assert.equal(shouldAutoStop(0, 119 * 60_000, 120), false);
	assert.equal(shouldAutoStop(0, 120 * 60_000, 120), true);
	assert.equal(shareMinutes(undefined), 120);
	assert.equal(shareMinutes(0), 1);
	assert.equal(shareMinutes(99999), 1440);
	assert.equal(shareMinutes('10'), 120);
});

test('cloudflared is looked up only in absolute PATH folders and install folders', () => {
	const files = cloudflaredCandidates('.;bin;C:\\Tools\\;D:\\bin;C:\\Tools\\', ['C:\\Program Files']);
	assert.deepEqual(files, ['C:\\Tools\\cloudflared.exe', 'D:\\bin\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe']);
	assert.equal(files.some(f => f.startsWith('.') || f.startsWith('bin')), false);
});

test('parses localhost ports and ignores invalid values', () => {
	assert.deepEqual(parsePorts('ready at http://localhost:5173\nhttp://127.0.0.1:3000'), [5173, 3000]);
	assert.deepEqual(parsePorts('http://localhost:0 http://localhost:70000'), []);
});

test('includes common preview ports without duplicates', () => {
	assert.deepEqual(candidatePorts('http://localhost:5173'), [5173, 3000, 4321, 8000, 8080]);
});

test('parses tunnel URLs and builds safe arguments', () => {
	assert.equal(cloudflaredUrl('INF https://blue-sky.trycloudflare.com\n'), 'https://blue-sky.trycloudflare.com');
	assert.deepEqual(cloudflaredArgs(5199), ['tunnel', '--url', 'http://127.0.0.1:5199', '--no-autoupdate']);
});

test('keeps sharing state transitions explicit', () => {
	assert.equal(nextState('idle', 'start'), 'starting');
	assert.equal(nextState('starting', 'started'), 'sharing');
	assert.equal(nextState('sharing', 'stop'), 'stopping');
	assert.equal(nextState('stopping', 'stopped'), 'idle');
});
