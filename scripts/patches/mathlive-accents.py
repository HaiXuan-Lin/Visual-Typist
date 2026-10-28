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

\\vec, \\dddot and \\ddddot were drawn with combining characters (U+20D7, U+20DB, U+20DC) on no
base. Browsers place such a lone mark differently: Blink draws it left of its position, as the
font says, WebKit right of it, half an arrow further right, so in the app the arrow of \\vec{A}
began over the middle of A. They are drawn as SVG instead, with the outlines MathJax uses for them
(TeX's vector accent, and \\dddot's dots as MathJax spaces them), the dots as high as \\ddot's.
"""
import sys
from pathlib import Path

path = Path(sys.argv[1])
source = path.read_text()
helper = ('function vtSkew(b){if(!b)return 0;if(b.skew&&isFinite(b.skew))return b.skew;'
          'for(let c of b.children??[]){let k=vtSkew(c);if(k)return k}return 0}')
# Outlines from MathJax's TeX fonts (Apache-2.0), in thousandths of an em, y up.
VEC = ('M377 694Q377 702 382 708T397 714Q404 714 409 709Q414 705 419 690Q429 653 460 633Q471 626 471 615'
       'Q471 606 468 603T454 594Q411 572 379 531Q377 529 374 525T369 519T364 517T357 516Q350 516 344 521'
       'T337 536Q337 555 384 595H213L42 596Q29 605 29 615Q29 622 42 635H401Q377 673 377 694Z')
DOT = 'M78 60Q78 84 95 102T138 120Q162 120 180 104T199 61Q199 36 182 18T139 0T96 17T78 60Z'
helper += (
    'function vtDots(n){let s="";for(let i=0;i<n;i++)s+=`<path transform="translate(${278*i} 554)" d="' + DOT + '"/>`;return s}'
    'var vtAccentGlyphs={8407:{w:500,h:714,p:`<path d="' + VEC + '"/>`},8411:{w:834,h:674,p:vtDots(3)},8412:{w:1112,h:674,p:vtDots(4)}};'
    'function vtAccentSvg(c){let g=vtAccentGlyphs[c];return`<span style="display:inline-block;position:relative;width:${g.w/1e3}em;height:0">'
    '<svg style="position:absolute;left:0;bottom:0;overflow:visible" width="${g.w/1e3}em" height="${g.h/1e3}em" viewBox="0 ${-g.h} ${g.w} ${g.h}">'
    '<g fill="currentcolor" transform="scale(1,-1)">${g.p}</g></svg></span>`}')
fixes = [
    ('let s=(i.width-a.width)/2+i.left+2*n;', 'let s=2*(i.left+n);'),
    ('this.body[1].isCharacterBox()&&(n=i.skew)', 'this.body[1].isCharacterBox()&&(n=vtSkew(i))'),
    ('var Ir=class t extends x{', helper + 'var Ir=class t extends x{'),
    ('function T0(t){if(Xl[t])', 'function T0(t){if(vtAccentGlyphs[t])return vtAccentSvg(t);if(Xl[t])'),
    ('else if(this.accent){let u=new S(this.accent,{fontFamily:"Main-Regular"})',
     'else if(this.accent&&vtAccentGlyphs[this.accent])a=new S(null,{classes:"ML__accent-body"}),a.svgBody=this.accent,'
     'a.height=vtAccentGlyphs[this.accent].h/1e3,a.depth=0;else if(this.accent){let u=new S(this.accent,{fontFamily:"Main-Regular"})'),
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
