// shortcut: only the Node globals this extension uses, instead of downloading @types/node
declare const Buffer: { from(b: Uint8Array): { toString(enc: string): string } };
