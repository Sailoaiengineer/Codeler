# Patches

- `codeler-core.patch`: Codeler's changes to VS Code itself (title bar slots, labelled activity bar, 48px title bar, built-in extension registration). Apply inside `vscodium/vscode` with `git apply`.
- `vscodium-build.patch`: VSCodium build script changes (Codeler name, app ids, `.codeler` data folder, copy of the built-in extension). Apply inside `vscodium`.
- Icons are not patched: run `python -I brand/make_icons.py` to regenerate them into `vscodium/src/stable`.

## Release build

The pinned VSCodium source revision is recorded in `scripts/vscodium-commit.txt`.
On Windows, from Git Bash, run `./scripts/build-windows.sh`. The script resets
the VS Code checkout to the commit in `vscodium/upstream/stable.json`, preserves
its `node_modules`, copies the Codeler user patch, regenerates icons, and runs
VSCodium's `dev/build.sh -sp` for a Windows x64 build and installer assets.

CI uses the same patch and icon steps for Windows, macOS x64/arm64, and Linux.
Builds are intentionally unsigned. Before enabling signing, configure the
placeholder `CODELER_WINDOWS_SIGNING_CERT`, `CODELER_APPLE_SIGNING_IDENTITY`,
and `CODELER_APPLE_NOTARIZATION_PROFILE` secrets in GitHub Actions. Keep
`CODELER_UPDATE_URL` unset until Codeler operates an update server.
