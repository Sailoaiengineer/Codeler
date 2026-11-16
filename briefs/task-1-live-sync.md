# Task 1 for ChatGPT: live sync

Read `briefs/chatgpt.md` first (project background, folder rules, decisions). This file is your only task for this run. Do task 1 only, then stop.

## Goal
Team projects stay identical on every member's computer: edits typed in Codeler and edits made on disk (terminal, AI tools) reach everyone within about a second, and two people typing in the same file at once never lose text.

## What exists
- `web/convex/schema.ts` (Claude's): `teams`, `members`, `projects`, … You may **add your own tables at the end** of the `defineSchema({...})` object under a `// ChatGPT: live sync` comment. Don't edit the existing tables.
- `web/convex/access.ts` (Claude's): `requireProjectMember(ctx, projectId)`. **Every** sync query/mutation must call it first.
- `extensions/codeler/src/auth.ts` (Claude's): `Auth` with `convexToken()` for a short-lived Convex JWT. Login itself isn't finished yet (it's the last step), so your code must work once a token exists and do nothing (no errors, no spinning) while signed out.
- `extensions/codeler/src/extension.ts` (Claude's): register your feature with **one line** in `activate`, e.g. `ctx.subscriptions.push(startSync(ctx, auth));`. Don't edit anything else there.

## What to build
1. **Convex side** (`web/convex/sync.ts` and your tables): per file, an append-only log of Yjs updates plus a periodic compacted snapshot; queries to load a file's state and subscribe to new updates; a mutation to push updates; list/create/rename/delete files. Store paths as project-relative POSIX strings.
2. **Extension side** (`extensions/codeler/src/sync/`): one `Y.Doc` per open or changed file. Apply remote updates to open editors (preserve the local cursor and undo stack as well as the API allows) and write them to the local copy. Watch the project folder for disk changes and turn them into Yjs updates (diff old/new text, don't replace the whole file). Use the `convex` npm client (`ConvexClient`) with `setAuth(() => auth.convexToken())` for live subscriptions.
3. **Safety rules** (put them in one small module with tests):
   - Reject any path that is absolute, contains `..`, a drive letter, a NUL byte, or resolves (after symlinks) outside the project folder.
   - Skip `node_modules/`, `.git/`, `.codeler/`, `dist/`, `out/`, `.next/`, and files over 2 MB or that look binary.
   - Server side: validate the same path rules again in Convex (never trust the client); cap update size.

## Allowed
- `npm install` of npm packages you need (`yjs`, `convex`, …) in `extensions/codeler` and `web`. Nothing that isn't an npm package.
- New files under `web/convex/` and `extensions/codeler/src/sync/`, the one-line registration, the schema addition, `package.json` dependency entries.

## Not allowed
- Editing Claude's files beyond the lines above, anything under `vscodium/`, `web/src/`, `extensions/codeler/media/`.
- Creating accounts, running `npx convex dev` against a real deployment, or downloading non-npm tools. If something needs a Convex account (e.g. codegen), write the code anyway, note it in the log and continue.

## Verify
- Unit tests with Node's built-in runner (Node 24 runs `.ts` directly): `node --test extensions/codeler/src/sync/*.test.ts`. Cover: path rules, ignore rules, two concurrent edits to the same line merging without loss, disk diff → Yjs update → same text.
- Type-check the extension: from `extensions/codeler`, run `..\..\vscodium\vscode\node_modules\.bin\tsc --ignoreConfig --noEmit --strict --target ES2024 --lib ES2024,DOM --module commonjs --moduleResolution node --types "" --skipLibCheck --esModuleInterop src/**/*.ts ..\..\vscodium\vscode\src\vscode-dts\vscode.d.ts` (adjust the glob for your shell). If errors appear only in Claude's files, list them in the log instead of fixing them.

## When done
Append to `briefs/chatgpt-log.md`: what you built (file list), test output, what you could not test (anything needing a real Convex deployment or two machines), and anything you think Claude should change in its files. Then stop.
