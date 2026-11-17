# Task 9 for ChatGPT: verify extension ids and names against Open VSX

Read briefs/chatgpt.md. Small job. Do only this, then stop.

Codeler recommends extensions by id in two places: `extensions/codeler/src/picks/logic.ts` (themes and language packs, with display names) and `extensions/codeler/src/run/` (language extension offers). For every id, query Open VSX: `GET https://open-vsx.org/api/<namespace>/<name>` (namespace = text before the dot). Record whether it exists, its `displayName`, and whether it's deprecated or unpublished.

Fix only what's wrong: a missing or renamed id gets the correct Open VSX id for the same tool (or is removed if there's none, with a one-line note in the log); display names in picks match Open VSX's `displayName`. Keep both files' lists consistent. Don't change anything else.

Verify: run every `extensions/codeler/src/**/*.test.ts` with `node --test` (update tests that assert the changed data). Do NOT run scripts/sync-extension.sh or gulp (a build is running). Append a table (id → exists, display name, action) to briefs/chatgpt-log.md. Stop. (Git may be read-only for you; that's fine — Claude commits.)
