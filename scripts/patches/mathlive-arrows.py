#!/usr/bin/env python3
"""Draws over and under arrows (\\overrightarrow{H}, \\underleftarrow{AB}...) as TeX does.

MathLive 0.109 pads their base with a null delimiter on each side, so the arrow ran about 0.12em
past both edges of the base; it makes the whole a relation, with a relation's spaces around it;
and it leaves 0.1em between the base and an arrow above it. In TeX the arrow spans the base, the
whole is an ordinary symbol, and the arrow stands right on the base, as KaTeX and MathJax draw it.
"""
import sys
from pathlib import Path

path = Path(sys.argv[1])
source = path.read_text()
fixes = [
    ('supsubPlacement:"over-under",paddedBody:!0,boxType:"rel",svgAbove:t.command.slice(1)',
     'supsubPlacement:"over-under",paddedBody:!/arrow|harpoon/.test(t.command),'
     'boxType:/arrow|harpoon/.test(t.command)?"ord":"rel",svgAbove:t.command.slice(1)'),
    ('supsubPlacement:"over-under",paddedBody:!0,boxType:"rel",svgBelow:t.command.slice(1)',
     'supsubPlacement:"over-under",paddedBody:!/arrow|harpoon/.test(t.command),'
     'boxType:/arrow|harpoon/.test(t.command)?"ord":"rel",svgBelow:t.command.slice(1)'),
    ('paddedAboveBelow:this.paddedLabels', 'paddedAboveBelow:this.paddedLabels,tight:/arrow|harpoon/.test(this.svgAbove??"")'),
    ('e.above&&(r=t.metrics.bigOpSpacing5)', 'e.above&&(r=e.tight?0:t.metrics.bigOpSpacing5)'),
]
if all(new in source for _, new in fixes):
    sys.exit(0)
for old, new in fixes:
    if new in source:
        continue
    if source.count(old) != 1:
        sys.exit(f"{path}: the expected MathLive over/under code was not found; review the patch for this version.")
    source = source.replace(old, new)
path.write_text(source)
print(f"Patched {path}")
