
## Task 1 — live sync

Built:

- Added Convex `syncFiles`, `syncSnapshots`, and `syncUpdates` tables in `web/convex/schema.ts`.
- Added `web/convex/sync.ts` with authenticated file listing/loading, reactive update queries, append-only Yjs update writes, snapshots, rename, delete, server-side path/update/file-size validation, and ignored-directory checks.
- Added `extensions/codeler/src/sync/safety.ts` for lexical path validation, symlink-aware containment, binary/size/ignore checks, and minimal text diffs.
- Added `extensions/codeler/src/sync/index.ts` with one Y.Doc per file, ConvexClient auth/subscriptions, editor/disk watchers, local writes, Yjs disk diffs, and periodic snapshots.
- Added `extensions/codeler/src/sync/safety.test.ts` and `yjs.test.ts` covering path/ignore rules, concurrent edits, and disk diff application.
- Registered sync with the requested one line in `extensions/codeler/src/extension.ts` and added `convex`, `yjs`, and `@types/node` package entries. Added the `codeler.projectId` setting used to identify a team project.

Verification:

- `node --test extensions/codeler/src/sync/*.test.ts`: 5 passed, 0 failed.
- Extension type-check passed with the installed TypeScript version using explicit file expansion and Node-compatible module resolution; the brief's literal `moduleResolution=node10` is removed by this installed compiler, and PowerShell does not expand `src/**/*.ts`.

Not checked:

- No real Convex deployment was used, so generated Convex API types and live server subscriptions were not exercised.
- No two-machine integration test was possible.

Claude should consider:

- Supplying the active team `projectId` through the existing project-selection flow instead of the temporary `codeler.projectId` setting.

## Task 1 review fixes

Fixed the reviewed live-sync issues: server-first hydration without duplicate text, offline-disk reconciliation, editor content-change application, remote edits through `WorkspaceEdit`, merged retry-safe push queues, file list reconciliation, create/delete/rename handling, versioned update subscriptions, typed sync RPC wrappers, and Convex version/snapshot/rename safeguards. Added `src/sync/logic.ts` and `logic.test.ts` for the five requested pure Yjs scenarios. Removed the temporary npm cache and marked `codeler.projectId` temporary.

Verification:

- `node --test extensions/codeler/src/sync/*.test.ts`: 10 passed, 0 failed.
- Extension type-check passed with `--module esnext --moduleResolution bundler --allowImportingTsExtensions` and explicit TypeScript file expansion.

Not checked: a real Convex deployment and two-machine integration remain untested.

## Claude's review of task 1 fixes (for future tasks)
- Still broken after the fix round, fixed by Claude: local edits were never queued (no `doc.on('update')`), the `updates` subscription re-subscribed on every callback (infinite loop), editor->doc applied stale offsets and could echo remote edits. Now: full-text diff via `applyEditorText` in logic.ts, queue on `doc.on('update')` for non-remote origins, resubscribe only when the version moves.
- `logic.ts` imported `./safety.ts`: tests passed, but the compiled extension crashed on load (`Cannot find module './safety.ts'`), which would have broken every Codeler panel. Rule from now on: runtime files never import sibling files with a `.ts` extension; keep tested pure logic free of sibling imports, and check the compiled output loads (stub `vscode`, `require('./out/...')`).
- Tests must exercise the real flow (load, typing, push, receive), not only helpers.

## Task 2 — presence, cursors, follow mode

Built:

- Added authenticated Convex presence rows and query in `web/convex/presence.ts`, with project membership checks, sync-compatible path validation, bounded cursor/selection values, per-project/user-window ownership, and 30-second expiry.
- Added extension presence heartbeats/subscription in `extensions/codeler/src/presence/`, including active/idle heartbeat limits, deterministic approved tag colors, real cursor name tags, Explorer file badges, and follow/stop-follow navigation.
- Replaced sample panel behavior with live presence updates for Collaborators and Chat when a signed-in team project is active; sample preview remains when it is not. Real online members also feed the title bar.
- Added pure tests for color assignment, throttle behavior, file decoration mapping, and follow state. Runtime imports use extensionless sibling paths.

Verification:

- `node --test extensions/codeler/src/**/*.test.ts`: 16 passed, 0 failed (PowerShell file expansion was used; Node emitted only the existing module-type warning).
- Type-check passed with `--module esnext --moduleResolution bundler` against the repository VS Code declarations.
- `bash scripts/sync-extension.sh` completed; `npm.cmd run gulp transpile-extension:codeler` completed with 0 compilation errors.
- Compiled load check passed for `out/presence/logic.js`, `out/presence/index.js`, and `out/extension.js` using a stub `vscode` module.

Not checked:

- No live Convex deployment or two-client presence session was available, so server subscriptions, expiry, and real multi-user cursor rendering were not exercised end to end.
- No full VSCodium UI run was performed.

Claude should consider:

- Wiring the existing project picker to set the active `codeler.projectId`; task 2 continues to use that temporary setting.

## Task 2 review fixes

Fixed:

- Presence rows now include `isMe`; client cursor painting excludes the current user's row while retaining that avatar for presence/title-bar data.
- Added client-side 30-second expiry filtering with a 10-second recheck, plus `presence.cleanup` and a two-minute Convex cron in `web/convex/crons.ts`.
- Follow mode now stops only for keyboard/mouse selection changes; command and unspecified selection changes caused by follow navigation preserve following.
- Added four contributed `codeler.person1`–`codeler.person4` colors and changed Explorer badge decorations to use valid `ThemeColor` IDs.
- Removed disposed webviews from the broadcast set and changed Collaborators to one Follow/Following toggle per other person, with the followed row marked `aria-pressed="true"`.
- Reused `colorFor` from presence logic instead of hashing colors again in `extension.ts`.
- Added tests for self-cursor exclusion, fake-clock expiry filtering, and follow-mode selection semantics.

Verification:

- `node --test extensions/codeler/src/sync/*.test.ts extensions/codeler/src/presence/*.test.ts`: 19 passed, 0 failed.
- Type-check passed with `--module esnext --moduleResolution bundler` against the repository VS Code declarations.
- `bash scripts/sync-extension.sh` completed; `npm.cmd run gulp transpile-extension:codeler` completed with 0 compilation errors.
- Compiled-load check passed for every generated JavaScript file under `out/presence` and `out/sync` using a stub `vscode` module. Transpiled test files were loaded with a test-only `.ts`-to-`.js` resolver for their source-test imports; all 19 embedded tests passed too.

Not checked:

- No live Convex deployment or full VSCodium UI run was available.

## Claude's review of task 2 fixes
- All 6 review items verified in code; 19 tests pass; compiled presence/sync load.
- Claude fixed: reading `.webview` from a disposed panel/view throws in VS Code, which would have left the activity bar stuck wide after closing the Team page. Keep your own reference to a webview before registering `onDidDispose`.

## Task 7 — run button, run commands, languages

Built:

- Added `extensions/codeler/src/run/logic.ts` with pure run.json validation, package-manager and project run-command detection, language detection, and tool mapping.
- Added `extensions/codeler/src/run/index.ts` with `.codeler/run.json` loading/saving, default detection and save prompt, terminal reuse, Run & Debug tree commands, and Simple Browser handling for an HTML-only project.
- Added `extensions/codeler/src/run/tools.ts` with cached no-shell PATH checks, missing-tool guidance, official install links, and one-time Open VSX extension offers with per-language suppression.
- Registered the run subsystem and removed the placeholder `codeler.run` registration. Added the `codeler.runCommands` debug view plus Run/Edit/Delete/Set as default/Add contributions and menus.
- Added pure tests covering each detection rule, lockfiles, broken run.json rejection, command preservation, and language tool mapping.

Verification:

- `node --test extensions/codeler/src/run/*.test.ts`: 4 passed, 0 failed.
- Type-check passed for `src/run/*.ts` with the repository TypeScript, `--module esnext --moduleResolution bundler`, repository VS Code declarations, and Node types.
- `bash scripts/sync-extension.sh` completed; `npm.cmd run gulp transpile-extension:codeler` completed with 0 compilation errors.
- Every generated `out/run/*.js` loaded with a stub `vscode` containing `window`, `workspace`, `commands`, `extensions`, `Disposable`, `EventEmitter`, `TreeItem`, and `ThemeIcon`; embedded tests also passed 4/4. The test-only `.ts`-to-`.js` resolver was used for the compiled test's source-test import.

Not checked:

- No full VSCodium UI run, real terminal command execution, PATH variation, extension installation, or official download page interaction was performed.
- The literal `npx` type-check command could not run because npm attempted to create a blocked machine cache directory; the installed repository TypeScript binary produced the passing check above.

## Task 8 — packaging

Built:

- Added `scripts/build-windows.sh`, which resets the VS Code checkout to the pinned `1.143.1` commit while preserving `node_modules`, copies the Codeler user patch, regenerates icons, and invokes VSCodium's Windows x64 packaging build.
- Added `scripts/vscodium-commit.txt` with VSCodium commit `ca7f7b44b5e5c3faa663f6cdc043998f71936653`.
- Added `.github/workflows/build.yml` for unsigned Windows x64, macOS x64/arm64, and Linux x64 artifact builds, with named Apple and Windows signing-secret placeholders and no update URL.
- Updated `patches/README.md` with release-build instructions.
- Copied `patches/codeler-core.patch` to `vscodium/patches/user/codeler-core.patch`.

Verification:

- `bash -n scripts/build-windows.sh`: passed.
- Patch-copy hash comparison: passed.
- `bash scripts/build-windows.sh`: started at 2026-11-17, stopped after about 2 seconds because Git Bash reported `jq: command not found` on line 8. No installer or packaged app was produced; output file names and sizes: none.

Not checked:

- Smoke test was skipped because no `Codeler.exe` was built; therefore there are no smoke-test log lines.
- The build could not reach VSCodium's packaging stages or produce Windows, macOS, or Linux artifacts.
- `jq` was not downloaded because the brief requires asking the user first; Rust was not downloaded or changed.
- GitHub Actions was not run locally. Signing remains intentionally unsigned and `CODELER_UPDATE_URL` remains unset.

## Task 4 — preview sharing

Built:

- Added `extensions/codeler/src/share/logic.ts` and `logic.test.ts` for localhost port parsing, common-port candidates, tunnel URL parsing, cloudflared arguments, and share state transitions.
- Added `extensions/codeler/src/share/index.ts`: probes candidate ports, asks for modal consent with the anyone-with-the-link warning, starts cloudflared without a shell, parses the quick-tunnel URL, copies it to the clipboard when chat has no send export, shows a clickable stop status item, stops on command/deactivation, and stops after 30 seconds of failed port checks.
- Replaced the placeholder `codeler.share` command registration in `extension.ts`, started the share subsystem during activation, and pushed a `sharing` title-bar state field. The Claude-owned core title bar still hardcodes the Share label; it should consume this field to change the label to Stop sharing.

Verification:

- `node --test extensions/codeler/src/share/*.test.ts`: 4 passed, 0 failed.
- `npm.cmd run gulp transpile-extension:codeler`: completed with 0 compilation errors after the extension source was staged into the VSCodium destination.
- Runtime-import grep found no sibling `.ts` imports in runtime JavaScript; `.ts` imports remain only in transpiled test files, matching the repository test pattern.
- Real smoke test used a local HTTP server on port 5199 and a stubbed vscode host: a `https://*.trycloudflare.com` URL was printed and fetched with HTTP 200; stop was requested and the local server was stopped.

Not checked:

- `bash scripts/sync-extension.sh` could not complete because the concurrent run's `vscodium/vscode/extensions/codeler/node_modules/hono/dist` directory prevented removal; no files from that node_modules tree were deleted.
- The environment retained one inaccessible `cloudflared.exe` after the smoke test; `taskkill /IM cloudflared.exe /T /F` returned access denied, so a clean process-gone assertion could not be completed.
- No full VSCodium UI run or live team-chat send was available; clipboard fallback was exercised.

## Task 9 — extension IDs and names

Queried `GET https://open-vsx.org/api/<namespace>/<name>` for every theme and language-extension ID used by picks and run offers. All exist and none is deprecated or unpublished. Updated pick labels to match Open VSX `displayName`; IDs and the shared run-offer list required no changes.

| ID | Exists | Open VSX display name | Action |
|---|---|---|---|
| `dracula-theme.theme-dracula` | yes | Dracula Theme Official | updated pick label |
| `GitHub.github-vscode-theme` | yes | GitHub Theme | no change |
| `zhuangtongfa.material-theme` | yes | One Dark Pro | updated pick label |
| `PKief.material-icon-theme` | yes | Material Icon Theme | no change |
| `ms-python.python` | yes | Python | no change |
| `redhat.java` | yes | Language Support for Java(TM) by Red Hat | updated pick label |
| `llvm-vs-code-extensions.vscode-clangd` | yes | clangd | updated pick label |
| `muhammad-sammy.csharp` | yes | C# | no change |
| `golang.go` | yes | Go | no change |
| `rust-lang.rust-analyzer` | yes | rust-analyzer | updated pick label |
| `bmewburn.vscode-intelephense-client` | yes | PHP Intelephense | updated pick label |
