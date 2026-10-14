#!/usr/bin/env python3
"""Generates the app icon: a golden, three-dimensional script V on a transparent background.

Writes Resources/AppIcon.svg (the vector master), Resources/AppIcon.png (1024 px) and
Resources/AppIcon.icns. Rendering needs `rsvg-convert` (Homebrew: librsvg) and macOS `iconutil`.

The letterform is the capital V of Ralph Smith's Formal Script (RSFS), the font behind LaTeX's
\\mathscr, as produced by `dvisvgm --no-fonts` from `$\\mathscr{V}$`.
"""
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESOURCES = ROOT / 'Resources'

# \mathscr{V} outline in font units (1 unit = 1 TeX point at 10 pt).
GLYPH = (
    'M1.603985-5.469489C1.902864-5.65878 2.211706-5.778331 2.440847-5.778331C2.570361-5.778331 '
    '2.650062-5.718555 2.650062-5.618929C2.650062-5.539228 2.600249-5.419676 2.470735-5.290162C'
    '2.291407-5.100872 2.201743-4.921544 2.201743-4.762142C2.201743-4.503113 2.420922-4.323786 '
    '2.799502-4.323786C3.058531-4.323786 3.367372-4.503113 3.626401-4.692403C3.676214-4.722291 '
    '3.726027-4.762142 3.775841-4.801993C3.58655-4.353674 3.457036-3.92528 3.367372-3.506849C'
    '3.108344-2.34122 2.799502-.946451 1.853051 .029888C1.843088 .039851 1.833126 .059776 1.833126 '
    '.079701C1.833126 .109589 1.843088 .129514 1.863014 .14944C1.872976 .159402 1.892902 .169365 '
    '1.912827 .169365H2.022416C2.052304 .169365 2.072229 .159402 2.092154 .139477C3.16812-1.085928 '
    '4.692403-2.181818 5.579078-3.437111C6.405978-4.60274 7.13325-5.838107 8.498132-6.645081C'
    '8.52802-6.665006 8.537983-6.684932 8.537983-6.714819L8.488169-6.914072C8.478207-6.953923 '
    '8.448319-6.973848 8.408468-6.973848C8.398506-6.973848 8.37858-6.973848 8.368618-6.963885C'
    '6.884184-6.087173 6.166874-4.712329 5.339975-3.536737C4.851806-2.849315 4.154421-2.201743 '
    '3.457036-1.554172L3.377335-1.474471C3.815691-2.161893 4.104608-2.839352 4.244085-3.466999C'
    '4.513076-4.672478 4.891656-6.316314 5.559153-7.003736C5.579078-7.013699 5.579078-7.033624 '
    '5.579078-7.053549C5.579078-7.083437 5.569116-7.103362 5.559153-7.113325C5.539228-7.13325 '
    '5.519303-7.143213 5.499377-7.143213H5.389788C5.369863-7.143213 5.349938-7.13325 5.330012-7.113325C'
    '4.79203-6.555417 4.383562-5.997509 4.084682-5.439601C3.915318-5.230386 3.716065-5.031133 '
    '3.486924-4.851806C3.257783-4.682441 3.008717-4.542964 2.839352-4.542964C2.739726-4.542964 '
    '2.689913-4.592777 2.689913-4.682441C2.689913-4.79203 2.769614-4.961395 2.968867-5.17061C'
    '3.118306-5.32005 3.188045-5.459527 3.188045-5.579078C3.188045-5.838107 2.879203-5.997509 '
    '2.480697-5.997509C2.181818-5.997509 1.8132-5.858032 1.474471-5.638854C1.105853-5.409714 '
    '.787049-5.100872 .56787-4.79203C.557908-4.772105 .547945-4.762142 .547945-4.742217C'
    '.547945-4.692403 .597758-4.662516 .637609-4.662516H.747198C.767123-4.662516 .797011-4.672478 '
    '.816936-4.692403C1.016189-4.971357 1.275218-5.250311 1.603985-5.469489Z'
)
GLYPH_BOX = (0.548, -7.143, 8.538, 0.169)  # left, top, right, bottom in font units

SIZE = 1024
SCALE = 98                       # px per font unit
CENTER = (506, 468)              # where the glyph's center lands on the canvas
OUTER_STROKE = 0.24              # font units; thickens RSFS's hairlines into a solid letter
INNER_STROKE = 0.11              # the gold face, inset from the outer edge to leave a bevel
DEPTH = (10, 34)                 # extrusion offset in px (right, down)
LAYERS = 26


def glyph_transform() -> str:
    left, top, right, bottom = GLYPH_BOX
    tx = CENTER[0] - SCALE * (left + right) / 2
    ty = CENTER[1] - SCALE * (top + bottom) / 2
    return f'translate({tx:.2f} {ty:.2f}) scale({SCALE})'


def shape(fill: str, stroke_width: float, dx: float = 0, dy: float = 0, extra: str = '') -> str:
    """The letter, offset by (dx, dy) px; the stroke (in font units) sets its weight."""
    return (f'<g transform="translate({dx:.2f} {dy:.2f})"{extra}><g transform="{glyph_transform()}">'
            f'<use href="#v" fill="{fill}" stroke="{fill}" stroke-width="{stroke_width}" '
            f'stroke-linejoin="round" stroke-linecap="round"/></g></g>')


def lerp_color(a: str, b: str, t: float) -> str:
    ca = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    cb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(ca, cb))


def svg() -> str:
    extrusion = []
    for index in range(LAYERS, 0, -1):          # back to front
        t = index / LAYERS
        color = lerp_color('#b9841f', '#5e3d0b', t)
        extrusion.append(shape(color, OUTER_STROKE, DEPTH[0] * t, DEPTH[1] * t))

    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">
  <title>Visual Typist</title>
  <defs>
    <path id="v" d="{GLYPH}"/>
    <linearGradient id="face" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#fff7c7"/>
      <stop offset="0.28" stop-color="#ffd95e"/>
      <stop offset="0.55" stop-color="#f0b62f"/>
      <stop offset="0.8" stop-color="#d1921c"/>
      <stop offset="1" stop-color="#f3c650"/>
    </linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#c58d1f"/>
      <stop offset="1" stop-color="#7c5210"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0.6">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.75"/>
      <stop offset="0.35" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="outer-clip">
      <g transform="{glyph_transform()}"><use href="#v" stroke="#000" stroke-width="{OUTER_STROKE}" stroke-linejoin="round" stroke-linecap="round"/></g>
    </clipPath>
    <clipPath id="face-clip">
      <g transform="{glyph_transform()}"><use href="#v" stroke="#000" stroke-width="{INNER_STROKE}" stroke-linejoin="round" stroke-linecap="round"/></g>
    </clipPath>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="16"/>
    </filter>
  </defs>
  <!-- soft contact shadow -->
  {shape('#2a1a02', OUTER_STROKE, DEPTH[0] + 14, DEPTH[1] + 26, ' opacity="0.42" filter="url(#shadow)"')}
  <!-- extrusion -->
  {''.join(extrusion)}
  <!-- bevel: dark rim with a light upper-left edge -->
  {shape('url(#rim)', OUTER_STROKE)}
  <g clip-path="url(#outer-clip)">{shape('#fff1b3', OUTER_STROKE, -3.5, -3.5)}</g>
  <!-- gold face and sheen -->
  {shape('url(#face)', INNER_STROKE)}
  <g clip-path="url(#face-clip)"><rect width="{SIZE}" height="{SIZE * 0.62:.0f}" fill="url(#sheen)"/></g>
</svg>
'''


def main() -> None:
    RESOURCES.mkdir(exist_ok=True)
    master = RESOURCES / 'AppIcon.svg'
    master.write_text(svg())
    renderer = shutil.which('rsvg-convert')
    if not renderer:
        raise SystemExit(f'Wrote {master}. Install librsvg (brew install librsvg) to render the PNG and ICNS.')
    with tempfile.TemporaryDirectory() as temp:
        iconset = Path(temp) / 'AppIcon.iconset'
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            for factor, suffix in ((1, ''), (2, '@2x')):
                pixels = size * factor
                subprocess.run([renderer, '-w', str(pixels), '-h', str(pixels), '-o',
                                str(iconset / f'icon_{size}x{size}{suffix}.png'), str(master)], check=True)
        shutil.copy(iconset / 'icon_512x512@2x.png', RESOURCES / 'AppIcon.png')
        subprocess.run(['iconutil', '-c', 'icns', '-o', str(RESOURCES / 'AppIcon.icns'), str(iconset)], check=True)
    print(f'Wrote {master}, AppIcon.png and AppIcon.icns')


if __name__ == '__main__':
    main()
