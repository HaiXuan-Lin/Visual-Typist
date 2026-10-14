# Visual Typist

A keyboard-first visual equation editor for macOS. Type math in a WYSIWYG canvas, insert
structures from a symbol palette or with shortcuts, switch to the LaTeX code at any time,
and export to PDF, PNG, SVG, LaTeX or MathML.

- **Visual editing** on top, **symbol palette** below — or flip the bottom pane to the
  **LaTeX code** (`⌃⇥`). Both stay in sync as you type.
- **Structured editing like a classic equation editor:** a document of equation lines (↩ starts
  a new line, ⌫ at the start of a line joins it to the one above); empty slots show as light-blue
  blocks (in the LaTeX they are plain `{}`); ←/→ and ⇥ / ⇧⇥ walk the slots in order (∑ and ∫:
  lower limit, upper limit, then the body); ↑/↓ move between slots (numerator ↔ denominator,
  upper ↔ lower limit, matrix rows) and lines; ⌫ in an empty slot selects its structure, and a
  second ⌫ deletes it — an emptied script is selected, then removed while its base stays.
- **Templates and accents behave like a classic editor's buttons:** an accent (`⌘H` hat, `⌘D` dot,
  `⌥T` vector…) applies to the symbol before the caret or to the selection; a template takes the
  selection into its first slot and puts the caret in the next one (a selected expression
  becomes the integrand of `⇧⌘I`, the lower limit of `⇧⌘S`, the numerator of `⌘F`).
- **300+ symbols and templates** in 13 tabs: Greek, fractions & scripts, operators, relations,
  symbols & fonts, accents, over/under braces, brackets (incl. bra–ket), integrals, large
  operators, functions, matrices and arrows — integrals, operators and matrices in large,
  display-style tiles.
- **Type commands like an input method.** Type `\` and a name (`\mu`, `\frac`, `\sum`…): a
  candidate bar shows matching symbols and templates. `Space` takes the first, `1`–`8` pick one,
  `↩` keeps the command as typed, `⎋` cancels, `,` `.` page through. Works in the LaTeX pane too.
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

Shortcuts follow Windows equation-editor habits: **Ctrl becomes ⌘** and **Alt becomes ⌥**.
Keys are matched by position, so `⌥K` works even though macOS would normally type `˚`.

While the equation has focus, its shortcuts win over menu items with the same keys — `⌘Q` makes
a superscript and `⌘H` a wide hat, so quit or hide from the app menu (or reassign them). Menu
commands that would collide moved: Open is `⇧⌘O` and Save As `⌥⇧⌘S`. In the equation, `⌘C`
copies it as an image (SVG, with PDF and PNG for apps that don't take SVG) and `⌘T` copies the
LaTeX.

| Insert | Shortcut | | Insert | Shortcut |
| --- | --- | --- | --- | --- |
| γ | `⌥G` | | Fraction | `⌘F` |
| ∞ | `⌥I` | | Square root | `⌘R` |
| π | `⌘P` | | Superscript | `⌘Q` |
| ω | `⌘O` | | Subscript | `⌘E` or `⌘L` |
| ψ | `⌥⇧P` | | Sub- and superscript | `⌘J` |
| ∂ | `⇧⌘P` | | Integral with limits | `⇧⌘I` |
| (▢\|▢) | `⌥9` | | Sum with limits | `⇧⌘S` |
| ′ (prime) | `⌘'` | | Dot / double dot accent | `⌘D` / `⇧⌘D` |
| ⟨▢\| (bra) | `⌥B` | | Hat | `⌘H` |
| \|▢⟩ (ket) | `⌥K` | | Vector arrow | `⌥T` |

| Editing | Shortcut |
| --- | --- |
| New line / join with the line above | `↩` / `⌫` at the start of a line |
| Next / previous slot | `⇥` / `⇧⇥` |
| Move up / down / left / right | `⌥W` `⌥S` `⌥A` `⌥D` (or the arrow keys) |
| Move to start / end of line | `⌥Q` / `⌥L` |
| Switch between symbols and LaTeX code | `⌃⇥` |
| Apply the LaTeX code and return to the equation | `⇧↩` |
| Type the next letter in Greek (⇧ for capitals) | `⌘G`, then a letter |
| Font of the selection (or of the symbol before the caret): `\mathrm`, none, `\mathbf`, `\boldsymbol`, `\mathsf`, `\mathtt`, `\mathcal`, `\mathscr`, `\mathfrak` | `⌘1` … `⌘9` (also `⌘B` bold, `⌘I` italic) |
| Matrix: insert row above / below, column before / after | `⌥↑` `⌥↓` `⌥←` `⌥→` |
| Matrix: delete row / column | `⌥⌘↑` / `⌥⌘←` |
| Copy as image / copy LaTeX | `⌘C` / `⌘T` |

While the equation has focus, an active input method (Pinyin, Kana…) is switched to a Roman
keyboard layout so letters arrive as math; your input method returns in the LaTeX pane, where
you can type CJK text inside `\text{}`.

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

Documents are saved as `.vteq` (JSON with the LaTeX source and display settings). In the LaTeX
the equation lines are separated by `\\`; multi-line documents export as a left-aligned array. The app also
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
