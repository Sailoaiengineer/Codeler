# Parallel job C: two-person test of live sync and presence (no real accounts)
Read briefs/chatgpt.md and the review sections at the end of briefs/chatgpt-log.md first.
Goal: prove two team members editing the same project converge, using Convex's in-memory test runner `convex-test` with vitest (npm, allowed) in web/. No accounts, no deploy, no local backend binary.

1. In web/: install convex-test, vitest, @edge-runtime/vm (dev). If Better Auth's component makes convex-test hard, mock `getUser` from web/convex/auth.ts in tests (vi.mock) instead of changing production code; explain in the log.
2. Tests (web/convex/*.test.ts): owner creates a team (via the internal mutations), a member requests to join, the owner approves; non-members and pending members are refused by sync, presence and teams functions; two users push concurrent Yjs updates (real `yjs` docs) to the same file and both converge to identical text; rename and delete; presence shows the other user and marks yourself isMe; stale presence is filtered; 10 wrong join passwords hit the rate limit (teamsNode actions need Node crypto: if actions can't run in convex-test, test the internal queries/mutations directly and say so).
3. Report any bug found in the server code (web/convex) in the log with a minimal fix; apply fixes only in web/convex, minimal and explained.

Verify with `npx vitest run`, commit on your branch, log in briefs/chatgpt-log.md.
