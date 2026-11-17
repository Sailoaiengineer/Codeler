Task 4 implemented and logged.

Verification:
- 4 share logic tests passed.
- Extension transpilation passed with 0 errors.
- Smoke tunnel returned a `trycloudflare.com` URL and HTTP 200.
- Sync script was blocked by the concurrent run’s locked `node_modules`.
- One cloudflared process remained inaccessible to `taskkill`.

I could not commit because `.git/index.lock` creation is denied by the workspace’s read-only `.git` permissions. No unrelated files were edited.