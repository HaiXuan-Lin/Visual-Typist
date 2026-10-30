#!/usr/bin/env python3
"""Lets the editor place the caret for a click or drag (window.vtOffsetFromPoint, see editor.js).

MathLive 0.109 maps a point to the element nearest it and one side of that element, so some caret
positions cannot be reached with the mouse: between \\right) and \\left\\langle the nearest element is
inside a bracket, and so after \\middle|. The editor picks the caret position drawn nearest the point
instead; without it (another page), MathLive's own mapping is used.

The caret right after \\middle| was not drawn at all: a bracket draws its \\middle delimiters in place
of the delimiter's own box and keeps that box's caret mark, but the delimiter never set it.
"""
import sys
from pathlib import Path

path = Path(sys.argv[1])
source = path.read_text()
fixes = [
    ('function So(t,e,r,i){var c;',
     'function So(t,e,r,i){if(typeof vtOffsetFromPoint=="function"){let k=vtOffsetFromPoint(t,e,r);'
     'if(k>=0)return k}var c;'),
    ('render(e){return new S(this.value,{type:"middle"})}',
     'render(e){let b=new S(this.value,{type:"middle"});return this.caret&&(b.caret=this.caret),b}'),
]
if all(new in source for _, new in fixes):
    sys.exit(0)
for old, new in fixes:
    if new in source:
        continue
    if source.count(old) != 1:
        sys.exit(f"{path}: the expected MathLive pointer or delimiter code was not found; review the patch for this version.")
    source = source.replace(old, new)
path.write_text(source)
print(f"Patched {path}")
