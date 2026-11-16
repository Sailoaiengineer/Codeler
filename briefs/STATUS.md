# Integration status

Merged into the main checkout:

- Task 7 run commands, language/tool guidance, and Open VSX recommendations.
- Version history and the Codeler Changes view.
- Team UI integration: team creation/joining, project selection, member approval/removal, and active project title-bar data.
- Login device-flow validation, polling tests, and setup documentation.
- Two-user Convex/Vitest coverage and the sync byte-response fix.

Verification:

- Extension tests: 36 passed, 0 failed. Files explicitly run: `auth-logic.test.ts`, `history/logic.test.ts`, `presence/logic.test.ts`, `run/logic.test.ts`, `sync/logic.test.ts`, `sync/safety.test.ts`, `sync/yjs.test.ts`, and `teams/logic.test.ts`.
- Extension type-check: passed with `--module esnext --moduleResolution bundler` over all `extensions/codeler/src/**/*.ts` using the repository VS Code declarations and Node types.
- `scripts/sync-extension.sh`: passed.
- `npm run gulp transpile-extension:codeler`: passed with 0 errors.
- Stub-load of every generated `out/**/*.js` except `out/extension.js`: passed; embedded tests passed 36/36.
- `npx vitest run` in `web/`: untested. npm was denied permission to create its machine cache directory before Vitest could start.
- No live Convex deployment, real accounts, two-machine session, or full VSCodium UI run was performed.

Open decisions for the owner:

- Ask before downloading cloudflared for preview sharing.
- Ask before downloading jq and Rust for installers/packaging.
- Configure Convex deployment and Google accounts/OAuth for login and live backend testing.

Integration note: the managed workspace permits file edits but denies writes to `.git`, so staging/commit and native branch merges could not be completed here. The integrated working tree is ready for commit when Git metadata is writable.
