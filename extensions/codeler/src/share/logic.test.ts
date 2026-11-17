import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { candidatePorts, cloudflaredArgs, cloudflaredUrl, nextState, parsePorts } from './logic.ts';

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
