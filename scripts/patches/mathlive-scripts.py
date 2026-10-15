#!/usr/bin/env python3
"""Writes scripts that follow scripts as nested groups, as classic equation editors do.

In MathLive 0.109 scripts are atoms of their own after their base, so a_{1}^{2} followed by
another script is the flat list a, subsup, subsup — the same model as AxMath, where each script
is a node in the row. MathLive serializes such a list as a_1^2_3^4 (invalid: a double script).
This writes it as {a_1^2}_3^4: a script that follows a script takes the base and the scripts
before it, in braces, as its base.
"""
import sys
from pathlib import Path

path = Path(sys.argv[1])
source = path.read_text()
old = 'static serialize(e,r){var i;if(!e||e.length===0)return"";'
new = ('static serialize(e,r){var i;if(!e||e.length===0)return"";'
       'if(e.some((a,k)=>k>0&&a.type==="subsup"&&e[k-1].type==="subsup"))return vtStaggered(e,r,ni);')
helper = '''function vtStaggered(e,r,M){let u=[];for(let a of e){if(a.type==="first")continue;let l=u[u.length-1];if(a.type==="subsup"&&l){let b=l.latex??M.serialize(l.atoms,r);l.latex=(l.scripted?"{"+b+"}":b)+a.supsubToLatex(r);l.atoms.push(a);l.scripted=!0}else u.push({atoms:[a],latex:null,scripted:a.type==="subsup"})}return R(u.map(l=>l.latex??M.serialize(l.atoms,r)))}'''
anchor = 'var ve=ni;'
if new in source:
    sys.exit(0)
if source.count(old) != 1 or source.count(anchor) != 1:
    sys.exit(f"{path}: the expected MathLive serializer code was not found; review the patch for this version.")
source = source.replace(old, new).replace(anchor, helper + anchor)
path.write_text(source)
print(f"Patched {path}")
