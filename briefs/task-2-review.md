# Task 2 review (from Claude) — fix these, same rules as before

Good: membership checks, own-row-only writes, path and number validation, tests pass, compiled load works. Fix the following, add tests where marked, log, then stop.

1. **You see your own cursor.** `presence:list` returns the caller's row and the extension paints every row. Exclude the caller: return `isMe` per row from the server (compare `r.userId` to the caller), or have the client skip its own `windowId`. Your own avatar may still appear in the title-bar avatar stack; your own cursor tag must not. *(test: mapping rows → painted cursors skips me)*
2. **Ghosts never go offline.** `Date.now()` in a Convex query doesn't re-run as time passes, so idle people stay "online". Return `lastSeen` and filter on the client against the current time, re-checking every 10s. Also add a cleanup: an internal mutation that deletes rows older than 2 minutes, scheduled with a Convex cron in `web/convex/crons.ts` (create it; one entry). *(test: filter by lastSeen with a fake clock)*
3. **Follow stops after the first jump.** `showTextDocument` fires an active-editor change and a selection change; the second one clears `followed`. Only stop following on a selection change whose `kind` is `Keyboard` or `Mouse` (user-initiated), not `Command` or undefined. *(test: follow-mode state machine)*
4. **Badge colours.** `new vscode.ThemeColor('#3fbf5c')` is not valid (ThemeColor takes a colour id). Contribute four colours in `package.json` → `contributes.colors` (`codeler.person1` … `codeler.person4`, defaults = the four tag hex values) and use `new vscode.ThemeColor('codeler.personN')`.
5. **Webview set leaks.** `presenceViews` keeps disposed webviews. Remove them when their view/panel is disposed (use the `onDidDispose` of the view/panel that owns the webview).
6. **One button per person.** In Collaborators, show a single toggle: "Follow" for others, "Following" (pressed, `aria-pressed="true"`) for the one you follow, and no button on your own row. Keep the existing `btn-ghost` style.
7. Drop the duplicate colour hashing in `extension.ts`; import `colorFor` from `presence/logic`.

Then run: all tests (`node --test extensions/codeler/src/sync/*.test.ts extensions/codeler/src/presence/*.test.ts`), the type-check, sync + transpile, and the compiled-load check for every `out/presence` and `out/sync` file. Log and stop.
