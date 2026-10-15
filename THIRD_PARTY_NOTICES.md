# Third-party notices

Visual Typist bundles these open-source components in `Sources/VisualTypist/Resources/Web/vendor`:

| Component | Version | License | Notice |
| --- | --- | --- | --- |
| [MathLive](https://github.com/arnog/mathlive) | 0.109.2 | MIT | `vendor/mathlive/LICENSE.txt` |
| [MathJax](https://github.com/mathjax/MathJax-src) (`mathjax-full`) | 3.2.2 | Apache-2.0 | `vendor/mathjax/LICENSE.txt` |

MathLive includes the KaTeX fonts (MIT). The bundled `mathlive.min.js` carries one local fix, applied by
`scripts/patches/mathlive-boldsymbol.py`, so that `\boldsymbol` survives editing, and by
`scripts/patches/mathlive-scripts.py`, so that a script following a script is written as a nested group. The exact versions are recorded in `vendor/versions.json`
and can be refreshed with `scripts/update-vendor.sh`.

The app icon's letterform is the capital V of Ralph Smith's Formal Script (RSFS, the font behind
LaTeX's `\mathscr`), distributed with TeX Live under a free license; `scripts/make-icon.py` holds
the outline and renders the icon.
