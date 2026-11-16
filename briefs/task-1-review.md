# Task 1 review (from Claude) — fix these, same rules as before

Your server side (`web/convex/sync.ts`) and `safety.ts` are mostly fine. The extension side has bugs that make live sync unusable. Fix all of them, add the tests listed, then append to `briefs/chatgpt-log.md` and stop. Don't touch files outside the ones you already own (plus the schema section you added).

## Must fix (extension, `src/sync/index.ts`)
1. **Content doubles on first load.** `ensure()` inserts the local disk text into a fresh `Y.Doc`, then applies the server snapshot. Two independent inserts of the same text merge into the text twice. Fix: if the server has the file, build the doc **only** from server state, then diff the local disk text against it with `textDiff` (so offline edits become a normal update). Only when the server has no file, seed from disk and push that as the first update.
2. **Editor typing never syncs.** `onDidChangeTextDocument` only overwrites `state.disk`; nothing goes into `state.text`, so nothing is queued. Apply each `contentChanges` entry (`rangeOffset`, `rangeLength`, `text`, applied in the order VS Code gives them) to `state.text` inside a local transaction. Skip changes caused by applying remote updates.
3. **Remote updates ignore open editors.** When a file is open, apply remote changes to the `TextDocument` with a `WorkspaceEdit` built from the Yjs `text` delta (observe `state.text` events with origin `'remote'`), not by rewriting the disk under it. Write to disk only when the file isn't open, or after the editor is saved. Guard against the editor change bouncing back as a local edit.
4. **Edits are lost if a push fails.** `push()` splices the queue before the mutation and drops it on error. Keep updates queued until the mutation succeeds; merge them with `Y.mergeUpdates` before sending so a backlog goes as one update; retry with backoff.
5. **New, deleted and renamed files.** Subscribe once to `sync:listFiles` and react: start syncing files that appear, delete local files that disappear (only if the local copy has no unsent edits; otherwise keep it and warn), handle renames. Send local creates/deletes/renames (`onDidCreate`/`onDidDelete` from the watcher and `workspace.onDidRenameFiles`).
6. **One subscription per file with a fixed `afterVersion` resends everything every time.** Use `loadFile` once, then subscribe to `updates` with the version you have, and re-subscribe with the new version when it moves (or have `updates` return only rows after a version the client passes on each change). Applying an update twice is harmless in Yjs, but don't rely on it for performance.
7. Remove the `@ts-expect-error` on the Yjs import. Use a normal `import * as Y from 'yjs'` and type-check with `--moduleResolution bundler --module esnext` (the extension is bundled by esbuild).
8. Replace `(client as any)` calls with typed calls (`anyApi.sync.pushUpdates` from `convex/server`, or a small typed wrapper) so wrong argument names fail at compile time.

## Should fix (server, `web/convex/sync.ts`)
- `pushUpdates`/`updates` read every update row each time. Keep the latest version on the `syncFiles` row (`version` field) and query updates with `.gt("version", afterVersion)` on the index.
- `saveSnapshot`: also delete older `syncSnapshots` rows for that file, and only accept a snapshot whose version is ≤ the file's current version.
- `deleteFile` and `renameFile`: reject renaming onto a path that already exists.

## Tests to add (Node's runner, no Convex needed — pull the logic into pure functions so they're testable)
- Two clients start from the same server state and the same disk text: after load, both docs equal the disk text exactly once.
- Client with offline disk edits loads server state: result = server text plus the disk diff, no duplication.
- A sequence of VS Code-style `contentChanges` (including multi-cursor edits in one event) applied to a `Y.Text` produces the same text as the editor.
- Push failure keeps the queue; the next successful push sends the merged backlog and the other client converges.
- Concurrent edits from two clients at the same position converge to the same text on both.

## Housekeeping
- Delete `extensions/codeler/.npm-cache/` (use the default npm cache).
- Keep the `codeler.projectId` setting for now, marked temporary in its description; Claude will replace it with the Workspaces picker.
