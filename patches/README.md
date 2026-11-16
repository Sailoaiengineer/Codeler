# Patches

- `codeler-core.patch`: Codeler's changes to VS Code itself (title bar slots, labelled activity bar, 48px title bar, built-in extension registration). Apply inside `vscodium/vscode` with `git apply`.
- `vscodium-build.patch`: VSCodium build script changes (Codeler name, app ids, `.codeler` data folder, copy of the built-in extension). Apply inside `vscodium`.
- Icons are not patched: run `python -I brand/make_icons.py` to regenerate them into `vscodium/src/stable`.
