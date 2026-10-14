'use strict';
// Default keyboard shortcuts.
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
  'ctrl+p': { insert: 'pi' },
  'ctrl+o': { insert: 'omega' },
  'alt+shift+p': { insert: 'psi' },
  'ctrl+shift+p': { insert: 'partial' },
  'alt+i': { insert: 'infty' },
  "ctrl+'": { insert: 'prime' },
  'ctrl+r': { insert: 'sqrt' },
  'ctrl+f': { insert: 'frac' },
  'ctrl+q': { insert: 'superscript' },
  'ctrl+e': { insert: 'subscript' },
  'ctrl+j': { insert: 'subsup' },
  'ctrl+d': { insert: 'dot' },
  'ctrl+shift+d': { insert: 'ddot' },
  'ctrl+h': { insert: 'widehat' },
  'alt+t': { insert: 'overleftrightarrow' },
  'alt+b': { insert: 'bra' },
  'alt+k': { insert: 'ket' },
  'alt+9': { insert: 'paren-mid' },
  'ctrl+shift+i': { insert: 'int-limits' },
  'ctrl+shift+s': { insert: 'sum-limits' },

  // Caret movement
  'alt+w': { command: 'cursorUp' },
  'alt+s': { command: 'cursorDown' },
  'alt+a': { command: 'cursorLeft' },
  'alt+d': { command: 'cursorRight' },
  'alt+q': { command: 'lineStart' },
  'alt+l': { command: 'lineEnd' },

  // Editing
  'ctrl+tab': { command: 'toggleMode' },
  'shift+enter': { command: 'applyCode' },
  'ctrl+g': { command: 'greekNext' },
  'ctrl+1': { command: 'styleRegular' },
  'ctrl+2': { command: 'styleItalic' },
  'ctrl+3': { command: 'styleBold' },
  'ctrl+4': { command: 'styleBoldItalic' },
  'ctrl+5': { command: 'styleSans' },
  'ctrl+6': { command: 'styleMono' },
  'alt+up': { command: 'addRowBefore' },
  'alt+down': { command: 'addRowAfter' },
  'alt+left': { command: 'addColumnBefore' },
  'alt+right': { command: 'addColumnAfter' },
  'ctrl+alt+up': { command: 'removeRow' },
  'ctrl+alt+down': { command: 'removeRow' },
  'ctrl+alt+left': { command: 'removeColumn' },
  'ctrl+alt+right': { command: 'removeColumn' },
};

// ⌃G followed by a letter types a Greek letter; Shift gives the capital.
window.VT_GREEK_KEYS = {
  a: ['\\alpha', 'A'], b: ['\\beta', 'B'], c: ['\\chi', 'X'], d: ['\\delta', '\\Delta'],
  e: ['\\varepsilon', 'E'], f: ['\\phi', '\\Phi'], g: ['\\gamma', '\\Gamma'], h: ['\\eta', 'H'],
  i: ['\\iota', 'I'], j: ['\\varphi', '\\vartheta'], k: ['\\kappa', 'K'], l: ['\\lambda', '\\Lambda'],
  m: ['\\mu', 'M'], n: ['\\nu', 'N'], o: ['o', 'O'], p: ['\\pi', '\\Pi'], q: ['\\theta', '\\Theta'],
  r: ['\\rho', 'P'], s: ['\\sigma', '\\Sigma'], t: ['\\tau', 'T'], u: ['\\upsilon', '\\Upsilon'],
  v: ['\\varpi', '\\varsigma'], w: ['\\omega', '\\Omega'], x: ['\\xi', '\\Xi'], y: ['\\psi', '\\Psi'],
  z: ['\\zeta', 'Z'],
};
