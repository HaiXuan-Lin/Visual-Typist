#!/usr/bin/env python3
"""Keeps \\boldsymbol when MathLive re-serializes bold-italic Latin letters.

MathLive 0.109 writes every bold run of letters as \\mathbf, so \\boldsymbol{b} turns into
\\mathbf{b} as soon as the expression is edited. \\boldsymbol sets only the bold weight while
\\mathbf also selects the upright variant, which tells the two apart.
"""
import sys
from pathlib import Path

path = Path(sys.argv[1])
source = path.read_text()
old = r'return/^[a-zA-Z0-9]+$/.test(n)?U("\\mathbf",R(ls(r,e))):U("\\bm",R(ls(r,e)))'
new = (r'return r[0].style.variant!=="normal"&&/^[a-zA-Z0-9]+$/.test(n)?U("\\boldsymbol",R(ls(r,e))):'
       r'/^[a-zA-Z0-9]+$/.test(n)?U("\\mathbf",R(ls(r,e))):U("\\bm",R(ls(r,e)))')
if new in source:
    sys.exit(0)
if source.count(old) != 1:
    sys.exit(f"{path}: the expected MathLive serializer code was not found; review the patch for this version.")
path.write_text(source.replace(old, new))
print(f"Patched {path}")
