# Visual Typist

A keyboard-first visual equation editor for macOS. Type math in a WYSIWYG canvas, insert
structures from a symbol palette or with shortcuts, switch to the LaTeX code at any time,
and export to PDF, PNG, SVG, LaTeX or MathML.

- **Visual editing** on top, **symbol palette** below — or flip the bottom pane to the
  **LaTeX code** (`⌃⇥`). Both stay in sync as you type.
- **300+ symbols and templates** in 12 tabs: Greek, fractions & scripts, operators, relations,
  symbols & fonts, accents, over/under braces, brackets (incl. bra–ket), integrals, large
  operators, matrices and arrows.
- **Shortcuts for everything.** Right-click any palette button to give it a shortcut, or edit
  them all in *Settings › Keyboard Shortcuts* (`⌘,`).
- **Vector export** (PDF, SVG), PNG at 1×–4×, standalone LaTeX, MathML; copy as image or LaTeX.
- Runs fully offline. Native Apple Silicon app for macOS 14 or later.

## Build and install

```sh
./build.sh      # checks the toolchain, then builds "Visual Typist.app" in the current directory
./install.sh    # copies it to /Applications
```

`build.sh` verifies the platform (Apple Silicon, macOS 14+), the Xcode Command Line Tools,
Swift 6 and the bundled math engines. If something is missing it explains what and offers to
install it (`--yes` accepts every offer, `--check` only checks). `install.sh --open` launches
the app afterwards and `install.sh --uninstall` removes it.

The app is signed ad hoc for local use; it is not notarized.

## Keyboard shortcuts

Shortcuts use **⌃ Control** and **⌥ Option**, so they never collide with the ⌘ menu commands.
Keys are matched by position, so `⌥K` works even though macOS would normally type `˚`.

| Insert | Shortcut | | Insert | Shortcut |
| --- | --- | --- | --- | --- |
| α | `⌥A` | | Fraction | `⌃F` |
| γ | `⌥G` | | Square root | `⌃R` |
| π | `⌃P` | | Superscript | `⌃Q` |
| ω | `⌃O` | | Subscript | `⌃E` |
| ψ | `⌥⇧P` | | Sub- and superscript | `⌃J` |
| ∂ | `⌃⇧P` | | Integral with limits | `⌃⇧I` |
| ∞ | `⌥I` | | Sum with limits | `⌃⇧S` |
| ′ (prime) | `⌃'` | | Dot / double dot accent | `⌃D` / `⌃⇧D` |
| ⟨▢\| (bra) | `⌥B` | | Wide hat | `⌃H` |
| \|▢⟩ (ket) | `⌥K` | | ↔ over | `⌥T` |
| ⟨▢\|▢⟩ | `⌥D` | | (▢\|▢) | `⌥9` |

| Editing | Shortcut |
| --- | --- |
| Switch between symbols and LaTeX code | `⌃⇥` |
| Apply the LaTeX code and return to the equation | `⇧↩` |
| Type the next letter in Greek (⇧ for capitals) | `⌃G`, then a letter |
| Upright / italic / bold / bold italic / sans / mono | `⌃1` … `⌃6` |
| Matrix: insert row above / below, column before / after | `⌥↑` `⌥↓` `⌥←` `⌥→` |
| Matrix: delete row / column | `⌃⌥↑` / `⌃⌥←` |
| Copy LaTeX / copy as image | `⌥⌘C` / `⇧⌘C` |

Your changes are saved to `~/Library/Application Support/Visual Typist/shortcuts.json`, layered
over the defaults in [`keymap.js`](Sources/VisualTypist/Resources/Web/keymap.js). The file can be
edited by hand (then choose *Reload Shortcuts File*):

```json
{
  "version": 1,
  "shortcuts": {
    "alt+k": { "insert": "ket" },
    "ctrl+l": { "latex": "\\mathcal{L}" },
    "ctrl+h": null
  }
}
```

A binding inserts a palette item by id (`insert`), arbitrary LaTeX with `#0`, `#1`… slots
(`latex`), or runs an editor `command`; `null` removes a default.

## Project layout

```
Sources/VisualTypist/          macOS app (SwiftUI + WebKit)
  App/                         app entry point, window, menus
  Document/                    per-window document session: open, save, export, clipboard
  Editor/                      web view bridge, native shortcut handling, shortcut storage
  Export/                      PDF / PNG / SVG / LaTeX / MathML export
  Resources/Web/               editor UI: editor.js, palette.js, keymap.js, app.css
    vendor/                    MathLive (editing) and MathJax (rendering, export)
Sources/VisualTypistCore/      document format, LaTeX import, key combos
Tests/VisualTypistCoreTests/   unit tests
scripts/                       test runner, vendor update, icon generator
```

Documents are saved as `.vteq` (JSON with the LaTeX source and display settings). The app also
opens `.tex`, `.latex` and `.txt` files containing a single equation.

## Development

```sh
swift build                  # debug build
./scripts/test.sh            # unit tests (works with Xcode or the Command Line Tools)
./scripts/update-vendor.sh   # refresh MathLive / MathJax to the versions in package.json
```

The editor UI is a plain web page: serve `Sources/VisualTypist/Resources/Web` with any static
file server to work on it in a browser.

## License

[MIT](LICENSE). Bundled third-party components are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
