# Task 10 for ChatGPT (GPT-6.1 Sol, using your own sub-agents): Codeler Design

Read `briefs/chatgpt.md` and the review sections at the end of `briefs/chatgpt-log.md` first; their rules apply. You lead this task: split it across your sub-agents (multi_agent is enabled) — e.g. one for 2D, one for 3D, one for the extension wiring and tests — then merge and verify their work yourself. Work only in this folder.

## What it is
A built-in, on-by-default part of Codeler that lets people who know nothing about software make **2D designs** (posters, logos, social posts, app screens) and **3D scenes**. It must feel like a friendly drawing app, not a developer tool: big clear buttons with labels, no code, no jargon, undo/redo everywhere, nothing that can lose work.

## Files and how it plugs in
- Design files are JSON in the project: `*.design.json` (2D) and `*.scene.json` (3D). Open them with a `CustomTextEditorProvider` (view types `codeler.design2d`, `codeler.design3d`) whose source of truth is the `TextDocument`. That way Codeler's existing live sync (it syncs text documents) gives **live team editing for free**: every change is a `WorkspaceEdit` replacing the JSON; incoming changes (document change events) re-render without losing the user's current selection. Keep the JSON stable and pretty-printed so diffs and version history stay readable.
- Command palette + Explorer "New…" menu: **New 2D design**, **New 3D scene** (asks for a name, creates the file in the open folder, opens it). Also a "Design" item in the Codeler picks / Team page is NOT needed.
- Code: `extensions/codeler/src/design/` (extension side), webview apps in `extensions/codeler/design/` (TypeScript, bundled with esbuild into `extensions/codeler/media/design2d.js` / `design3d.js`; the bundle step must run from `extensions/codeler` with an npm script `build:design` and the outputs committed, because Codeler's main build doesn't run it). Register with one `ctx.subscriptions.push(startDesign(ctx));` line in `src/extension.ts` plus the provider/command contributions in `package.json` (append only).
- npm packages allowed: `konva` (2D), `three` (3D, incl. `examples/jsm` OrbitControls, TransformControls, GLTFExporter). Nothing else without a strong reason in the log.

## 2D (the user chose all of these)
- Toolbar: Select, Rectangle, Circle, Line, Text, Image. Move, resize, rotate with handles; fill/stroke colour pickers; font size; bring forward/back; delete; duplicate; align; snap to a light grid. Undo/redo (Ctrl+Z / Ctrl+Y).
- Images: pick a file from the project or the computer; copy it into an `assets/` folder next to the design and reference it by relative path (never embed huge base64 in the JSON; cap images at 5 MB).
- **Templates**: start screen with Blank plus 4 templates: Poster (A4 portrait), Logo (square), Social post (1080×1080), App screen (390×844). Templates are plain JSON in `extensions/codeler/design/templates/`, using only shapes and text (no stock photos, no invented brands or slogans — placeholder text like "Your title").
- **Export**: PNG (1× and 2×) and SVG, saved into the project next to the design (ask for the file name), with a "Saved <file>" notice.
- **Live with team**: via the text-document approach above; also show teammates' selection as a coloured outline if presence data is easy to reach from `src/presence` — if not, skip and say so.

## 3D (the user chose these)
- Add: Cube, Sphere, Cylinder, Cone, Plane, 3D text (three's TextGeometry with a bundled free font from three's examples). Move/rotate/scale with on-screen handles (TransformControls) and number boxes; colour and three simple materials (Matte, Shiny, Metal).
- **Lights and camera**: three lighting presets (Studio, Daylight, Night) and an orbit camera (drag to rotate, scroll to zoom, "Reset view" button).
- **Export**: GLB (GLTFExporter, binary) and PNG (render at 2× the view size), saved next to the scene.
- Undo/redo, duplicate, delete, select by clicking.

## Rules
- Webviews: strict CSP with nonce (copy the pattern in `src/extension.ts` `render()`), `localResourceRoots` limited to the extension's `media/` and the workspace folder; never `innerHTML` with user text (Konva/three render to canvas, which is fine); validate every message from the webview (types, sizes, paths — reuse `isSafeRelativePath` / `safePath` from `src/sync/safety.ts` for anything written to disk).
- Must look like Codeler: use the Codeler Dark colours (see `extensions/codeler/themes/codeler-dark.json` and `media/codeler.css`), Inter/Segoe UI, sentence case, short plain labels.
- Performance: cap to 2,000 shapes (2D) and 500 objects (3D) with a friendly message; throttle document writes to at most every 300 ms while dragging (write the final state on drag end).
- Runtime `.ts` files never import siblings with a `.ts` extension; pure logic (document schema validation, migrations, undo stack, template loading, export file naming) in `src/design/logic.ts` (no repo imports) with `node --test` tests.

## Verify (all required, put outputs in the log)
1. `node --test` on every `extensions/codeler/src/**/*.test.ts` and `extensions/codeler/mcp/server.test.js` — all pass.
2. `npm run build:design` builds both bundles with no errors.
3. Extension type-check with the build's own checker: `scripts/sync-extension.sh`, then in `vscodium/vscode`: `node node_modules/@typescript/native/bin/tsc -p extensions/codeler/tsconfig.json --noEmit` — 0 errors (the build is strict: no unused names, all code paths return).
4. Load the two bundles in a headless check: run each bundle's pure parts (schema validation, template loading, SVG export of a template) under Node; for the three.js side, at least build a scene from JSON and run GLTFExporter in Node (`three` supports this with a minimal canvas-less path; if it truly can't, say why).
5. Append to `briefs/chatgpt-log.md`: what each sub-agent did, files, outputs, what you could not test (anything needing the real app window).
Git may be read-only for you; Claude commits. Stop when done.
