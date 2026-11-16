# Task 2 for ChatGPT: presence, cursors, follow mode

Read `briefs/chatgpt.md`, then the **"Claude's review of task 1"** section at the end of `briefs/chatgpt-log.md` (rules that apply here too). Do task 2 only, then stop.

## Goal
In a team project, everyone sees who is online, which file each person has open, and each person's cursor as a coloured name tag (like the sample Alex/Sam/Taylor/Jordan tags now). Clicking **Follow** on someone in the Collaborators panel keeps your editor on their file and line until you move.

## What exists
- Sample cursors in `extensions/codeler/src/extension.ts`: `tagTypes`, `paintCursors`, `showCursors`, and `sample.people`. The tag style (coloured caret + label after the line) is approved; keep its look.
- Collaborators panel: `extensions/codeler/media/collaborators.html` (Follow button currently posts `notReady`). Chat panel's "Currently online" strip: `media/chat.html`.
- Live sync from task 1 (`src/sync/`) and `codeler.projectId` setting; `requireProjectMember` in `web/convex/access.ts`; `teams.people` query in `web/convex/teams.ts` gives active members with name/email/image.
- Title bar data is pushed by `pushTitlebar()` in `extension.ts` (`people` array: name, initials, color, photo).

## Build
1. **Convex** (`web/convex/presence.ts`, table appended to schema under `// ChatGPT: presence`): one row per (project, user, window): file path, cursor line/character, selection, `lastSeen`. Heartbeat mutation (≤ every 2s while active, every 15s when idle). Query returns members seen in the last 30s, joined with their name/image from `members`. Reject paths with the same rules as sync. A user can only write their own row (`requireProjectMember`, `user._id`).
2. **Extension** (`src/presence/`): send your file + cursor on selection/editor changes (throttled); subscribe to the presence query; colour per person picked deterministically from their user id using the approved tag colours (`#3fbf5c`, `#2684f5`, `#f2842b`, `#b26bd1`, then more if needed).
3. Replace the sample data **only when a team project is active** (projectId set and signed in). With no team project, keep today's sample preview behaviour unchanged (it's how the layout is shown until login exists).
4. Panels: post presence data to the Collaborators and Chat webviews via `webview.postMessage` (online list, who's in which file) and handle Follow / Stop following. Who's-in-file: a `FileDecorationProvider` badge with initials on Explorer rows of files someone else has open.
5. Title bar: feed real online members into `pushTitlebar()`'s `people`.
6. You may edit, in `extension.ts`: the sample-cursor block (`tagTypes`, `paintCursors`, `showCursors`) and the `people` field inside `pushTitlebar()`; plus the one-line registration. In `media/`: `collaborators.html`, `chat.html` (online strip only), `codeler.js` (add a message listener helper). Nothing else of Claude's.

## Verify
- Pure logic in files with **no sibling imports** (colour assignment, throttle, presence → decorations mapping, follow-mode state), tested with `node --test extensions/codeler/src/**/*.test.ts`.
- Type-check like task 1 (`--module esnext --moduleResolution bundler`).
- **Compiled load check**: run `scripts/sync-extension.sh`, then in `vscodium/vscode`: `npm run gulp transpile-extension:codeler`, then load every new `out/` file with Node using a stub `vscode` module (see how the review did it) and show it loads.
- Log results, what you couldn't test, and any requests for Claude in `briefs/chatgpt-log.md`. Then stop.
