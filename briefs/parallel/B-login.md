# Parallel job B: make the login code test-ready (no real accounts)
Read briefs/chatgpt.md and the review sections at the end of briefs/chatgpt-log.md first.
Login code (Claude's): extensions/codeler/src/auth.ts (device flow, SecretStorage), web/convex/auth.ts, web/convex/betterAuth/*, web/src/app/device/page.tsx, web/src/lib/*.
You may NOT create any account or run `npx convex dev` / deploy. npm installs are allowed.

1. In web/: npm install; run `npx convex codegen` only if it works without an account (if it needs one, skip and say so); type-check web/convex and web/src (tsc --noEmit); `npx next build` with dummy NEXT_PUBLIC_CONVEX_URL / NEXT_PUBLIC_CONVEX_SITE_URL values. Fix only real type/build errors in Claude's files, minimally, each explained in the log.
2. Unit tests for the device flow in auth.ts with a mocked fetch and a fake SecretStorage (move pure helpers into src/auth-logic.ts with no sibling imports if needed): success; slow_down backs off; access_denied; expired; offline retry; a verification URL on another origin is rejected; 401 on the token fetch signs out; the token is stored only in SecretStorage.
3. Write docs/LOGIN-SETUP.md for the owner: numbered, plain steps to create the Convex project, set env vars (SITE_URL, BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET), create the Google OAuth client and its redirect URI, run web/ locally, set codeler.siteUrl and codeler.convexUrl, and test sign-in.

Verify, commit on your branch, log in briefs/chatgpt-log.md.
