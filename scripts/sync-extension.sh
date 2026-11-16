#!/usr/bin/env bash
# Copies the Codeler built-in extension into the VS Code tree (dev runs and builds both read it from there).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
dest="$here/vscodium/vscode/extensions/codeler"
rm -rf "$dest"
mkdir -p "$dest"
cp -r "$here/extensions/codeler/." "$dest/"
rm -rf "$dest/out" "$dest/dist"
echo "synced to $dest"
