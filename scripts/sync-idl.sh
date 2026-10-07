#!/usr/bin/env bash
# Copies the IDL and its TypeScript types to where the web app and the scripts import them from.
# Runs after every `anchor build` (see [hooks] in Anchor.toml). The copies are committed, so
# working on the web app does not require the Rust toolchain.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

target="${CARGO_TARGET_DIR:-target}"
dest="app/src/lib/tanda-jadi"

mkdir -p "$dest"
cp "$target/idl/tanda_jadi.json" "$dest/idl.json"
cp "$target/types/tanda_jadi.ts" "$dest/idl-types.ts"
echo "IDL copied to $dest"
