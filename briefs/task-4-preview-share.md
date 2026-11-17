# Task 4 for ChatGPT: share your running preview

Read briefs/chatgpt.md and the review sections at the end of briefs/chatgpt-log.md (rules apply). Do task 4 only, then stop.

## Goal
The green **Share** button in the team title bar (command `codeler.share`, currently a placeholder registration in src/extension.ts) lets a teammate open your running website. Default is still "everyone runs their own"; sharing is opt-in and stops when you say or when Codeler closes.

## Build (`extensions/codeler/src/share/`)
1. Find the port: ports from the Run command's terminal output (`http://localhost:NNNN` / `127.0.0.1:NNNN` lines) and from `vscode.env.asExternalUri`-style common dev ports (3000, 5173, 4321, 8000, 8080) that answer an HTTP GET on 127.0.0.1 within 1 s. If several, quick pick; if none, "Start your site with Run first."
2. Confirm with a modal that says plainly: "Anyone with the link can open your site while sharing is on. Share http://localhost:5173?" Buttons: Share / Cancel.
3. Start `cloudflared tunnel --url http://127.0.0.1:<port> --no-autoupdate` with `child_process.spawn` (no shell; on Windows resolve `cloudflared.exe` with `where`), parse the `https://*.trycloudflare.com` URL from its output, time out after 30 s with a clear error. cloudflared is installed on this machine for testing; for end users, if it's missing, show "Preview sharing needs cloudflared." with a button opening https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ — never download it yourself.
4. While sharing: status bar item "$(broadcast) Sharing 5173" (click = stop), the Share button label becomes "Stop sharing" via the existing title-bar state if a field is needed (only add a field in the extension's pushTitlebar call; core title-bar code is Claude's — if it needs a core change, write it in the log as a request instead). Post the link to team chat if the chat module exports a send function (src/chat); otherwise copy it to the clipboard with a message.
5. Stop: kill the process (and its child tree on Windows via `taskkill /pid <pid> /T /F` through execFile), on command, on deactivate, and when the port stops answering for 30 s.

Pure logic (URL parsing from cloudflared output, port parsing from terminal lines, command building, state machine) in `src/share/logic.ts` with no sibling imports; tests in `src/share/logic.test.ts`. Edit only: new `src/share/*`, package.json (append), and in extension.ts the `codeler.share` registration line plus one startup line.

## Verify
All extension tests (`find extensions/codeler/src -name "*.test.ts" -not -path "*/node_modules/*"`), type-check, sync + transpile, runtime-import grep, and a real smoke test: start `npx http-server -p 5199` (or `python -m http.server 5199`) in a temp folder, run your start function from a small Node script with a stub vscode, confirm a `trycloudflare.com` URL is printed and fetches 200, then stop it and confirm the process is gone. Log and stop.
