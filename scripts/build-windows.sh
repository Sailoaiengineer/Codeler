#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VSCODIUM_DIR="${ROOT_DIR}/vscodium"
VSCODE_DIR="${VSCODIUM_DIR}/vscode"
PINNED_COMMIT="$(jq -r '.commit' "${VSCODIUM_DIR}/upstream/stable.json")"

[[ -d "${VSCODIUM_DIR}/.git" ]] || { echo "Missing VSCodium checkout: ${VSCODIUM_DIR}" >&2; exit 1; }
[[ -d "${VSCODE_DIR}/.git" ]] || { echo "Missing VS Code checkout: ${VSCODE_DIR}" >&2; exit 1; }

echo "Resetting VS Code to pinned commit ${PINNED_COMMIT}; preserving node_modules."
git -C "${VSCODE_DIR}" reset --hard "${PINNED_COMMIT}"
git -C "${VSCODE_DIR}" clean -fd -e node_modules -e .build

mkdir -p "${VSCODIUM_DIR}/patches/user"
cp "${ROOT_DIR}/patches/codeler-core.patch" "${VSCODIUM_DIR}/patches/user/codeler-core.patch"

if ! grep -q 'Codeler: built-in extension' "${VSCODIUM_DIR}/prepare_vscode.sh"; then
  git -C "${VSCODIUM_DIR}" apply "${ROOT_DIR}/patches/vscodium-build.patch"
fi

python -I "${ROOT_DIR}/brand/make_icons.py"

cd "${VSCODIUM_DIR}"
export VSCODE_ARCH=x64
# Codeler names for VSCodium's scripts (installer/zip names, the command-line launcher)
export APP_NAME=Codeler BINARY_NAME=codeler ORG_NAME=Codeler
export CODELER_UPDATE_URL="${CODELER_UPDATE_URL-}"
./dev/build.sh -sp
