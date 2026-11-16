
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
