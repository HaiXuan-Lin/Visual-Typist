'use strict';
// Default keyboard shortcuts. Windows-style Ctrl shortcuts use ⌘ (cmd) and Alt shortcuts use ⌥ (alt);
// while the equation has focus they take precedence over menu commands with the same keys.
//
// A binding maps a key combo (see KeyCombo.swift for the format) to one of:
//   { insert: '<palette id>' }   insert a palette item
//   { latex: '<latex>' }         insert LaTeX (#0, #1… are slots)
//   { command: '<name>' }        run an editor command (see COMMANDS in editor.js)
//
// Users can reassign any shortcut in Settings › Keyboard Shortcuts; their changes are stored in
// ~/Library/Application Support/Visual Typist/shortcuts.json and layered over these defaults.

window.VT_DEFAULT_KEYMAP = {
  // Symbols and structures
  'alt+g': { insert: 'gamma' },
  'cmd+p': { insert: 'pi' },
  'cmd+o': { insert: 'omega' },
  'alt+shift+p': { insert: 'psi' },
  'cmd+shift+p': { insert: 'partial' },
  'alt+i': { insert: 'infty' },
  "cmd+'": { insert: 'prime' },
  'cmd+r': { insert: 'sqrt' },
  'cmd+f': { insert: 'frac' },
  'cmd+q': { insert: 'superscript' },
  'cmd+e': { insert: 'subscript' },
  'cmd+l': { insert: 'subscript' },
  'cmd+j': { insert: 'subsup' },
  'cmd+d': { insert: 'dot' },
  'cmd+shift+d': { insert: 'ddot' },
  'cmd+h': { insert: 'widehat' },
  'alt+t': { insert: 'overleftrightarrow' },
  'alt+b': { insert: 'bra' },
  'alt+k': { insert: 'ket' },
  'alt+9': { insert: 'paren-mid' },
  'cmd+shift+i': { insert: 'int-limits' },
  'cmd+shift+s': { insert: 'sum-limits' },

  // Caret movement
  'alt+w': { command: 'cursorUp' },
  'alt+s': { command: 'cursorDown' },
  'alt+a': { command: 'cursorLeft' },
  'alt+d': { command: 'cursorRight' },
  'alt+q': { command: 'lineStart' },
  'alt+l': { command: 'lineEnd' },

  // Editing (Control-Tab: Command-Tab belongs to the system's app switcher)
  'ctrl+tab': { command: 'toggleMode' },
  'shift+enter': { command: 'applyCode' },
  'cmd+g': { command: 'greekNext' },
  'cmd+b': { command: 'fontBold' },
  'cmd+i': { command: 'fontItalic' },
  'cmd+1': { command: 'fontRoman' },
  'cmd+2': { command: 'fontNormal' },
  'cmd+3': { command: 'fontBold' },
  'cmd+4': { command: 'fontBoldSymbol' },
  'cmd+5': { command: 'fontSans' },
  'cmd+6': { command: 'fontMono' },
  'cmd+7': { command: 'fontCalligraphic' },
  'cmd+8': { command: 'fontScript' },
  'cmd+9': { command: 'fontFraktur' },
  'alt+up': { command: 'addRowBefore' },
  'alt+down': { command: 'addRowAfter' },
  'alt+left': { command: 'addColumnBefore' },
  'alt+right': { command: 'addColumnAfter' },
  'cmd+alt+up': { command: 'removeRow' },
  'cmd+alt+down': { command: 'removeRow' },
  'cmd+alt+left': { command: 'removeColumn' },
  'cmd+alt+right': { command: 'removeColumn' },
};

// ⌘G followed by a letter types a Greek letter; Shift gives the capital.
window.VT_GREEK_KEYS = {
  a: ['\\alpha', 'A'], b: ['\\beta', 'B'], c: ['\\chi', 'X'], d: ['\\delta', '\\Delta'],
  e: ['\\varepsilon', 'E'], f: ['\\phi', '\\Phi'], g: ['\\gamma', '\\Gamma'], h: ['\\eta', 'H'],
  i: ['\\iota', 'I'], j: ['\\varphi', '\\vartheta'], k: ['\\kappa', 'K'], l: ['\\lambda', '\\Lambda'],
  m: ['\\mu', 'M'], n: ['\\nu', 'N'], o: ['o', 'O'], p: ['\\pi', '\\Pi'], q: ['\\theta', '\\Theta'],
  r: ['\\rho', 'P'], s: ['\\sigma', '\\Sigma'], t: ['\\tau', 'T'], u: ['\\upsilon', '\\Upsilon'],
  v: ['\\varpi', '\\varsigma'], w: ['\\omega', '\\Omega'], x: ['\\xi', '\\Xi'], y: ['\\psi', '\\Psi'],
  z: ['\\zeta', 'Z'],
};
