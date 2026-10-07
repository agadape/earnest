#!/usr/bin/env bash
# A local chain with the built program loaded at its real address. Leave it running.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

target="${CARGO_TARGET_DIR:-target}"
exec solana-test-validator --reset --quiet \
    --ledger "${TMPDIR:-/tmp}/tanda-jadi-ledger" \
    --bpf-program EsMmNdHM99LX3c3yhec5AgdteXBPyCz5kN8St3ySddzv "$target/deploy/tanda_jadi.so"
