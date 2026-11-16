# Task 7 for ChatGPT: Run button, run commands, languages

Read `briefs/chatgpt.md` and the review sections at the end of `briefs/chatgpt-log.md` (rules apply). Do task 7 only, then stop.

## Goal
The green **Run** button in the title bar runs the project the obvious way for its language, in the terminal, and the Run & Debug tab lists saved run commands. When someone opens a file in a language whose tools are missing, Codeler says so plainly and offers the matching free extension from Open VSX.

## Build
1. **Run commands** (`extensions/codeler/src/run/`):
   - Saved per project in `.codeler/run.json`: `{ "commands": [{ "name": "Dev server", "command": "npm run dev" }], "default": "Dev server" }`. Validate the file (shape, string lengths ≤ 500, ≤ 50 commands); a broken file shows a clear error and is not overwritten.
   - If there's no saved default, **detect** one and offer to save it: `package.json` scripts `dev` → `start` → `serve` (use the lockfile to pick npm / pnpm / yarn / bun); `pyproject.toml`/`main.py`/`app.py` → `python <file>`; `go.mod` → `go run .`; `Cargo.toml` → `cargo run`; `pom.xml` → `mvn exec:java`, `build.gradle` → `gradle run`; `*.csproj` → `dotnet run`; `index.php` → `php -S localhost:8000`; a single open `.c`/`.cpp` file → compile with `gcc`/`g++` to a temp output then run; `index.html` only → open the built-in Simple Browser on the file. Detection is pure logic over a file list + file contents (testable, no vscode import).
   - **Run** (`codeler.run`, already bound to the title-bar button — replace only its registration line in `extension.ts`): runs the default in a terminal named "Codeler: <name>", reusing it if it exists (send Ctrl+C first if a command is still running). Never pass user text through extra shell layers; use `terminal.sendText` with the command as saved.
   - **Run & Debug tab**: a tree view `codeler.runCommands` in the `debug` view container listing saved commands, with inline Run, Edit, Delete, a "Set as default" context action, and a title "+" to add one (input boxes for name and command). Contribute the view, commands and menus in `package.json` (append only).
2. **Tool check** (`src/run/tools.ts`): on activation and when a file of a language opens, check once per session whether the language's tool is on PATH (`node`, `python`/`py`, `java`, `gcc`/`clang`, `dotnet`, `go`, `cargo`, `php`) using `child_process.execFile` with a 3 s timeout and no shell. Cache results. If missing: a single non-blocking notification "Python isn't installed on this computer, so Codeler can't run or debug .py files yet." with buttons **"How to install"** (opens the official download page: python.org, nodejs.org, adoptium.net, go.dev, rustup.rs, dotnet.microsoft.com, php.net, and for C/C++ the MSYS2/Xcode/apt instructions page) and **"Don't show again"** (per language, stored in `globalState`).
3. **Language extensions**: when a file of these languages opens and no extension for it is installed, offer once (same "don't show again"): Python → `ms-python.python`, Java → `redhat.java`, C/C++ → `llvm-vs-code-extensions.vscode-clangd`, C# → `muhammad-sammy.csharp`, Go → `golang.go`, Rust → `rust-lang.rust-analyzer`, PHP → `bmewburn.vscode-intelephense-client`. The button runs `workbench.extensions.installExtension` with the id **only when the user clicks it**. Check installed via `vscode.extensions.getExtension`.

## Allowed edits
New files under `extensions/codeler/src/run/`; `package.json` (append contributions only); in `extension.ts` only the `codeler.run` registration line and one `ctx.subscriptions.push(startRun(ctx));` line. Don't touch `src/sync`, `src/presence`, `src/history` (another agent is building it), `media/`, `web/`, `vscodium/`.

## Verify
- Pure logic (detection, run.json validation, which tool a language needs) in a file with no sibling imports; tests with `node --test extensions/codeler/src/run/*.test.ts`, including: each detection rule, lockfile → package manager, broken run.json rejected, command strings never altered.
- Type-check (`--module esnext --moduleResolution bundler`, include `src/run/*.ts`), `scripts/sync-extension.sh`, `npm run gulp transpile-extension:codeler` in `vscodium/vscode`, then load every `out/run/*.js` with a stub `vscode` (include `window`, `workspace`, `commands`, `extensions`, `Disposable`, `EventEmitter`, `TreeItem`, `ThemeIcon` in the stub).
- Log results and anything you couldn't test in `briefs/chatgpt-log.md`. Stop.
