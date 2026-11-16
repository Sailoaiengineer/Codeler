// Shared helpers for every Codeler panel. Builds DOM with textContent so chat text can never inject HTML.
const vscode = acquireVsCodeApi();
const data = JSON.parse(document.getElementById('data').textContent);
const person = name => data.people.find(p => p.name === name) || { name, initials: name[0], color: '#2684f5' };

function el(tag, attrs = {}, ...kids) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === 'style') n.style.cssText = v;
		else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
		else n.setAttribute(k, v);
	}
	for (const k of kids.flat()) if (k != null) n.append(k);
	return n;
}

function avatar(p, online) {
	return el('div', { class: 'avatar' + (online ? ' online' : ''), style: `--c:${p.color}`, title: p.name }, p.initials);
}

// **bold**, and file.ts:12 links that open the file at that line.
function richText(text) {
	const out = [];
	for (const part of text.split(/(\*\*[^*]+\*\*|[\w./-]+\.\w+:\d+)/)) {
		if (!part) continue;
		const bold = part.match(/^\*\*(.+)\*\*$/);
		const link = part.match(/^([\w./-]+\.\w+):(\d+)$/);
		if (bold) out.push(el('b', {}, bold[1]));
		else if (link) out.push(el('a', { onclick: () => vscode.postMessage({ type: 'openLine', file: link[1], line: +link[2] }) }, part));
		else out.push(part);
	}
	return out;
}
