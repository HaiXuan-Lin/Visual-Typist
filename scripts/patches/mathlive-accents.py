#!/usr/bin/env python3
"""Places accents over their base as TeX does.

MathLive 0.109 draws an accent in a centered block that starts at a left margin, so the accent's
center is halfway between that margin and the base's right edge. The margin it uses is the offset
of an accent that is not centered, (base width - accent width)/2 + 2 skew, so every accent sits
right of center by a quarter of the difference: \\vec{AB} by a quarter em, and \\widehat{xyz} or
\\widetilde{AB}, whose drawing has no width of its own and spans the block, by half the base. With
a margin of 2 skew the accent's center is the base's center plus the skew, as in TeX, and a wide
accent spans the base from 2 skew on, as in KaTeX. The skew of a single letter (how far right of
its center the accent goes, toward the apex of an italic A) was read from the box around the base,
which has none, so it was always 0: it is read from the letter's own box. An accent glyph wider than
the block from that margin to the base's right edge (\\mathring over an italic A or x) cannot be
centered in it and started at the margin; the block of a glyph accent reaches 1em further on both
sides, which keeps its center.

A wide accent was also raised by min(base height, x-height) - 0.111em above its base, about a
third of an em over a capital. TeX's wide accents are glyphs drawn for x-height letters and raised
by what the base is taller than that, so they stand the same small distance above any base: about
0.12em, as MathJax draws them, which a constant 0.14em gap gives here.
"""
import sys
from pathlib import Path

path = Path(sys.argv[1])
source = path.read_text()
helper = ('function vtSkew(b){if(!b)return 0;if(b.skew&&isFinite(b.skew))return b.skew;'
          'for(let c of b.children??[]){let k=vtSkew(c);if(k)return k}return 0}')
fixes = [
    ('let s=(i.width-a.width)/2+i.left+2*n;', 'let s=2*(i.left+n);'),
    ('this.body[1].isCharacterBox()&&(n=i.skew)', 'this.body[1].isCharacterBox()&&(n=vtSkew(i))'),
    ('var Ir=class t extends x{', helper + 'var Ir=class t extends x{'),
    ('{box:a,marginLeft:s,classes:["ML__center"]}]})',
     'this.svgAccent?{box:a,marginLeft:s,classes:["ML__center"]}:{box:a,marginLeft:s-1,marginRight:-1,classes:["ML__center"]}]})'),
    ('a=Gi(this.svgAccent),o=r.metrics.bigOpSpacing1-o', 'a=Gi(this.svgAccent),o=-.14'),
]
if all(new in source for _, new in fixes):
    sys.exit(0)
for old, new in fixes:
    if new in source:
        continue
    if source.count(old) != 1:
        sys.exit(f"{path}: the expected MathLive accent code was not found; review the patch for this version.")
    source = source.replace(old, new)
path.write_text(source)
print(f"Patched {path}")
