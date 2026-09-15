#!/usr/bin/env bash
#
# Raise the shipped @deepseek-ai/dsh-session-reference cap on maxReferences
# (3 -> 10). See ../README.md, "The one shipped-package patch".
#
# Why this exists: the cap is a hard-coded constant in a published package, and
# neither a DSH setting nor a profile patch row can raise it — the config schema
# and the constructor guard both reject anything above 3. So this rewrites the
# installed package in place. An npm/npx reinstall or upgrade restores the
# original bytes, so run this again afterwards.
#
# Usage:
#   ./apply.sh --dry-run             # discover the package and report the edits, write nothing (the default)
#   ./apply.sh --apply               # write the edits
#   ./apply.sh --print-dir           # print the discovered package directory
#   DSH_SESSION_REFERENCE_DIR=... ./apply.sh --apply
#
# A patched package is loaded only by a new host process: restart `dsh web`.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$HERE/max-references.mjs" "$@"
