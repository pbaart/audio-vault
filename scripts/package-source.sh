#!/usr/bin/env bash
# Package the project source into a distributable tarball with a clean
# <name>-<version>/ top-level directory.
#
# This script lives in <repo>/scripts/, so the repo root (the Tauri project:
# package.json + src-tauri) is one level up.
#
# Usage: bash scripts/package-source.sh [output-dir]
#   output-dir defaults to <repo>/dist
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
OUT_DIR="${1:-$REPO_ROOT/dist}"
NAME_BASE="audio-vault"

# Version from package.json (single source of truth for the frontend).
VERSION="$(grep -m1 '"version"' "$REPO_ROOT/package.json" \
  | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
if [ -z "$VERSION" ]; then
  echo "error: could not determine version from package.json" >&2
  exit 1
fi
NAME="${NAME_BASE}-${VERSION}"
mkdir -p "$OUT_DIR"

# Stage the repo contents (excluding build artifacts) under a clean top-level
# dir, then compress. Portable across GNU tar (Linux) and bsdtar (macOS).
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/${NAME}"
tar -C "$REPO_ROOT" \
    --exclude='node_modules' --exclude='target' --exclude='dist' \
    --exclude='.git' --exclude='.DS_Store' \
    -cf - . | tar -C "$STAGE/${NAME}" -xf -

tar -czf "$OUT_DIR/${NAME}.tar.gz" -C "$STAGE" "${NAME}"

echo "Wrote $OUT_DIR/${NAME}.tar.gz"
ls -lh "$OUT_DIR/${NAME}.tar.gz"
