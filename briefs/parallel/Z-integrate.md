# Final job: integrate everything (runs after the parallel jobs)
Read briefs/chatgpt.md and briefs/chatgpt-log.md first. You are in the main checkout.

1. If task 7 (run and languages) left uncommitted changes, check them against briefs/task-7-run-languages.md and commit them.
2. Merge, one at a time: worktree-agent-aa7c6d2111e4aba89 (version history, by Claude's helper), codex/team-ui, codex/login, codex/two-users. Resolve conflicts carefully: keep every feature's registration line in src/extension.ts and every package.json contribution; never drop someone else's code. Run the checks after each merge; if a merge breaks them, fix minimally.
3. Checks: node --test on every extensions/codeler/src/**/*.test.ts (list the files explicitly); extension type-check (--module esnext --moduleResolution bundler, all src files); scripts/sync-extension.sh; `npm run gulp transpile-extension:codeler` in vscodium/vscode; stub-load every out/**/*.js except out/extension.js; `npx vitest run` in web/ if job C added it.
4. Write briefs/STATUS.md: what is merged, test counts, what failed or is untested, and the open decisions for the owner (cloudflared download for preview sharing, jq + Rust for installers, Convex + Google accounts for login).

Commit. Stop.
