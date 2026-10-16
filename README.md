# Visual Typist

Visual Typist is a visual LaTeX equation editor for macOS on Apple Silicon. You type math in a
WYSIWYG canvas, with structures, slots and keyboard shortcuts like a classic equation editor, and
the LaTeX code is always one keystroke away. It was inspired by earlier editors such as
[MathType](https://www.wiris.com/en/mathtype/), [AxMath](https://www.axsoft.co/) and
[VisualTeX](https://github.com/paulhe666/visualtex).

**Try it right away in your browser: [haixuan-lin.github.io/Visual-Typist](https://haixuan-lin.github.io/Visual-Typist/)**
— or [build the Mac app](#install) with one command.

![Visual Typist editing the Einstein field equations](Einstein-equation.png)

Flip the bottom pane from the symbol palette to the LaTeX code at any time; the two stay in sync,
and matching brackets are highlighted in both.

![The Schrödinger equation with its LaTeX code](Schrodinger-equation.png)

## Features

- **Structured editing.** Fractions, roots, scripts, integrals, sums, brackets and matrices with
  slots; ←/→, ↑/↓ and ⇥ move between them, and ⌫ deletes a structure as a whole, as in classic
  equation editors. ↩ starts a new line (inside a script or a root it starts a new row).
- **Commands as you type.** Type `\` and a name — `\mu`, `\frac`, `\sum` — and pick from a
  candidate bar like an input method: `Space` takes the first, `1`–`8` pick one, `⎋` cancels.
  Function names such as `sin` are recognized as you type.
- **Brackets and accents.** `(` `[` `{` insert a matching `\left…\right` pair, or put it around the
  selection. An accent applies to the symbol before the caret; ⌫ after it removes just the accent.
- **Staggered indices.** Each script is an element of its own, so tensor indices sit apart:
  `R^{\rho}{}_{\sigma\mu\nu}` is typed with `⌘Q`, `→`, `⌘L`.
- **Selections** are made of whole elements; drag across lines, extend with ⇧ and the arrows or a
  ⇧-click. Typing, paste, fonts and templates act on them.
- **Shortcuts for everything.** Windows equation-editor habits carry over (Ctrl becomes ⌘, Alt
  becomes ⌥). Right-click any palette button to give it a shortcut, or edit them all in
  *Settings › Keyboard Shortcuts* (`⌘,`).
- **Clean output.** Standard LaTeX (lines separated by `\\` on a line of their own), vector PDF and
  SVG sized in points, PNG at 1×–4×, MathML. `⌘C` copies the selection as an image, `⌘T` as LaTeX.
- **Native and offline.** A small Apple Silicon app for macOS 14 or later, with light and dark
  themes. One document-wide undo history.

## Install

You need an Apple Silicon Mac with macOS 14 or later. In a terminal:

```sh
git clone https://github.com/HaiXuan-Lin/Visual-Typist.git
cd Visual-Typist
./build.sh --install
```

`build.sh` examines the build environment and repairs what it can before compiling: it installs or
updates the Xcode Command Line Tools, accepts the Xcode license, fixes a broken developer-tools
selection, checks the macOS SDK and disk space, clears a stale build cache, verifies the bundled
math engines against their checksums (downloading them again with Node.js if they are damaged) and
regenerates a missing icon. It asks before anything that needs your password or a download.
`--install` then copies the app into `/Applications` and opens it.

| Command | What it does |
| --- | --- |
| `./build.sh` | check and repair the environment, then build `Visual Typist.app` here |
| `./build.sh --install` | … and install it into `/Applications` and open it |
| `./build.sh --yes` | answer yes to every question (non-interactive, e.g. CI) |
| `./build.sh --test` | run the unit tests before building |
| `./build.sh --check` | only check (and repair) the environment |
| `./install.sh` / `./install.sh --uninstall` | install an existing build / remove the app |

The app is signed ad hoc for local use; it is not notarized.

## Keyboard shortcuts

Keys are matched by position, so `⌥K` works even though macOS would normally type `˚`. While the
equation has focus its shortcuts win over menu items with the same keys (`⌘Q` makes a superscript;
quit from the app menu). New is `⇧⌘N`, Open `⇧⌘O`, Save As `⌥⇧⌘S`.

| Insert | Shortcut | | Editing | Shortcut |
| --- | --- | --- | --- | --- |
| Fraction | `⌘F` | | New line / row in a slot | `↩` |
| Square root | `⌘R` | | Next / previous slot | `⇥` / `⇧⇥` |
| Superscript | `⌘Q` | | Select all / delete the line | `⌘A` / `⌘⌫` |
| Subscript | `⌘L` or `⌘E` | | Undo / redo | `⌘Z` / `⇧⌘Z` or `⌘Y` |
| Sub- and superscript | `⌘J` | | Copy as image / as LaTeX | `⌘C` / `⌘T` |
| Integral / sum with limits | `⇧⌘I` / `⇧⌘S` | | Symbols ↔ LaTeX code | `⌃⇥` |
| μ, ν, ∞, π, ω | `⌘M` `⌘N` `⌘I` `⌘P` `⌘O` | | Apply the code, back to the equation | `⇧↩` |
| Hat, dot, double dot, vector | `⌘H` `⌘D` `⇧⌘D` `⌥T` | | Greek letter next | `⌘G`, then a letter |
| (▢\|▢), bra, ket | `⌥9` `⌥B` `⌥K` | | Fonts: `\mathrm` … `\mathfrak` | `⌘1` … `⌘9` |
| | | | Matrix: insert / delete row or column | `⌥` / `⌥⌘` + arrows |

Your changes are saved to `~/Library/Application Support/Visual Typist/shortcuts.json`, layered
over the defaults in [`keymap.js`](Sources/VisualTypist/Resources/Web/keymap.js).

## The browser edition

The [website](https://haixuan-lin.github.io/Visual-Typist/) runs the same editor in a browser.
Open, save (`.vteq`), copy LaTeX or an image, and export SVG, PNG, LaTeX or MathML work there too;
PDF export, rich clipboard images and keeping your input method out of the way are the app's. On
Windows and Linux, use Ctrl for ⌘ and Alt for ⌥ (some combinations, such as Ctrl+N or Ctrl+W,
belong to the browser).

## Development

```sh
swift build                  # debug build
./scripts/test.sh            # unit tests (works with Xcode or the Command Line Tools)
./scripts/build-site.sh      # assemble the website into .site (python3 -m http.server --directory .site)
./scripts/update-vendor.sh   # refresh MathLive / MathJax to the versions in package.json
```

```
Sources/VisualTypist/          macOS app (SwiftUI + WebKit): window, menus, export, clipboard
  Resources/Web/               the editor: editor.js, palette.js, keymap.js, app.css
    vendor/                    MathLive (editing) and MathJax (rendering, export)
Sources/VisualTypistCore/      document format, LaTeX import, key combos
Tests/VisualTypistCoreTests/   unit tests
site/                          the website's landing page (published by .github/workflows/pages.yml)
scripts/                       tests, website, vendor update and patches, icon generator
```

The editor is a plain web page, so it can be worked on in a browser: serve
`Sources/VisualTypist/Resources/Web` with any static file server. Documents are saved as `.vteq`
(JSON with the LaTeX source and display settings); the app also opens `.tex`, `.latex` and `.txt`
files containing an equation.

## License

[MIT](LICENSE). Visual Typist bundles [MathLive](https://mathlive.io) and
[MathJax](https://www.mathjax.org); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
