#!/bin/sh
# Applies every local fix to the bundled MathLive, in order; a fix already applied is skipped.
#
#   scripts/patches/apply.sh path/to/mathlive.min.js
#
# scripts/update-vendor.sh runs it after a download, and build.sh to repair a copy that lacks fixes.
# PYTHON chooses the interpreter (default: python3).
set -eu
PATCHES=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for fix in boldsymbol scripts accents arrows clicks delims extensions; do
  "${PYTHON:-python3}" "$PATCHES/mathlive-$fix.py" "$1"
done
