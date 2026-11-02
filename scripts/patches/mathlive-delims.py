#!/usr/bin/env python3
"""Draws \\left\\| and \\right\\| as double bars.

MathLive 0.109 looks a delimiter's character up in one table for its normal and sized forms, and
that table maps \\| to U+2223 (a single bar), so \\left\\| x \\right\\| showed one bar on each side
until the content grew tall enough for a stacked delimiter. \\| is \\Vert: U+2225.
"""
import sys
from pathlib import Path

path = Path(sys.argv[1])
source = path.read_text()
old = '"\\u2225":8741,"\\\\|":8739,'
new = '"\\u2225":8741,"\\\\|":8741,'
if new in source:
    sys.exit(0)
if source.count(old) != 1:
    sys.exit(f"{path}: the expected MathLive delimiter table was not found; review the patch for this version.")
path.write_text(source.replace(old, new))
print(f"Patched {path}")
