# Codeler — brief for ChatGPT (Codex)

You are building part of **Codeler**: a free, open-source (MIT) desktop code editor made from a fork of VSCodium 1.143.1, where a team edits the same code live, chats, sees each other's cursors, and runs/previews what they build. It never charges for or takes a cut of anything users make.

Claude owns the layout, login, the team backend and the final security review. **Don't change those parts**; if you need something from them, write it in `briefs/requests-from-chatgpt.md` and stop on that item.

## Folder map (`C:\Users\Sailesh\.vscode-shared\codeler\`)

| Path | What | Who edits |
|---|---|---|
| `extensions/codeler/` | Built-in extension: panels, title-bar data, sign-in (`src/auth.ts`), sample data | Claude; you add **new files** under `src/` and `media/` and register them in `extension.ts` with one line each |
| `vscodium/vscode/src/vs/workbench/browser/parts/titlebar/codelerTitlebar.ts`, `.../activitybar/media/codeler.css` | Core title bar + labelled activity bar | Claude only |
| `web/convex/` | Convex backend (Better Auth local install, `users.ts`) | Claude owns `auth.ts`, `betterAuth/`, `users.ts`, teams/members; you add your own files (e.g. `files.ts`, `presence.ts`, `history.ts`) |
| `web/src/` | Next.js sign-in site | Claude only |
| `scripts/sync-extension.sh` | Copies the extension into the VS Code tree | — |

Run `scripts/sync-extension.sh` after changing the extension; dev builds read it from `vscodium/vscode/extensions/codeler`.

## Decisions already made (don't revisit)
- Desktop app on Windows, macOS, Linux. Convex + Better Auth, **no Supabase**. Google sign-in only, through the device flow in `extensions/codeler/src/auth.ts`. Use `auth.query()` / `auth.convexToken()` for Convex calls; never store tokens outside `context.secrets`.
- Teams: owner sets a team password; joiners enter code + password and wait for Owner/Admin approval. Roles: Owner / Admin / Member. Many teams per person, many projects per team.
- Solo projects are normal folders on disk. Team projects live in Convex and every member keeps a **synced local copy** so the terminal and AI CLIs work on real files.
- Source control is **built-in history only** (no Git). The git extension is disabled.
- Share button = share your running preview with the team (opt-in). Default: everyone runs their own.

## Your work, in this order

1. **Live sync** — one Yjs document per file, updates stored in Convex (append-only update log + periodic snapshot). Apply remote edits to open editors and to the local copy; detect local disk changes (terminal, AI tools) and send them up. Reject paths that escape the project folder (`..`, absolute paths, symlinks out). Max file size 2 MB; skip `node_modules`, `.git`, build output.
2. **Presence + cursors + follow mode** — replace the sample cursors in `extension.ts` (`tagTypes`, `paintCursors`) with real positions; show who has which file open (avatars on tabs/explorer rows via `FileDecorationProvider`); "Follow" button in the Collaborators panel jumps to that person's file and line.
3. **History "Changes" view** — SCM provider named Codeler: changes since last snapshot, "Save snapshot", history list, restore. Team: Convex; solo: `.codeler/history/` in the project. The title-bar branch picker calls `codeler.pickBranch` — implement it as the history list.
4. **Preview sharing** — `codeler.share`: detect the running localhost port, start a tunnel (cloudflared quick tunnel), post the link to team chat, stop on demand. **Ask the user before downloading cloudflared.** Show a clear warning that anyone with the link can open it.
5. **Extensions tab** — Open VSX gallery is already configured by VSCodium. Add sections/recommendations for AI tools (Claude Code, Codex, Gemini CLI), colour themes and language packs.
6. **AI chat panel** — bring-your-own-key (Anthropic, OpenAI, Google) stored in `context.secrets`; can read/edit project files with a confirm step; can use MCP servers the user adds (MotionSites, Blender, …) from an "MCP servers" settings list. Also a **Codeler MCP server** exposing project files so outside AI tools can read/write them.
7. **Languages** — recommend the Open VSX language extensions (Python, Java, C/C++, C#, Go, Rust, PHP); Run & Debug: a saved run-commands list, debugging works when the language's tools are installed.
8. **Packaging** — GitHub Actions for Windows/macOS/Linux using VSCodium's scripts; auto-update. **Ask the user before downloading jq and Rust.**

## Rules
- TypeScript, small functions, no new dependency for a few lines. Validate every input that crosses a trust boundary (Convex args, webview messages, file paths, MCP calls). Every Convex function checks the caller is an **active** member of that team.
- Plain, short UI wording, sentence case. No invented features, testimonials or numbers.
- Don't download anything or create accounts without the user saying yes in chat.
- Leave a small test or self-check for any non-trivial logic (sync merge, path validation, rate limits).
- When a piece is done, write what you did and what you didn't check in `briefs/chatgpt-log.md`.
