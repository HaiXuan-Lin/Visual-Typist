#!/usr/bin/env python3
"""Install the local equation extensions using the pinned MathLive 0.109.2 internals."""
import sys
from pathlib import Path
path = Path(sys.argv[1])
source = path.read_text()
anchor = 'function he(t,e){'
hook = 'globalThis.VTInstallMathLive?.({define:w,Atom:x,Box:S,Context:P,parse:ge,atoms:T});'
if hook not in source:
    if source.count(anchor) != 1:
        sys.exit('MathLive extension hook changed; review the pinned bundle.')
    path.write_text(source.replace(anchor, hook + anchor))
