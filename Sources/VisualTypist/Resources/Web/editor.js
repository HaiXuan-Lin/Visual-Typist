'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('canvas');
  const fieldHost = $('field-host');
  const codeArea = $('code');
  const codeStatus = $('code-status');
  const strip = $('strip');
  const tabs = $('tabs');

  const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96];
  const EDIT_SCALE = 1.25; // The canvas shows equations a little larger than their export size.
  const DEFAULT_INK = '#17191D'; // Shown in the canvas as the theme's text color, so it reads in dark mode.

  const state = { latex: '', fontSize: 32, color: DEFAULT_INK, displayStyle: true };
  const ui = { mode: 'symbols' };
  const paletteById = new Map(VT_PALETTE.flatMap(category => category.items.map(item => [item.id, item])));

  let lines = [];        // One editor field per line of the document.
  let loading = false;   // True while the editor is filled from LaTeX; edits are not reported then.
  let mathfield = null;  // The line with the caret.
  // A selection across lines (dragged over several lines, or ⌘A): the next edit or copy applies to it.
  // `from` and `to` are {line, offset} at the top level of their lines; `all` marks ⌘A.
  let allSelected = false;
  let span = null;
  let scratchField = null;
  let overrides = {};
  let keymap = {};
  let greekPending = false;
  let recording = null;
  let codeTimer = null;
  let validationTimer = null;
  let renderQueue = Promise.resolve();
  let dynamicTeXMaps = [];

  // ---------------------------------------------------------------- native bridge

  function post(type, payload = {}) {
    try { window.webkit?.messageHandlers?.vt?.postMessage({ type, ...payload }); }
    catch (error) { console.warn('Native bridge unavailable:', error); }
  }

  function notifyChange() {
    post('change', { ...state });
  }

  // ---------------------------------------------------------------- key combos

  const CODE_KEYS = {
    Quote: "'", Comma: ',', Minus: '-', Period: '.', Slash: '/', Semicolon: ';', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`', Tab: 'tab', Enter: 'enter',
    NumpadEnter: 'enter', Space: 'space', Backspace: 'backspace', Delete: 'forwarddelete', Escape: 'escape',
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end',
  };
  const KEY_ALIASES = { return: 'enter', esc: 'escape', delete: 'backspace', quote: "'", apostrophe: "'" };
  const KEY_NAMES = new Set([...'abcdefghijklmnopqrstuvwxyz0123456789', ...Object.values(CODE_KEYS)]);
  const MODIFIERS = [['ctrl', '⌃'], ['alt', '⌥'], ['shift', '⇧'], ['cmd', '⌘']];
  const MODIFIER_ALIASES = { control: 'ctrl', option: 'alt', opt: 'alt', command: 'cmd' };
  const KEY_SYMBOLS = {
    left: '←', right: '→', up: '↑', down: '↓', tab: '⇥', enter: '↩', space: 'Space', backspace: '⌫',
    forwarddelete: '⌦', escape: '⎋', home: '↖', end: '↘',
  };
  // Menu and system commands that a recorded shortcut may not take over.
  const RESERVED = new Set(['cmd+c', 'cmd+v', 'cmd+x', 'cmd+z', 'shift+cmd+z', 'cmd+s', 'cmd+w', 'cmd+,', 'cmd+tab',
    'cmd+space', 'cmd+t', 'shift+cmd+n', 'shift+cmd+o', 'alt+shift+cmd+s']);

  function keyName(event) {
    if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
    if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
    return CODE_KEYS[event.code] || null;
  }

  function comboFromEvent(event) {
    const key = keyName(event);
    if (!key) return null;
    const flags = { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, cmd: event.metaKey };
    return [...MODIFIERS.map(([name]) => flags[name] && name).filter(Boolean), key].join('+');
  }

  /** Canonical form of a combo string such as "Option+K" → "alt+k"; null if invalid. */
  function normalizeCombo(text) {
    const parts = String(text).toLowerCase().split('+').map(part => part.trim());
    const key = KEY_ALIASES[parts.at(-1)] || parts.at(-1);
    if (!KEY_NAMES.has(key)) return null;
    const mods = new Set();
    for (const part of parts.slice(0, -1)) {
      const name = MODIFIER_ALIASES[part] || part;
      if (!MODIFIERS.some(([modifier]) => modifier === name)) return null;
      mods.add(name);
    }
    return [...MODIFIERS.map(([name]) => mods.has(name) && name).filter(Boolean), key].join('+');
  }

  function displayCombo(combo) {
    const parts = combo.split('+');
    const key = parts.pop();
    return MODIFIERS.filter(([name]) => parts.includes(name)).map(([, symbol]) => symbol).join('') +
      (KEY_SYMBOLS[key] || key.toUpperCase());
  }

  // ---------------------------------------------------------------- keymap

  const DEFAULT_KEYMAP = Object.fromEntries(
    Object.entries(VT_DEFAULT_KEYMAP).map(([combo, binding]) => [normalizeCombo(combo), binding]));

  function validBinding(binding) {
    if (!binding || typeof binding !== 'object') return false;
    if (typeof binding.insert === 'string') return paletteById.has(binding.insert);
    if (typeof binding.latex === 'string') return binding.latex.length > 0;
    if (typeof binding.command === 'string') return Object.hasOwn(COMMANDS, binding.command);
    return false;
  }

  function sanitizeOverrides(raw) {
    const result = {};
    for (const [combo, binding] of Object.entries(raw || {})) {
      const normalized = normalizeCombo(combo);
      if (normalized) result[normalized] = binding;
    }
    return result;
  }

  function rebuildKeymap() {
    keymap = {};
    Object.assign(keymap, DEFAULT_KEYMAP);
    for (const [combo, binding] of Object.entries(overrides)) {
      if (binding === null) delete keymap[combo];
      else if (validBinding(binding)) keymap[combo] = binding;
    }
    post('shortcuts', { combos: Object.keys(keymap) });
    refreshKeyHints();
  }

  function saveOverrides() {
    post('saveShortcuts', { overrides });
    rebuildKeymap();
  }

  function sameTarget(a, b) {
    return a && b && ((a.insert && a.insert === b.insert) || (a.latex && a.latex === b.latex) ||
      (a.command && a.command === b.command));
  }

  function combosFor(binding) {
    return Object.entries(keymap).filter(([, bound]) => sameTarget(bound, binding)).map(([combo]) => combo);
  }

  /** Binds `combo` to `binding`; a palette item keeps only one shortcut, as in classic equation editors. */
  function assign(combo, binding) {
    if (binding.insert) {
      for (const previous of combosFor(binding)) unassign(previous);
    }
    overrides[combo] = binding;
    saveOverrides();
  }

  function unassign(combo) {
    if (DEFAULT_KEYMAP[combo]) overrides[combo] = null;
    else delete overrides[combo];
  }

  // Commands that act on a ⌘A selection themselves; any other command ends it first.
  const SELECTION_COMMANDS = new Set(['selectAll', 'undo', 'redo', 'toggleTheme', 'fontBold', 'fontItalic', 'fontRoman', 'fontNormal',
    'fontBoldSymbol', 'fontSans', 'fontMono', 'fontCalligraphic', 'fontScript', 'fontFraktur']);

  function runShortcut(combo) {
    const binding = keymap[normalizeCombo(combo)];
    if (!binding) return false;
    // A shortcut is its own undo step (the native side runs it without a keydown here).
    inputKind = 'other';
    history.lastKind = null;
    if (binding.insert) return insertItem(paletteById.get(binding.insert));
    if (binding.latex) return insertLatex(binding.latex);
    if (!SELECTION_COMMANDS.has(binding.command)) setAllSelected(false);
    return COMMANDS[binding.command]?.() !== false;
  }

  // ---------------------------------------------------------------- editing

  const codeFocused = () => document.activeElement === codeArea;

  function insertLatex(latex) {
    if (codeFocused()) return insertIntoCode(latex);
    if (!mathfield) return false;
    leaveSelectAll({ replace: true });
    mathfield.focus();
    // A script with nothing before it (start of a slot, or an empty slot) needs an empty base: {}_{…}.
    const model = fieldModel();
    const anchor = model && caretAtom(model);
    if (/^[_^]/.test(latex) && (model?.selectionIsPlaceholder || anchor?.type === 'first')) latex = `{}${latex}`;
    // A script after scripts is a script node of its own (⌘Q 1 → ⌘L 2), as in classic editors;
    // it is written {a^{1}}_{2}, so tensor indices stay staggered (see scripts/patches).
    mathfield.insert(latex, {
      format: 'latex', insertionMode: 'replaceSelection', selectionMode: 'placeholder', focus: true, feedback: false,
    });
    groupOperands();
    syncFromField();
    return true;
  }

  /**
   * Inserts a palette item the way classic equation editors do: an accent applies to the symbol
   * before the caret (or the selection); a template takes the selection into its first slot and
   * puts the caret in the next one, or at the end of that slot when there is no other.
   */
  /**
   * What a template or symbol does with a ⌘A selection, as in classic editors: over several lines it
   * replaces the document; within one line it goes after it. An accent ignores the selection and
   * applies to the symbol before the caret.
   */
  function leaveSelectAll({ replace }) {
    if (!allSelected) return;
    const { from, to } = span;
    if (replace && from.line !== to.line) { replaceSpan(''); return; }
    setAllSelected(false);
    focusAt(to.line, to.offset);
  }

  function insertItem(item) {
    if (!item) return false;
    if (codeFocused()) return insertIntoCode(item.latex);
    leaveSelectAll({ replace: !item.accent });
    const model = fieldModel();
    if (!model) return insertLatex(item.latex);
    const hadSelection = !model.selectionIsCollapsed && !model.selectionIsPlaceholder;
    if (item.accent) return applyAccent(item.latex, model, hadSelection);
    insertLatex(item.latex);
    const target = hadSelection ? item.caretWithSelection : item.caret;
    if (target) placeCaretInOperator(target);
    // The selection filled the only slot: keep the caret at the end of that slot.
    else if (hadSelection && item.latex.includes('#0') && !fieldModel()?.selectionIsPlaceholder) mathfield.executeCommand('moveToPreviousChar');
    syncFromField();
    return true;
  }

  /** Wraps the selection, or the one symbol (or structure) before the caret, in an accent. */
  function applyAccent(template, model, hadSelection) {
    let range;
    if (hadSelection) {
      range = [...model.selection.ranges[0]].sort((a, b) => a - b);
    } else {
      const before = model.at(model.position);
      if (model.selectionIsPlaceholder || !before || before.type === 'first') return true; // Nothing to accent.
      range = [model.position - (before.children?.length ?? 0) - 1, model.position];
    }
    const argument = mathfield.getValue(range[0], range[1], 'latex');
    mathfield.selection = { ranges: [range] };
    mathfield.insert(template.replace(/#0/, argument),
      { format: 'latex', insertionMode: 'replaceSelection', selectionMode: 'after', feedback: false });
    syncFromField();
    return true;
  }

  /** After inserting scripts, ∑ or ∫: put the caret in the lower or upper slot, or the operand. */
  function placeCaretInOperator(target) {
    const model = fieldModel();
    const atom = model && caretAtom(model);
    const operator = LARGE_OPERATORS.has(atom?.parent?.type) || SCRIPT_BRANCHES.includes(atom?.parentBranch) ? atom.parent
      : operatorOf(atom?.parent) ?? (LARGE_OPERATORS.has(atom?.leftSibling?.type) ? atom.leftSibling : null);
    if (!operator) return;
    if (target === 'operand') {
      const operand = operandOf(operator);
      if (operand?.type === 'placeholder') selectPlaceholderAt(model.offsetOf(operand));
      else if (operand) moveCaretTo(model.offsetOf(branchAtoms(operand, 'body').at(-1)));
      else mathfield.position = model.offsetOf(operator);
      return;
    }
    const branch = target === 'lower' ? 'subscript' : 'superscript';
    const atoms = branchAtoms(operator, branch);
    if (atoms.length) moveCaretTo(model.offsetOf(atoms.at(-1)));
  }

  /** Inserts LaTeX as text in the code editor; the caret lands in the first empty slot. */
  function insertIntoCode(latex) {
    const { selectionStart: start, selectionEnd: end, value } = codeArea;
    const selected = value.slice(start, end);
    const MARK = '\u0000';
    let text = latex.replace(/#@|#0/g, () => selected || MARK).replace(/#[1-9?]/g, MARK);
    if (/\\[a-zA-Z]+$/.test(text) && /^[a-zA-Z]/.test(value.slice(end))) text += ' ';
    const caret = text.includes(MARK) ? start + text.indexOf(MARK) : start + text.length;
    text = text.replaceAll(MARK, '');
    codeArea.setRangeText(text, start, end, 'end');
    codeArea.setSelectionRange(caret, caret);
    codeArea.dispatchEvent(new Event('input'));
    return true;
  }

  const FONT_COMMANDS = new Set(['mathrm', 'mathit', 'mathbf', 'boldsymbol', 'bm', 'mathsf', 'mathtt', 'mathcal',
    'mathscr', 'mathfrak', 'mathbfit', 'mathnormal']);

  /** Removes font commands (\mathbf{…}, \mathcal{…}…) from LaTeX, keeping their contents. */
  function stripFonts(latex) {
    let result = '';
    for (let index = 0; index < latex.length;) {
      const match = /^\\([a-zA-Z]+)\s*\{/.exec(latex.slice(index));
      if (match && FONT_COMMANDS.has(match[1])) {
        let depth = 1;
        let end = index + match[0].length;
        for (; end < latex.length && depth > 0; end += 1) {
          if (latex[end] === '\\') { end += 1; continue; }
          if (latex[end] === '{') depth += 1;
          if (latex[end] === '}') depth -= 1;
        }
        result += stripFonts(latex.slice(index + match[0].length, end - 1));
        index = end;
      } else {
        result += latex[index];
        index += 1;
      }
    }
    return result;
  }

  /** What is typed next has no font, even right after a restyled symbol (MathLive would continue its style). */
  function resetTypingStyle(field) {
    field.applyStyle({ variant: 'normal', variantStyle: '' }, { operation: 'set' });
  }

  /**
   * Sets the font (`command` such as 'mathbf', or null for none) of the selection, or else of the
   * one symbol or structure just before the caret — like an accent. With nothing before the caret
   * it does nothing.
   */
  function setFont(command) {
    const wrap = text => {
      const inner = stripFonts(text);
      return command ? `\\${command}{${inner}}` : inner;
    };
    if (codeFocused()) {
      const { selectionStart, selectionEnd, value } = codeArea;
      let start = selectionStart;
      if (start === selectionEnd) {
        // The command, group or character before the caret.
        const before = /(\\[a-zA-Z]+(?:\{[^{}]*\})?|\{[^{}]*\}|[^\s{}\\])$/.exec(value.slice(0, selectionEnd));
        if (!before) return true;
        start = selectionEnd - before[0].length;
      }
      codeArea.setRangeText(wrap(value.slice(start, selectionEnd)), start, selectionEnd,
        selectionStart === selectionEnd ? 'end' : 'select');
      codeArea.dispatchEvent(new Event('input'));
      return true;
    }
    if (allSelected) {
      // Across lines a font applies to each line's selected part; after ⌘A everything stays selected.
      const { from, to, all } = span;
      const restyled = lines.map((field, index) => {
        if (index < from.line || index > to.line) return lineLatex(field);
        const start = index === from.line ? from.offset : 0;
        const end = index === to.line ? to.offset : field.lastOffset;
        const selected = lineLatex(field, start, end);
        return lineLatex(field, 0, start) + (selected.trim() ? wrap(selected.trim()) : selected) + lineLatex(field, end);
      }).join(LINE_BREAK);
      setAllSelected(false, mathfield, false);
      setDocumentLatex(restyled).then(() => { syncFromField(); if (all) selectAll(); });
      return true;
    }
    const model = fieldModel();
    if (!mathfield || !model) return false;
    mathfield.focus();
    const hadSelection = !model.selectionIsCollapsed && !model.selectionIsPlaceholder;
    let start, end;
    if (hadSelection) {
      [start, end] = [...model.selection.ranges[0]].sort((a, b) => a - b);
    } else {
      const before = model.at(model.position);
      if (model.selectionIsPlaceholder || !before || before.type === 'first') return true; // Nothing to restyle.
      end = model.position;
      start = end - (before.children?.length ?? 0) - 1;
    }
    const selected = mathfield.getValue(start, end, 'latex');
    const topLevel = model.at(start + 1)?.parent === model.root && model.at(end)?.parent === model.root;
    if (!topLevel) {
      // Inside a structure: MathLive's insert (it writes bold Latin letters as \mathbf).
      mathfield.selection = { ranges: [[start, end]] };
      mathfield.insert(wrap(selected), { format: 'latex', insertionMode: 'replaceSelection',
        selectionMode: hadSelection ? 'item' : 'after', feedback: false });
      if (!hadSelection) resetTypingStyle(mathfield);
      syncFromField();
      return true;
    }
    // Rebuilding the line keeps the exact command (MathLive's insert would turn \boldsymbol{x} into \mathbf{x}).
    const field = mathfield;
    const before = field.getValue(0, start, 'latex');
    const after = field.getValue(end, field.lastOffset, 'latex');
    const middle = wrap(selected);
    const glue = (left, right) => (/\\[a-zA-Z]+$/.test(left) && /^[a-zA-Z]/.test(right) ? ' ' : '');
    const remaining = field.lastOffset - end;
    setLineValue(lines.indexOf(field), before + glue(before, middle) + middle + glue(middle, after) + after).then(updated => {
      updated.focus();
      const newEnd = updated.lastOffset - remaining;
      if (hadSelection) updated.selection = { ranges: [[start, newEnd]] };
      else {
        updated.position = newEnd;
        resetTypingStyle(updated);
      }
      syncFromField();
    });
    return true;
  }

  function matrixCommand(name) {
    if (codeFocused() || !mathfield) return false;
    // Outside a matrix MathLive would turn the line into \displaylines rows.
    const model = fieldModel();
    let atom = model && caretAtom(model);
    while (atom && atom.type !== 'array') atom = atom.parent;
    if (!atom) return false;
    mathfield.executeCommand(name);
    syncFromField();
    return true;
  }

  /**
   * Removes the row above or below (axis 'row', direction -1/+1) or the column left or right of
   * the caret's cell, as classic editors do; the caret stays in its cell.
   */
  function removeNeighbor(axis, direction) {
    if (codeFocused() || !mathfield) return false;
    const model = fieldModel();
    let cell = model && caretAtom(model);
    while (cell && cell.parent?.type !== 'array') cell = cell.parent;
    if (!cell) return false;
    const array = cell.parent;
    const [row, col] = cell.parentBranch;
    const target = axis === 'row' ? [row + direction, col] : [row, col + direction];
    if (target[0] < 0 || target[1] < 0 || target[0] >= array.rowCount || target[1] >= array.colCount) return true;
    moveCaretTo(model.offsetOf(branchAtoms(array, target).at(-1)));
    mathfield.executeCommand(axis === 'row' ? 'removeRow' : 'removeColumn');
    const home = axis === 'row' ? [direction < 0 ? row - 1 : row, col] : [row, direction < 0 ? col - 1 : col];
    const after = fieldModel();
    const atoms = branchAtoms(array, home);
    if (atoms.length) moveCaretTo(after.offsetOf(atoms.at(-1)));
    syncFromField();
    return true;
  }

  const COMMANDS = {
    toggleMode: () => setMode(ui.mode === 'symbols' ? 'code' : 'symbols', { focus: true }),
    applyCode: () => {
      if (!codeFocused()) return false;
      applyCodeNow();
      mathfield?.focus();
      return true;
    },
    greekNext: () => { setGreekPending(true); return true; },
    fontRoman: () => setFont('mathrm'),
    fontNormal: () => setFont(null),
    fontItalic: () => setFont('mathit'),
    fontBold: () => setFont('mathbf'),
    fontBoldSymbol: () => setFont('boldsymbol'),
    fontSans: () => setFont('mathsf'),
    fontMono: () => setFont('mathtt'),
    fontCalligraphic: () => setFont('mathcal'),
    fontScript: () => setFont('mathscr'),
    fontFraktur: () => setFont('mathfrak'),
    removeRowAbove: () => removeNeighbor('row', -1),
    removeRowBelow: () => removeNeighbor('row', 1),
    removeColumnLeft: () => removeNeighbor('column', -1),
    removeColumnRight: () => removeNeighbor('column', 1),
    addRowBefore: () => matrixCommand('addRowBefore'),
    addRowAfter: () => matrixCommand('addRowAfter'),
    addColumnBefore: () => matrixCommand('addColumnBefore'),
    addColumnAfter: () => matrixCommand('addColumnAfter'),
    removeRow: () => matrixCommand('removeRow'),
    removeColumn: () => matrixCommand('removeColumn'),
    selectAll: () => selectAll(),
    deleteLine: () => deleteLine(),
    cursorUp: () => moveCaret('up'),
    cursorDown: () => moveCaret('down'),
    cursorLeft: () => moveCaret('left'),
    cursorRight: () => moveCaret('right'),
    lineStart: () => moveCaret('lineStart'),
    lineEnd: () => moveCaret('lineEnd'),
    toggleTheme: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', { save: true }),
    undo: () => stepHistory(-1),
    redo: () => stepHistory(1),
  };

  const COMMAND_TITLES = {
    toggleMode: 'Switch between symbols and LaTeX code', applyCode: 'Apply LaTeX code to the equation',
    greekNext: 'Type the next letter in Greek', fontRoman: 'Font: upright (\\mathrm)',
    fontNormal: 'Font: normal (remove font)', fontItalic: 'Font: italic (\\mathit)', fontBold: 'Font: bold (\\mathbf)',
    fontBoldSymbol: 'Font: bold symbol (\\boldsymbol)', fontSans: 'Font: sans serif (\\mathsf)',
    fontMono: 'Font: typewriter (\\mathtt)', fontCalligraphic: 'Font: calligraphic (\\mathcal)',
    fontScript: 'Font: script (\\mathscr)', fontFraktur: 'Font: fraktur (\\mathfrak)',
    removeRowAbove: 'Matrix: delete the row above', removeRowBelow: 'Matrix: delete the row below',
    removeColumnLeft: 'Matrix: delete the column on the left', removeColumnRight: 'Matrix: delete the column on the right',
    addRowBefore: 'Matrix: insert row above', addRowAfter: 'Matrix: insert row below',
    addColumnBefore: 'Matrix: insert column before', addColumnAfter: 'Matrix: insert column after',
    removeRow: 'Matrix: delete row', removeColumn: 'Matrix: delete column', undo: 'Undo', redo: 'Redo',
    selectAll: 'Select all', deleteLine: 'Delete the line',
    cursorUp: 'Move up', cursorDown: 'Move down', cursorLeft: 'Move left', cursorRight: 'Move right',
    lineStart: 'Move to start of line', lineEnd: 'Move to end of line', toggleTheme: 'Light / dark theme',
  };

  /** Shows the light or dark theme (theme.js applies it); `save` keeps the choice in the app. */
  function setTheme(mode, { save = false } = {}) {
    window.VT_THEME = mode;
    window.VT_APPLY_THEME?.();
    if (save) post('theme', { mode });
    return true;
  }

  function selectAll() {
    if (codeFocused()) { codeArea.select(); return true; }
    if (!mathfield) return false;
    mathfield.focus();
    if (lines.length > 1 || mathfield.lastOffset > 0) setAllSelected(true);
    return true;
  }

  /** A line's LaTeX between two offsets, as the document writes it. */
  const lineLatex = (field, start = 0, end = field.lastOffset) =>
    withoutPlaceholders(portableLatex(start < end ? field.getValue(start, end, 'latex') : ''));

  /** An offset inside a structure widened to the start (or end) of its top-level atom. */
  function topLevelOffset(field, offset, toEnd) {
    const model = fieldModel(field);
    let atom = model?.at(offset);
    if (!atom || atom.isRoot || atom.parent === model.root) return offset;
    while (atom.parent && atom.parent !== model.root) atom = atom.parent;
    const [start, end] = atomRange(model, atom);
    return toEnd ? end : start;
  }

  /** Selects from `anchor` to `focus` ({line, offset}) across lines. */
  function setSpan(anchor, focus, all = false) {
    const [first, last] = anchor.line < focus.line || (anchor.line === focus.line && anchor.offset <= focus.offset)
      ? [anchor, focus] : [focus, anchor];
    span = {
      from: { line: first.line, offset: topLevelOffset(lines[first.line], first.offset, false) },
      to: { line: last.line, offset: topLevelOffset(lines[last.line], last.offset, true) },
      anchor, focus, all,
    };
    allSelected = true;
    paintSpan();
  }

  /**
   * Shows the selection in every line it covers, also in the lines without focus. With `redraw`,
   * each line's selection is set anew: right after a drag MathLive may leave the selection of the
   * line it captured the drag in undrawn, although set.
   */
  function paintSpan({ redraw = false } = {}) {
    lines.forEach((field, index) => {
      const covered = !!span && index >= span.from.line && index <= span.to.line;
      field.shadowRoot?.querySelector('.ML__container')?.classList.toggle('vt-all-selected', covered);
      if (!covered) return;
      const start = index === span.from.line ? span.from.offset : 0;
      const end = index === span.to.line ? span.to.offset : field.lastOffset;
      const [current] = field.selection.ranges;
      if (redraw) field.selection = { ranges: [[start, start]] };
      if (redraw || Math.min(...current) !== start || Math.max(...current) !== end) field.selection = { ranges: [[start, end]] };
    });
  }

  /**
   * Selects every line (⌘A), or ends a selection across lines: the selections of all lines but
   * `keep` (the line being edited, or the one just clicked) collapse.
   */
  function setAllSelected(value, keep = mathfield, collapse = true) {
    if (value) {
      const last = lines.length - 1;
      setSpan({ line: 0, offset: 0 }, { line: last, offset: lines[last].lastOffset }, true);
      return;
    }
    if (!allSelected) return;
    allSelected = false;
    span = null;
    for (const field of lines) field.shadowRoot?.querySelector('.ML__container')?.classList.remove('vt-all-selected');
    if (collapse) collapseLines(keep);
  }

  const collapseLines = keep => { for (const field of lines) if (field !== keep) field.position = field.lastOffset; };

  /**
   * Focuses a line. MathLive hands it the keyboard only 60 ms later; keys typed meanwhile would go
   * to the previous line, so until then they are sent to this one (see the keydown handler).
   */
  let pendingFocus = null;
  function focusNow(field) {
    field.focus();
    pendingFocus = field;
    setTimeout(() => { if (pendingFocus === field) pendingFocus = null; }, 100);
  }

  function focusAt(line, offset) {
    const field = lines[Math.min(line, lines.length - 1)];
    focusNow(field);
    mathfield = field;
    field.position = Math.min(offset, field.lastOffset);
  }

  /** A position {line, offset} at the top level of its line: the start or end of the element it is in. */
  function topLevelPosition(field, toEnd) {
    const model = fieldModel(field);
    const [start, end] = [...model.selection.ranges[0]].sort((a, b) => a - b);
    return { line: lines.indexOf(field), offset: topLevelOffset(field, toEnd ? end : start, toEnd) };
  }

  /** The caret's horizontal position in a line, for moving to the line above or below. */
  function caretX(field, offset) {
    const model = fieldModel(field);
    const atom = model.at(offset);
    const box = atom && field._mathfield.getHTMLElement?.(atom)?.getBoundingClientRect();
    return box ? (atom.type === 'first' ? box.left : box.right) : field.getBoundingClientRect().left;
  }

  /**
   * ⇧ with an arrow across lines: the selection's moving end goes one top-level element left or
   * right (on to the line before or after at a line's edge), or to the line above or below.
   * Returns true if the key was used.
   */
  function extendAcrossLines(key) {
    const model = fieldModel();
    if (!model || composing) return false;
    let anchor;
    let focus;
    if (allSelected) {
      ({ anchor, focus } = span);
    } else {
      // Only from a line's edge (or vertically, at the top level) does a selection leave its line.
      const atTop = model.at(model.position)?.parent === model.root;
      const [start, end] = [...model.selection.ranges[0]].sort((a, b) => a - b);
      const index = lines.indexOf(mathfield);
      const leaves = (key === 'right' && end === mathfield.lastOffset && index < lines.length - 1) ||
        (key === 'left' && start === 0 && index > 0) ||
        (atTop && key === 'down' && index < lines.length - 1) || (atTop && key === 'up' && index > 0);
      if (!leaves) return false;
      const forward = key === 'right' || key === 'down';
      anchor = topLevelPosition(mathfield, !forward);
      focus = topLevelPosition(mathfield, forward);
    }
    const field = lines[focus.line];
    const fieldModel_ = fieldModel(field);
    let next = { ...focus };
    if (key === 'left' || key === 'right') {
      const atom = key === 'right' ? fieldModel_.at(focus.offset)?.rightSibling ?? null : fieldModel_.at(focus.offset);
      if (key === 'right' && atom) next.offset = fieldModel_.offsetOf(atom);
      else if (key === 'left' && atom && atom.type !== 'first') next.offset = atomRange(fieldModel_, atom)[0];
      else if (key === 'right' && focus.line < lines.length - 1) next = { line: focus.line + 1, offset: 0 };
      else if (key === 'left' && focus.line > 0) next = { line: focus.line - 1, offset: lines[focus.line - 1].lastOffset };
    } else {
      const target = focus.line + (key === 'down' ? 1 : -1);
      if (target >= 0 && target < lines.length) next = { line: target, offset: offsetAtX(lines[target], caretX(field, focus.offset)) };
    }
    if (next.line === anchor.line && next.offset === anchor.offset) {
      setAllSelected(false, null);
      focusAt(next.line, next.offset);
      return true;
    }
    setSpan(anchor, next);
    return true;
  }

  /** The LaTeX of the selection across lines. */
  function spanLatex() {
    const { from, to } = span;
    if (from.line === to.line) return lineLatex(lines[from.line], from.offset, to.offset);
    const middle = lines.slice(from.line + 1, to.line).map(field => lineLatex(field));
    return [lineLatex(lines[from.line], from.offset), ...middle, lineLatex(lines[to.line], 0, to.offset)].join(LINE_BREAK);
  }

  /**
   * Replaces the selection across lines with `latex` (which may hold several lines) and puts the
   * caret after it. A single line is replaced at once, so a key typed right after goes in after it.
   */
  function replaceSpan(latex = '') {
    if (!span) return;
    const { from, to } = span;
    const glue = (left, right) => (/\\[a-zA-Z]+$/.test(left) && /^[a-zA-Z]/.test(right) ? ' ' : '');
    const head = lineLatex(lines[from.line], 0, from.offset);
    const tail = lineLatex(lines[to.line], to.offset);
    const tailOffsets = lines[to.line].lastOffset - to.offset;
    const parts = latex ? splitLines(cleanLatex(latex)) : [''];
    parts[0] = head + glue(head, parts[0]) + parts[0];
    parts[parts.length - 1] += glue(parts.at(-1), tail) + tail;
    setAllSelected(false, null, false);
    if (parts.length === 1) {
      const field = lines[from.line];
      for (let index = to.line; index > from.line; index -= 1) removeLine(lines[index], field);
      field.setValue(parts[0], { silenceNotifications: true, format: 'latex' });
      restorePlaceholders(field);
      focusAt(from.line, field.lastOffset - tailOffsets);
      syncFromField();
      return;
    }
    const before = lines.slice(0, from.line).map(field => lineLatex(field));
    const after = lines.slice(to.line + 1).map(field => lineLatex(field));
    setDocumentLatex([...before, ...parts, ...after].join(LINE_BREAK)).then(() => {
      const line = from.line + parts.length - 1;
      focusAt(line, lines[line].lastOffset - tailOffsets);
      syncFromField();
    });
  }

  /** Replaces the whole document with one empty line. */
  function clearDocument() {
    if (!span) setAllSelected(true);
    if (span) replaceSpan('');
  }

  /** ⌘⌫: empties the line; an empty line is removed. */
  function deleteLine() {
    if (codeFocused()) {
      const { value, selectionStart } = codeArea;
      const start = value.lastIndexOf('\n', selectionStart - 1) + 1;
      if (start === selectionStart && start > 0) codeArea.setRangeText('', start - 1, start, 'end'); // Join with the line above.
      else codeArea.setRangeText('', start, selectionStart, 'end');
      codeArea.dispatchEvent(new Event('input'));
      return true;
    }
    if (!mathfield) return false;
    const index = lines.indexOf(mathfield);
    if (mathfield.lastOffset > 0) {
      setLineValue(index, '').then(field => { field.focus(); syncFromField(); });
    } else if (lines.length > 1) {
      const target = lines[index - 1] ?? lines[index + 1];
      removeLine(mathfield, target);
      target.focus();
      mathfield = target;
      target.position = index > 0 ? target.lastOffset : 0;
      syncFromField();
    }
    return true;
  }

  /** The LaTeX of the selection (the whole document after ⌘A), or null when nothing is selected. */
  function selectionLatex() {
    if (allSelected) return spanLatex();
    if (codeFocused()) {
      const { selectionStart, selectionEnd, value } = codeArea;
      return selectionStart === selectionEnd ? null : value.slice(selectionStart, selectionEnd);
    }
    const model = fieldModel();
    if (!model || model.selectionIsCollapsed || model.selectionIsPlaceholder) return null;
    const [start, end] = [...model.selection.ranges[0]].sort((a, b) => a - b);
    return withoutPlaceholders(portableLatex(mathfield.getValue(start, end, 'latex')));
  }

  function setGreekPending(active) {
    greekPending = active;
    $('greek-indicator').hidden = !active;
  }

  // ---------------------------------------------------------------- lines and fields

  function cleanLatex(latex) {
    const source = latex.trim();
    if (source.startsWith('$$') && source.endsWith('$$') && source.length >= 4) return source.slice(2, -2).trim();
    if (source.startsWith('$') && source.endsWith('$') && source.length >= 2) return source.slice(1, -1).trim();
    if ((source.startsWith('\\[') && source.endsWith('\\]')) ||
        (source.startsWith('\\(') && source.endsWith('\\)'))) return source.slice(2, -2).trim();
    return source;
  }

  /**
   * Splits a document into its lines. A newline inside braces or an environment (an `aligned`
   * block written over several lines, say) belongs to that line rather than starting a new one.
   */
  function splitLines(latex) {
    // Lines are separated by \\ on a line of its own, as classic editors write it, or (in older
    // documents) by \\ at the end of a line; the separator is not part of the line.
    const finish = line => line.replace(/\s*\\\\\s*$/, '');
    const result = [];
    let current = null;
    let depth = 0;
    let brokenAtEnd = false; // The previous line ended with \\ (the older style).
    for (const raw of latex.split('\n')) {
      if (current === null && raw.trim() === '\\\\' && result.length && !brokenAtEnd) {
        brokenAtEnd = true; // A separator line.
        continue;
      }
      current = current === null ? raw : `${current}\n${raw}`;
      // An escaped \% is text, not the start of a comment.
      const code = raw.replace(/\\\\/g, '').replace(/\\[{}%]/g, '').replace(/%.*$/, '');
      depth += (code.match(/\{/g) || []).length - (code.match(/\}/g) || []).length;
      depth += (code.match(/\\begin\{/g) || []).length - (code.match(/\\end\{/g) || []).length;
      if (depth <= 0) {
        brokenAtEnd = /\\\\\s*$/.test(current);
        result.push(finish(current));
        current = null;
        depth = 0;
      }
    }
    if (current !== null) result.push(finish(current));
    return result.length ? result : [''];
  }

  // Empty slots are drawn like a classic equation editor's: a borderless light-blue block.
  // The slot holding the caret is a deeper blue, without MathLive's selection rectangle around it.
  // Typed function names become their commands (sin → \sin), as in classic editors; nothing else is
  // converted (MathLive would also turn pi, dx, -> and others into symbols, and lim into a template).
  const FUNCTION_NAMES = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
    'sinh', 'cosh', 'tanh', 'coth', 'ln', 'lg', 'log', 'exp', 'lim', 'liminf', 'limsup', 'max', 'min', 'sup', 'inf',
    'det', 'dim', 'ker', 'deg', 'gcd', 'arg', 'hom', 'Pr']);
  const INLINE_SHORTCUTS = Object.fromEntries([...FUNCTION_NAMES].map(name => [name, `\\${name}`]));
  const ACCENTS = new Set(['hat', 'check', 'tilde', 'bar', 'vec', 'dot', 'ddot', 'dddot', 'acute', 'grave', 'breve',
    'mathring', 'widehat', 'widetilde', 'overline', 'underline', 'overrightarrow', 'overleftarrow',
    'overleftrightarrow', 'underrightarrow', 'underleftarrow']);
  const LINE_BREAK = '\n\\\\\n'; // Between the lines of the document, as classic editors write it.
  const SLOT = { width: 0.42, height: 0.69 }; // An empty slot's block, in em (see sizeSlots).
  const FIELD_CSS = `
    /* The block sits on the baseline at the size given to MathLive's layout (SLOT). */
    .vt-slot {
      display: inline-block; vertical-align: baseline; overflow: hidden; box-sizing: border-box;
      width: ${SLOT.width}em; height: ${SLOT.height}em;
      /* Drawn a little narrower than it lays out, so a fraction bar reaches past it. */
      color: transparent !important;
      background: linear-gradient(var(--vt-slot), var(--vt-slot)) center / 80% 100% no-repeat !important;
    }
    .ML__focused .vt-slot.vt-slot-active { background-image: linear-gradient(var(--vt-slot-active), var(--vt-slot-active)) !important; }
    .vt-slot-selected .ML__selection { display: none !important; }
    .vt-match { background: var(--bracket-match); border-radius: 2px; }
    /* A selection with scripts is drawn by us (see drawScriptSelection), MathLive's being too large. */
    .vt-own-selection .ML__selection { display: none !important; }
    .ML__content { position: relative; isolation: isolate; }
    .vt-selection { position: absolute; pointer-events: none; background: var(--selection-background-color); z-index: -1; }
    /* After ⌘A every line shows its selection, also the lines without focus. */
    .vt-all-selected .ML__selection { background: var(--selection-background-color) !important; }
    /* A caret inside the slot that has it, at the block's left edge. */
    .vt-slot-active { position: relative; }
    .ML__focused .vt-slot-active::after {
      content: ''; position: absolute; left: 14%; top: 8%; bottom: 8%; width: max(1.5px, .055em);
      background: var(--vt-caret); animation: vt-caret-blink 1.06s steps(1) infinite;
    }
    @keyframes vt-caret-blink { 50% { opacity: 0; } }
  `;

  /**
   * MathLive draws a selection as boxes around its elements' frames; consecutive scripts share one
   * frame, so a selected a_{}^{} followed by more scripts looked as wide and tall as all of them.
   * When a selection holds scripts, each selected element is drawn instead as the union of the
   * glyphs and slots it is made of.
   */
  function drawScriptSelection(field) {
    const container = field.shadowRoot?.querySelector('.ML__container');
    const content = field.shadowRoot?.querySelector('.ML__content');
    if (!container || !content) return;
    for (const old of content.querySelectorAll('.vt-selection')) old.remove();
    const model = fieldModel(field);
    const shown = model && !model.selectionIsCollapsed && !model.selectionIsPlaceholder &&
      (field.hasFocus() || container.classList.contains('vt-all-selected'));
    const [start, end] = shown ? [...model.selection.ranges[0]].sort((a, b) => a - b) : [0, 0];
    const first = shown ? model.at(start + 1) : null;
    const last = shown ? model.at(end) : null;
    const selected = [];
    if (first && last && first.parent === last.parent) {
      for (let atom = first; atom; atom = atom.rightSibling) {
        selected.push(atom);
        if (atom === last) break;
      }
    }
    const own = selected.some(isScripts);
    if (container.classList.contains('vt-own-selection') !== own) container.classList.toggle('vt-own-selection', own);
    if (!own) return;
    const origin = content.getBoundingClientRect();
    for (const atom of selected) {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const part of [atom, ...(atom.children ?? [])]) {
        if (part.type === 'first' || !part.id) continue;
        for (const element of content.querySelectorAll(`[data-atom-id="${part.id}"]`)) {
          const box = element.getBoundingClientRect();
          if (!box.width || !box.height) continue;
          left = Math.min(left, box.left); top = Math.min(top, box.top);
          right = Math.max(right, box.right); bottom = Math.max(bottom, box.bottom);
        }
      }
      if (left === Infinity) continue;
      const mark = document.createElement('span');
      mark.className = 'vt-selection';
      mark.style.cssText = `left:${left - origin.left}px;top:${top - origin.top}px;width:${right - left}px;height:${bottom - top}px`;
      content.append(mark);
    }
  }

  /** Marks MathLive's placeholder glyphs (▢) so the stylesheet above can repaint them. */
  function tagSlots(field) {
    // "Active" only when the selection is exactly one slot, not a larger selection containing slots.
    const slotSelected = !!fieldModel(field)?.selectionIsPlaceholder;
    // A class rather than :has(), which WebKit does not re-evaluate inside MathLive's shadow root.
    field.shadowRoot.querySelector('.ML__container')?.classList.toggle('vt-slot-selected', slotSelected);
    for (const element of field.shadowRoot.querySelectorAll('.ML__content span')) {
      const isSlot = element.childElementCount === 0 && element.textContent === '▢';
      element.classList.toggle('vt-slot', isSlot);
      element.classList.toggle('vt-slot-active', isSlot && slotSelected && element.classList.contains('ML__selected'));
    }
  }

  async function createField({ scratch = false, before = null } = {}) {
    const field = new MathfieldElement();
    field.setAttribute('math-virtual-keyboard-policy', 'manual');
    field.setAttribute('smart-fence', 'on');
    if (scratch) {
      field.setAttribute('aria-hidden', 'true');
      field.tabIndex = -1;
      field.style.cssText = 'position:fixed;left:-10000px;top:0;width:400px;';
    } else {
      field.setAttribute('aria-label', 'Equation line');
      field.addEventListener('input', syncFromField);
      field.addEventListener('selection-change', () => {
        // While a selection spans lines, MathLive may still move the selection of the line it captured
        // the drag in (above the line, its hit test can fall back on the anchor and collapse it):
        // the spanning selection is shown again once MathLive is done.
        requestAnimationFrame(updateMatches); // Brackets beside the caret.
        if (allSelected) { requestAnimationFrame(() => { if (allSelected) paintSpan(); }); return; }
        if (composing?.mode === 'math' || field !== mathfield || restoringPlaceholders) return;
        if (restorePlaceholders()) syncFromField();
        selectAdjacentPlaceholder();
        selectWholeAtoms();
      });
      field.addEventListener('focusin', () => { mathfield = field; });
    }
    const mounted = new Promise(resolve => field.addEventListener('mount', resolve, { once: true }));
    (scratch ? document.body : fieldHost).insertBefore(field, scratch ? null : before);
    await mounted;
    field.menuItems = [];
    field.mathModeSpace = '\\,\\,'; // Space, as classic editors write it.
    field.inlineShortcuts = INLINE_SHORTCUTS;
    field.letterShapeStyle = 'tex';
    if (!scratch) {
      const style = document.createElement('style');
      style.textContent = FIELD_CSS;
      field.shadowRoot.append(style);
      new MutationObserver(records => {
        tagSlots(field);
        markFences(field);
        // Not again for our own selection boxes (they are added to the content).
        if (records.some(record => ![...record.addedNodes, ...record.removedNodes].every(node => node.classList?.contains('vt-selection')) ||
            (record.type === 'attributes' && !record.target.classList?.contains('vt-selection')))) {
          drawScriptSelection(field);
        }
      })
        .observe(field.shadowRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      styleField(field);
    }
    return field;
  }

  async function insertLine(index) {
    const field = await createField({ before: lines[index] ?? null });
    lines.splice(index, 0, field);
    return field;
  }

  /** Removes a line. If it has focus, `next` takes it first: MathLive fails to blur a detached field. */
  function removeLine(field, next) {
    if (field.hasFocus() && next) next.focus();
    lines.splice(lines.indexOf(field), 1);
    if (mathfield === field) mathfield = next ?? lines[0] ?? null;
    field.remove();
  }

  /**
   * Replaces one line's contents. MathLive 0.109 can keep invisible empty-group atoms across
   * setValue() after some insertions; when the result differs from a clean field's, the line's
   * element is rebuilt.
   */
  async function setLineValue(index, latex) {
    const field = lines[index];
    const options = { silenceNotifications: true, format: 'latex', mode: 'math' };
    field.mode = 'math'; // Leave text mode, e.g. after inserting \text{}.
    field.setValue(latex, options);
    scratchField.setValue(latex, options);
    if (field.getValue('latex') === scratchField.getValue('latex')) return field;
    const hadFocus = field.hasFocus();
    field.style.display = 'none';
    const fresh = await createField({ before: field });
    fresh.setValue(latex, options);
    lines[index] = fresh;
    if (mathfield === field) mathfield = fresh;
    if (hadFocus) fresh.focus(); // Focus moves before the old element is removed.
    field.remove();
    return fresh;
  }

  /** Shows `latex` (lines separated by newlines) in the editor. */
  async function setDocumentLatex(latex) {
    if (composing?.mode === 'math') closeComposition({ keepPreedit: true }); // The content is replaced anyway.
    setAllSelected(false);
    const parts = splitLines(cleanLatex(latex));
    loading = true;
    try {
      while (lines.length < parts.length) await insertLine(lines.length);
      while (lines.length > parts.length) removeLine(lines.at(-1), lines.at(-2));
      for (let index = 0; index < parts.length; index += 1) {
        const field = await setLineValue(index, parts[index]);
        restorePlaceholders(field); // Empty slots ({}) in the loaded LaTeX get their boxes.
      }
    } finally {
      loading = false;
    }
    if (!lines.includes(mathfield)) mathfield = lines[0];
  }

  /** The document as LaTeX: one line per equation line, with \\ on a line of its own between them. */
  function documentLatex() {
    return lines.map(field => withoutPlaceholders(portableLatex(field.getValue('latex')))).join(LINE_BREAK);
  }

  /** Empty slots are an editing aid; in LaTeX they are empty groups, as classic editors write them. */
  function withoutPlaceholders(latex) {
    return latex
      .replace(/\{\\placeholder\{\}\}/g, '{}')
      // Between \left, \middle and \right an empty slot is simply empty.
      .replace(/\\placeholder\{\}(?=\s*\\(?:right|middle)(?![a-zA-Z]))/g, '')
      .replace(/\\placeholder\{\}/g, '{}');
  }

  /** Rewrites MathLive output that standard LaTeX (and MathJax) rejects, e.g. `\middle{|}` or `\bm`. */
  function portableLatex(latex) {
    return latex
      .replace(/\\bm(?![a-zA-Z])/g, '\\boldsymbol')
      // MathLive's own commands for d, e, i and j.
      .replace(/\\differentialD(?![a-zA-Z])/g, '\\mathrm{d}').replace(/\\capitalDifferentialD(?![a-zA-Z])/g, '\\mathrm{D}')
      .replace(/\\exponentialE(?![a-zA-Z])/g, '\\mathrm{e}').replace(/\\imaginaryI(?![a-zA-Z])/g, '\\mathrm{i}')
      .replace(/\\imaginaryJ(?![a-zA-Z])/g, '\\mathrm{j}')
      .replace(/\\doubleprime(?![a-zA-Z])/g, '\\prime\\prime')
      .replace(/\\middle\{(\\[a-zA-Z]+|\\?[^{}\s])\}/g,
        (_, delimiter) => `\\middle${delimiter}${/^\\[a-zA-Z]+$/.test(delimiter) ? ' ' : ''}`);
  }

  // ---------------------------------------------------------------- structural editing
  //
  // Classic equation-editor behavior on top of MathLive: empty slots keep their placeholder,
  // Backspace in an empty slot selects its structure (a second Backspace deletes it), Tab walks the
  // slots, the arrow keys move between slots and lines, and Return starts a new line. These use
  // MathLive's internal model (the bundled version is pinned); each degrades to MathLive's default.

  const SCRIPT_BRANCHES = ['superscript', 'subscript'];
  const LARGE_OPERATORS = new Set(['extensible-symbol', 'mop', 'operator']);
  let restoringPlaceholders = false;
  let PlaceholderAtom = null;

  function fieldModel(field = mathfield) {
    const model = field?._mathfield?.model;
    return model && typeof model.offsetOf === 'function' && model.root ? model : null;
  }

  function placeholderClass() {
    if (!PlaceholderAtom && scratchField) {
      scratchField.setValue('\\placeholder{}', { silenceNotifications: true });
      PlaceholderAtom = scratchField._mathfield?.model?.root?.body?.find(atom => atom.type === 'placeholder')?.constructor ?? null;
      if (PlaceholderAtom) sizeSlots(PlaceholderAtom);
    }
    return PlaceholderAtom;
  }

  /**
   * MathLive lays out an empty slot with the fallback metrics of its ▢ glyph: 0.8em wide and 0.2em
   * below the baseline, which makes empty structures wider and taller than filled ones (the
   * expression jumps when the first character goes in). Slots get the size of a classic editor's:
   * a narrow block on the baseline, as tall as a letter with an ascender.
   */
  function sizeSlots(Placeholder) {
    const render = Placeholder.prototype.render;
    Placeholder.prototype.render = function (context) {
      const box = render.call(this, context);
      box.height = SLOT.height;
      box.depth = 0;
      box.width = SLOT.width;
      return box;
    };
  }

  const sameBranch = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const branchAtoms = (atom, branch) => { try { return atom.branch(branch) ?? []; } catch (_) { return []; } };
  const isMiddle = atom => atom?.type === 'delim' && atom.command === '\\middle';
  const isSlotEmpty = (atom, branch) => branchAtoms(atom, branch)
    .every(child => child.type === 'first' || child.type === 'placeholder' || isMiddle(child));

  /**
   * In \left…\middle…\right each \middle separates two slots of one branch. Returns the atoms of
   * the slot holding `atom` (where `atom` is the atom before the caret: \middle or the branch start
   * begins a slot) and the boundary atom before it.
   */
  function segmentAt(atom) {
    const siblings = branchAtoms(atom.parent, atom.parentBranch);
    let index = siblings.indexOf(atom);
    while (index > 0 && !isMiddle(siblings[index]) && siblings[index].type !== 'first') index -= 1;
    const boundary = siblings[index];
    const atoms = [];
    for (let next = index + 1; next < siblings.length && !isMiddle(siblings[next]); next += 1) atoms.push(siblings[next]);
    return { boundary, atoms };
  }

  const hasMiddle = atom => atom?.type === 'leftright' && branchAtoms(atom, 'body').some(isMiddle);
  const hasNoAtoms = (atom, branch) => branchAtoms(atom, branch).every(child => child.type === 'first');

  /** The atom at the caret, or the selected placeholder. */
  function caretAtom(model) {
    const [start, end] = model.selection.ranges[0];
    return model.selectionIsPlaceholder ? model.at(Math.max(start, end)) : model.at(model.position);
  }

  /**
   * Puts a placeholder into every empty slot of `field` (an empty `{}` group counts as a slot,
   * except the base of a prescript). The caret keeps its place; in an empty slot it selects the
   * new placeholder. Returns true if anything changed.
   */
  /**
   * The operand of ∑ or ∫ (MathLive's extensible symbols) is a braced group, as in classic editors (\sum_{}^{}{}), so it keeps its
   * extent once filled. MathLive reduces a group holding only a placeholder to the bare placeholder;
   * this puts such an operand back into a group. Returns true if anything changed.
   */
  function groupOperands(field = mathfield) {
    const model = fieldModel(field);
    const Placeholder = placeholderClass();
    if (!model || !Placeholder || restoringPlaceholders) return false;
    const bare = model.atoms.filter(atom => atom.type === 'placeholder' && atom.leftSibling?.type === 'extensible-symbol');
    if (!bare.length) return false;
    const [start, end] = model.selection.ranges[0];
    const selected = field === mathfield && model.selectionIsPlaceholder ? model.at(Math.max(start, end)) : null;
    let select = null;
    for (const placeholder of bare) {
      scratchField.setValue('{x}', { silenceNotifications: true });
      const scratch = fieldModel(scratchField);
      const group = scratch?.root.body.find(atom => atom.type === 'group');
      if (!group) return false;
      scratch.root.removeChild(group);
      const content = group.body.find(atom => atom.type !== 'first');
      const inner = new Placeholder();
      group.addChildAfter(inner, content);
      group.removeChild(content);
      placeholder.parent.addChildAfter(group, placeholder);
      placeholder.parent.removeChild(placeholder);
      if (placeholder === selected) select = inner;
    }
    restoringPlaceholders = true;
    try {
      model.contentDidChange({ inputType: 'insertText' });
      if (select) selectPlaceholderAt(model.offsetOf(select));
    } finally {
      restoringPlaceholders = false;
    }
    return true;
  }

  /**
   * {a_{1}^{2}}_{3}: a group holding a scripted base, followed by scripts. As in classic editors the
   * row is flat — a, its scripts, the next scripts — so the group's contents take its place.
   */
  function flattenScriptGroups(field) {
    const model = fieldModel(field);
    const groups = model.atoms.filter(atom => atom.type === 'group' && isScripts(atom.rightSibling) &&
      isScripts(branchAtoms(atom, 'body').at(-1)) && !(atom.branches ?? []).some(branch => SCRIPT_BRANCHES.includes(branch)));
    if (!groups.length) return false;
    for (const group of groups) {
      let previous = group;
      for (const child of branchAtoms(group, 'body').filter(atom => atom.type !== 'first')) {
        group.removeChild(child);
        group.parent.addChildAfter(child, previous);
        previous = child;
      }
      group.parent.removeChild(group);
    }
    restoringPlaceholders = true;
    try {
      model.contentDidChange({ inputType: 'insertText' });
    } finally {
      restoringPlaceholders = false;
    }
    return true;
  }

  function restorePlaceholders(field = mathfield) {
    const model = fieldModel(field);
    const Placeholder = placeholderClass();
    if (!model || !Placeholder || restoringPlaceholders) return false;
    const grouped = flattenScriptGroups(field) | groupOperands(field);
    const collapsed = model.selectionIsCollapsed;
    if (field === mathfield && !collapsed) return grouped;
    const anchor = model.at(model.position);
    let anchorPlaceholder = null;
    let changed = false;
    for (const atom of model.atoms) {
      if (atom.isRoot || atom.mode === 'text' || !atom.branches?.length) continue;
      const prescriptBase = atom.type === 'group' && atom.branches.some(branch => SCRIPT_BRANCHES.includes(branch));
      if (hasMiddle(atom)) {
        // Each slot between \middle separators gets its own placeholder.
        const boundaries = branchAtoms(atom, 'body').filter(child => child.type === 'first' || isMiddle(child));
        for (const boundary of boundaries) {
          if (segmentAt(boundary).atoms.length) continue;
          const placeholder = new Placeholder();
          atom.addChildAfter(placeholder, boundary);
          changed = true;
          if (anchor === boundary) anchorPlaceholder = placeholder;
        }
        continue;
      }
      for (const branch of atom.branches) {
        if (prescriptBase && branch === 'body') continue;
        if (!hasNoAtoms(atom, branch)) continue;
        const placeholder = new Placeholder();
        atom.addChild(placeholder, branch);
        changed = true;
        if (anchor?.type === 'first' && anchor.parent === atom && sameBranch(anchor.parentBranch, branch)) {
          anchorPlaceholder = placeholder;
        }
      }
    }
    if (!changed) return grouped;
    restoringPlaceholders = true;
    try {
      model.contentDidChange({ inputType: 'insertText' });
      if (field === mathfield) {
        if (anchorPlaceholder) selectPlaceholderAt(model.offsetOf(anchorPlaceholder));
        else mathfield.position = model.offsetOf(anchor);
      }
    } finally {
      restoringPlaceholders = false;
    }
    return true;
  }

  /**
   * A selection is made of whole elements of one row, as in classic editors: when its ends lie at
   * different depths (dragged from a letter into a script, say), both ends widen to the elements of
   * the row that contains them both.
   */
  function selectWholeAtoms() {
    const model = fieldModel();
    if (!model || model.selectionIsCollapsed || model.selectionIsPlaceholder) return;
    const [start, end] = [...model.selection.ranges[0]].sort((a, b) => a - b);
    const first = model.at(start + 1);
    const last = model.at(end);
    if (!first || !last || (first.parent === last.parent && sameBranch(first.parentBranch, last.parentBranch))) return;
    const ancestors = atom => { const chain = []; for (let node = atom; node; node = node.parent) chain.push(node); return chain; };
    const lastChain = ancestors(last);
    // The innermost row holding both: climb from the first end until a node is also above the last end.
    let row = null;
    let rowBranch = null;
    for (let node = first; node?.parent; node = node.parent) {
      if (lastChain.includes(node.parent)) {
        const sibling = lastChain.find(other => other.parent === node.parent);
        if (sibling && sameBranch(sibling.parentBranch, node.parentBranch)) { row = node.parent; rowBranch = node.parentBranch; break; }
      }
    }
    if (!row) return;
    const inRow = atom => ancestors(atom).find(node => node.parent === row && sameBranch(node.parentBranch, rowBranch));
    const from = inRow(first);
    const to = inRow(last);
    if (!from || !to) return;
    const range = [atomRange(model, from)[0], model.offsetOf(to)];
    if (range[0] !== start || range[1] !== end) mathfield.selection = { ranges: [range] };
  }

  /** A caret just before or after an empty slot's placeholder selects it (the slot is one unit). */
  function selectAdjacentPlaceholder() {
    const model = fieldModel();
    if (!model?.selectionIsCollapsed) return;
    const here = model.at(model.position);
    if (here?.type === 'placeholder') selectPlaceholderAt(model.position);
    else if (here?.rightSibling?.type === 'placeholder') selectPlaceholderAt(model.offsetOf(here.rightSibling));
  }

  function selectPlaceholderAt(offset) {
    mathfield.selection = { ranges: [[offset - 1, offset]] };
  }

  /** Moves to `offset`, selecting an adjacent placeholder so typing replaces it. */
  function moveCaretTo(offset) {
    const model = fieldModel();
    const next = model.at(offset + 1);
    if (model.at(offset)?.type === 'placeholder') selectPlaceholderAt(offset);
    else if (next?.type === 'placeholder' && next.parent === model.at(offset)?.parent) selectPlaceholderAt(offset + 1);
    else mathfield.position = offset;
  }

  /** The slots of a structure in navigation order: an operator's lower limit comes before its upper one. */
  function slotOrder(atom) {
    const branches = atom?.branches ?? [];
    // Scripts: → enters the subscript, ← the superscript (the first and last slot here).
    if (isScripts(atom)) return ['subscript', 'superscript'].filter(branch => branches.includes(branch));
    if (!LARGE_OPERATORS.has(atom.type)) return branches;
    const rank = branch => ({ subscript: 0, superscript: 1 })[branch] ?? 2;
    return [...branches].sort((a, b) => rank(a) - rank(b));
  }

  const isStructure = atom => !!atom && atom.type !== 'first' && (atom.branches?.length ?? 0) > 0;
  /** Scripts that MathLive keeps as their own atom after the base (x then ^{2}). */
  const isScripts = atom => atom?.type === 'subsup';

  /** Deletes the structure `atom` (scripts only: the base stays), leaving the caret where it was. */
  function deleteStructure(model, atom) {
    const base = isScripts(atom) ? atom.leftSibling : null;
    mathfield.selection = { ranges: [atomRange(model, atom)] };
    mathfield.executeCommand('deleteBackward');
    // A base grouped for these scripts ({a^{1}}_{2}) needs its braces no more.
    const after = fieldModel();
    const group = base?.type === 'group' && after.at(after.position);
    if (group === base && !isScripts(group.rightSibling) && branchAtoms(group, 'body').some(child => child.type !== 'first')) {
      const range = atomRange(after, group);
      const inner = mathfield.getValue(range[0], range[1], 'latex').replace(/^\{([^]*)\}$/, '$1');
      mathfield.selection = { ranges: [range] };
      mathfield.insert(inner, { format: 'latex', insertionMode: 'replaceSelection', selectionMode: 'after', feedback: false });
    }
    syncFromField();
  }
  const hasOwnSlots = atom => (atom.branches ?? []).some(branch => !SCRIPT_BRANCHES.includes(branch));

  /** An operator's empty operand (the □ after ∑ or ∫) belongs to it. */
  /**
   * The operand of ∑ or ∫ belongs to it: as in classic editors it is a braced group, \sum_{}^{}{}
   * (or, in older documents, an empty slot right after the operator).
   */
  function operandOf(atom) {
    const next = atom?.rightSibling;
    if (next?.type === 'placeholder') return LARGE_OPERATORS.has(atom?.type) ? next : null;
    return next?.type === 'group' && atom?.type === 'extensible-symbol' ? next : null; // ∑, ∫ (not \lim, \sin).
  }

  /** The operator whose braced operand `group` is, if it is one. */
  const operatorOf = group => (group?.type === 'group' && operandOf(group.leftSibling) === group ? group.leftSibling : null);

  function atomRange(model, atom) {
    return [model.offsetOf(atom) - (atom.children?.length ?? 0) - 1, model.offsetOf(operandOf(atom) ?? atom)];
  }

  let pendingDelete = null; // The structure a first Backspace selected; a second one deletes it.

  /** Selects a structure so that the next Backspace deletes it (scripts: both, the base stays). */
  function selectForDeletion(model, atom) {
    const range = atomRange(model, atom);
    mathfield.selection = { ranges: [range] };
    pendingDelete = { field: mathfield, atom, start: range[0], end: range[1] };
    return true;
  }

  /**
   * Backspace as in classic equation editors: in an empty slot, or at the start of a filled one, it
   * selects the slot's structure (a second Backspace deletes it); right after a structure it deletes
   * the whole structure at once, and after scripts only the scripts, keeping their base.
   */
  function backspace() {
    const model = fieldModel();
    if (!model) return false;
    const [start, end] = [...model.selection.ranges[0]].sort((a, b) => a - b);
    if (pendingDelete?.field === mathfield && pendingDelete.start === start && pendingDelete.end === end) {
      const { atom } = pendingDelete;
      pendingDelete = null;
      deleteStructure(model, atom);
      return true;
    }
    pendingDelete = null;
    if (!model.selectionIsPlaceholder && !model.selectionIsCollapsed) return false;
    const atom = caretAtom(model);

    // In an operator's empty operand (the □ after ∑): the operator and operand go together.
    if (model.selectionIsPlaceholder && atom?.parent?.isRoot && LARGE_OPERATORS.has(atom.leftSibling?.type)) {
      return selectForDeletion(model, atom.leftSibling);
    }

    // In a bracket with \middle: an empty slot selects the whole bracket; at the start of a filled
    // slot the separator is kept and the caret moves to the end of the slot before it.
    if (atom && hasMiddle(atom.parent)) {
      if (segmentAt(atom).atoms.every(child => child.type === 'placeholder')) return selectForDeletion(model, atom.parent);
      if (model.selectionIsCollapsed && isMiddle(atom)) {
        moveCaretTo(model.offsetOf(atom.leftSibling));
        return true;
      }
    }

    // At the start of a filled slot: select the structure (a second Backspace deletes it).
    if (model.selectionIsCollapsed && atom?.type === 'first' && atom.parent && !atom.parent.isRoot &&
        !isSlotEmpty(atom.parent, atom.parentBranch)) {
      return selectForDeletion(model, operatorOf(atom.parent) ?? atom.parent);
    }

    // In an empty slot.
    if (atom && ['first', 'placeholder'].includes(atom.type) && atom.parent && !atom.parent.isRoot &&
        isSlotEmpty(atom.parent, atom.parentBranch)) {
      return selectForDeletion(model, operatorOf(atom.parent) ?? atom.parent);
    }

    // Right after a structure (or after an operator's empty operand).
    if (!model.selectionIsCollapsed) return false;
    let before = model.at(model.position);
    // A typed space (\,\,) goes as one.
    if (before?.command === '\\,' && before.leftSibling?.command === '\\,') {
      mathfield.selection = { ranges: [[model.position - 2, model.position]] };
      mathfield.executeCommand('deleteBackward');
      syncFromField();
      return true;
    }
    if (before?.type === 'placeholder' && LARGE_OPERATORS.has(before.leftSibling?.type)) before = before.leftSibling;
    before = operatorOf(before) ?? before;
    if (!isStructure(before)) return false;
    if (ACCENTS.has(before.command?.slice(1))) {
      // An accent goes and what it was on stays (\hat{V} → V), as in classic editors.
      const body = branchAtoms(before, 'body');
      const inner = body.length > 1 ? mathfield.getValue(model.offsetOf(body[0]), model.offsetOf(body.at(-1)), 'latex') : '';
      mathfield.selection = { ranges: [atomRange(model, before)] };
      mathfield.insert(inner, { format: 'latex', insertionMode: 'replaceSelection', selectionMode: 'after', feedback: false });
      syncFromField();
      return true;
    }
    if (!isScripts(before) && !hasOwnSlots(before) && !LARGE_OPERATORS.has(before.type)) {
      // A symbol carrying its scripts itself: step into the last script.
      const last = slotOrder(before).at(-1);
      moveCaretTo(model.offsetOf(branchAtoms(before, last).at(-1)));
      return true;
    }
    // A structure is deleted as one unit, contents and all; scripts go and their base stays.
    deleteStructure(model, before);
    return true;
  }

  /**
   * ← / →: move by one step in slot order. A selected placeholder is a caret inside its empty slot;
   * moving onto an empty slot selects its placeholder so typing replaces it; at the end of a line
   * the caret continues on the next line.
   */
  function moveHorizontally(direction) {
    const model = fieldModel();
    if (!model) return false;
    const [start, end] = [...model.selection.ranges[0]].sort((a, b) => a - b);
    if (!model.selectionIsCollapsed && !model.selectionIsPlaceholder) {
      mathfield.position = direction > 0 ? end : start;
      return true;
    }
    const position = model.selectionIsPlaceholder ? (direction > 0 ? end : start) : model.position;
    const here = model.at(position);
    const lineIndex = lines.indexOf(mathfield);
    const enterSlot = (owner, branch, atEnd) => {
      const atoms = branchAtoms(owner, branch);
      moveCaretTo(model.offsetOf(atEnd ? atoms.at(-1) : atoms[0]));
    };
    if (direction > 0) {
      const next = here.rightSibling;
      if (isMiddle(next)) { mathfield.position = model.offsetOf(here.parent); return true; } // Out of the bracket.
      if (next) {
        if (next.type === 'placeholder') selectPlaceholderAt(model.offsetOf(next));
        else if (isStructure(next)) enterSlot(next, slotOrder(next)[0], false);
        else mathfield.position = model.offsetOf(next);
        return true;
      }
      const owner = here.parent;
      if (!owner || owner.isRoot) return moveToLine(lineIndex + 1, 0, 'start') || true;
      const order = slotOrder(owner);
      // Leaving either script → (or ←) leaves the scripts, as in classic editors (↓ / ↑ go between them).
      const following = isScripts(owner) ? undefined : order[order.findIndex(branch => sameBranch(branch, here.parentBranch)) + 1];
      if (following !== undefined) enterSlot(owner, following, false);
      else if (operandOf(owner)?.type === 'group') enterSlot(operandOf(owner), 'body', false); // From the limits into the operand.
      else if (operandOf(owner)) selectPlaceholderAt(model.offsetOf(operandOf(owner)));
      else mathfield.position = model.offsetOf(owner);
      return true;
    }
    if (isMiddle(here)) { mathfield.position = model.offsetOf(here.parent.leftSibling); return true; } // Out of the bracket.
    if (here.type !== 'first') {
      if (here.type === 'placeholder') selectPlaceholderAt(model.offsetOf(here));
      else if (isStructure(here)) enterSlot(here, slotOrder(here).at(-1), true);
      else mathfield.position = model.offsetOf(here.leftSibling);
      return true;
    }
    const owner = here.parent;
    if (!owner || owner.isRoot) return moveToLine(lineIndex - 1, 0, 'end') || true;
    const order = slotOrder(owner);
    const preceding = isScripts(owner) ? undefined : order[order.findIndex(branch => sameBranch(branch, here.parentBranch)) - 1];
    if (preceding !== undefined) enterSlot(owner, preceding, true);
    else if (operatorOf(owner)) enterSlot(operatorOf(owner), slotOrder(operatorOf(owner)).at(-1), true); // Operand → upper limit.
    else mathfield.position = model.offsetOf(owner.leftSibling);
    return true;
  }

  /** Tab / Shift-Tab: the next or previous slot of the current structure, then out of it. */
  function moveToSlot(direction) {
    const model = fieldModel();
    if (!model) return false;
    const atom = caretAtom(model);
    const owner = atom?.parent;
    if (!owner || owner.isRoot) {
      mathfield.executeCommand(direction > 0 ? 'moveToNextPlaceholder' : 'moveToPreviousPlaceholder');
      return true;
    }
    if (hasMiddle(owner)) {
      const boundaries = branchAtoms(owner, 'body').filter(child => child.type === 'first' || isMiddle(child));
      const current = boundaries.indexOf(segmentAt(atom).boundary);
      const targetBoundary = boundaries[current + direction];
      if (targetBoundary) {
        const { atoms } = segmentAt(targetBoundary);
        moveCaretTo(model.offsetOf(atoms.at(-1) ?? targetBoundary));
      } else {
        mathfield.position = direction > 0 ? model.offsetOf(owner) : model.offsetOf(owner.leftSibling);
      }
      return true;
    }
    const order = slotOrder(owner);
    const target = order[order.findIndex(branch => sameBranch(branch, atom.parentBranch)) + direction];
    const operand = operandOf(owner)?.type === 'group' ? operandOf(owner) : null;
    const operator = operatorOf(owner);
    if (target !== undefined) {
      moveCaretTo(model.offsetOf(branchAtoms(owner, target).at(-1)));
    } else if (direction > 0 && operand) {
      moveCaretTo(model.offsetOf(branchAtoms(operand, 'body').at(-1))); // Limits → operand.
    } else if (direction < 0 && operator) {
      moveCaretTo(model.offsetOf(branchAtoms(operator, slotOrder(operator).at(-1)).at(-1))); // Operand → upper limit.
    } else {
      const outer = operator ?? owner;
      mathfield.position = direction > 0 ? model.offsetOf(owner) : model.offsetOf(outer.leftSibling);
    }
    return true;
  }

  function caretPoint(model, offset) {
    const atom = model.at(offset);
    const element = atom && mathfield._mathfield.getHTMLElement?.(atom);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { x: atom.type === 'first' ? box.left : box.right, y: box.top + box.height / 2 };
  }

  /** Moves the caret to the nearest position above (direction -1) or below (+1), or to the next line. */
  function moveVertically(direction) {
    const model = fieldModel();
    if (!model || (!model.selectionIsCollapsed && !model.selectionIsPlaceholder)) return false;
    const origin = caretPoint(model, model.position);
    if (!origin) return false;
    // Rows that enclose the caret (e.g. the line around a fraction, seen from its numerator) are
    // considered only when no slot lies in that direction, so ↓ in a numerator reaches the denominator.
    const here = model.at(model.position);
    const enclosing = new Set();
    for (let atom = here.parent?.parent; atom; atom = atom.parent) enclosing.add(atom);
    // Inside the structures of the caret's own row (the √ just left of it, say) a position counts
    // as above or below only if it is clearly so, not just a little off-centre.
    const inOwnRow = atom => {
      for (let node = atom.parent; node; node = node.parent) {
        if (node.parent === here.parent && sameBranch(node.parentBranch, here.parentBranch)) return true;
      }
      return false;
    };
    const clearly = 0.35 * parseFloat(getComputedStyle(mathfield).fontSize);
    const candidates = [];
    for (let offset = 0; offset <= model.lastOffset; offset += 1) {
      const atom = model.at(offset);
      // Positions in the caret's own row are never above or below it, even next to a tall ∫ or Σ.
      if (atom.parent === here.parent && sameBranch(atom.parentBranch, here.parentBranch)) continue;
      const point = caretPoint(model, offset);
      if (!point) continue;
      const distance = (point.y - origin.y) * direction;
      if (distance < (inOwnRow(atom) ? clearly : 4)) continue;
      // Prefer positions straight above or below: horizontal distance counts double.
      const score = distance + 2 * Math.abs(point.x - origin.x);
      candidates.push({ offset, score, outer: enclosing.has(atom.parent) });
    }
    const inner = candidates.filter(candidate => !candidate.outer);
    const pool = inner.length ? inner : candidates;
    const best = pool.reduce((a, b) => (a && a.score <= b.score ? a : b), null);
    if (best) {
      moveCaretTo(best.offset);
      return true;
    }
    return moveToLine(lines.indexOf(mathfield) + direction, origin.x);
  }

  /** Focuses another line, placing the caret nearest to `x` (or at its start / end). */
  function moveToLine(index, x, edge = null) {
    const target = lines[index];
    if (!target) return false;
    target.focus();
    mathfield = target;
    if (edge === 'start') target.position = 0;
    else if (edge === 'end') target.position = target.lastOffset;
    else {
      const box = target.getBoundingClientRect();
      moveCaretTo(target.getOffsetFromPoint(x, box.top + box.height / 2));
    }
    return true;
  }

  /** Return: splits the line at the caret (or opens a new line below when inside a structure). */
  async function splitLine() {
    const model = fieldModel();
    if (!model) return false;
    const index = lines.indexOf(mathfield);
    const position = model.position;
    const atTopLevel = model.selectionIsCollapsed && (position === 0 || model.at(position).parent === model.root);
    let tail = '';
    if (atTopLevel) {
      tail = mathfield.getValue(position, mathfield.lastOffset, 'latex');
      await setLineValue(index, mathfield.getValue(0, position, 'latex'));
    }
    const field = await insertLine(index + 1);
    field.setValue(tail, { silenceNotifications: true, format: 'latex' });
    field.focus();
    mathfield = field;
    field.position = 0;
    syncFromField();
    return true;
  }

  /** Joins line `lower` onto the end of line `upper`, keeping the caret at the seam. */
  async function mergeLines(upper, lower) {
    const top = lines[upper];
    const bottom = lines[lower];
    if (!top || !bottom) return false;
    const seam = top.lastOffset;
    const head = top.getValue('latex');
    const tail = bottom.getValue('latex');
    const glue = /\\[a-zA-Z]+$/.test(head) && /^[a-zA-Z]/.test(tail) ? ' ' : '';
    top.focus();
    mathfield = top;
    const merged = await setLineValue(upper, head + glue + tail);
    merged.focus();
    merged.position = seam;
    removeLine(bottom, merged);
    syncFromField();
    return true;
  }

  /**
   * ↩ inside a slot, as in classic editors: a script, a limit, a root or a bracket becomes an array
   * whose next row gets the caret (in an array, another row is added); a fraction's or an
   * operand's slot takes no new row. Returns true (the key is used either way).
   */
  function slotRows(model) {
    const atom = caretAtom(model);
    let owner = atom.parent;
    if (owner.type === 'array') {
      mathfield.executeCommand('addRowAfter');
      syncFromField();
      return true;
    }
    const branch = atom.parentBranch;
    const eligible = SCRIPT_BRANCHES.includes(branch) || owner.type === 'surd' || owner.type === 'leftright';
    if (!eligible || (owner.type === 'surd' && branch !== 'body')) return true;
    const slot = owner.type === 'leftright' ? segmentAt(atom) : { boundary: branchAtoms(owner, branch)[0], atoms: branchAtoms(owner, branch).slice(1) };
    const start = model.offsetOf(slot.boundary);
    const end = slot.atoms.length ? model.offsetOf(slot.atoms.at(-1)) : start;
    const caret = model.selectionIsPlaceholder ? end : model.position;
    const part = (from, to) => withoutPlaceholders(from < to ? mathfield.getValue(from, to, 'latex') : '') || '\\placeholder{}';
    const align = owner.type === 'surd' ? 'l' : 'c';
    const rows = `\\begin{array}{${align}}${part(start, caret)}\\\\${part(caret, end)}\\end{array}`;
    mathfield.selection = { ranges: [[start, end]] };
    mathfield.insert(rows, { format: 'latex', insertionMode: 'replaceSelection', selectionMode: 'after', feedback: false });
    // The caret goes to the start of the second row.
    const after = fieldModel();
    let array = after.at(after.position);
    while (array && array.type !== 'array') array = array.leftSibling?.type === 'array' ? array.leftSibling : array.parent;
    if (array) moveCaretTo(after.offsetOf(branchAtoms(array, [1, 0])[0]));
    syncFromField();
    return true;
  }

  const BRACKETS = {
    '(': ['(', ')'], ')': ['(', ')'], '[': ['[', ']'], ']': ['[', ']'], '{': ['\\{', '\\}'], '}': ['\\{', '\\}'],
  };

  /** A typed bracket key (see the keydown handler). Returns true if it was used. */
  function typeBracket(key) {
    const model = fieldModel();
    if (!model || allSelected) return false;
    const [open, close] = BRACKETS[key];
    if (model.selectionIsCollapsed && [')', ']', '}'].includes(key)) {
      // At the end of a bracket's contents, the closing bracket steps out of it.
      const here = model.at(model.position);
      const bracket = here?.parent;
      if (bracket?.type === 'leftright' && !here.rightSibling && bracket.rightDelim === close) {
        mathfield.position = model.offsetOf(bracket);
        return true;
      }
    }
    if (!model.selectionIsCollapsed && !model.selectionIsPlaceholder) {
      const [start, end] = [...model.selection.ranges[0]].sort((a, b) => a - b);
      const inner = mathfield.getValue(start, end, 'latex');
      mathfield.insert(`\\left${open}${inner}\\right${close}`, {
        format: 'latex', insertionMode: 'replaceSelection', selectionMode: 'after', feedback: false });
    } else {
      mathfield.insert(`\\left${open}#0\\right${close}`, {
        format: 'latex', insertionMode: 'replaceSelection', selectionMode: 'placeholder', feedback: false });
    }
    syncFromField();
    return true;
  }

  /** Handles the keys whose behavior follows classic equation editors. Returns true if handled. */
  function handleEditingKey(event, key) {
    const model = fieldModel();
    if (!model) return false;
    const index = lines.indexOf(mathfield);
    const collapsed = model.selectionIsCollapsed;
    const shift = event.shiftKey;
    switch (key) {
      case 'enter':
        if (shift) return false;
        if (caretAtom(model)?.parent && !caretAtom(model).parent.isRoot) return slotRows(model); // Inside a slot.
        splitLine();
        return true;
      case 'backspace':
        if (shift) return false;
        if (collapsed && model.position === 0 && index > 0) { mergeLines(index - 1, index); return true; }
        return backspace();
      case 'space':
        // Right after a function name (sin, typed or chosen) a space only ends the name, as in classic editors.
        if (shift || !collapsed) return false;
        return FUNCTION_NAMES.has(model.at(model.position)?.command?.slice(1));
      case 'forwarddelete':
        if (collapsed && model.position === mathfield.lastOffset && index < lines.length - 1) {
          mergeLines(index, index + 1);
          return true;
        }
        return false;
      case 'tab':
        return moveToSlot(shift ? -1 : 1);
      case 'up':
      case 'down':
        if (shift) return false;
        moveVertically(key === 'up' ? -1 : 1);
        return true; // With nothing above or below, the caret stays where it is.
      case 'left':
      case 'right':
        return shift ? false : moveHorizontally(key === 'right' ? 1 : -1);
      default:
        return false;
    }
  }

  function moveInCode(command) {
    const { value, selectionStart } = codeArea;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const lineEnd = (index => index < 0 ? value.length : index)(value.indexOf('\n', selectionStart));
    const column = selectionStart - lineStart;
    let caret = selectionStart;
    if (command === 'left') caret = Math.max(0, selectionStart - 1);
    if (command === 'right') caret = Math.min(value.length, selectionStart + 1);
    if (command === 'lineStart') caret = lineStart;
    if (command === 'lineEnd') caret = lineEnd;
    if (command === 'up' && lineStart > 0) {
      const previousStart = value.lastIndexOf('\n', lineStart - 2) + 1;
      caret = Math.min(previousStart + column, lineStart - 1);
    }
    if (command === 'down' && lineEnd < value.length) {
      const nextEnd = (index => index < 0 ? value.length : index)(value.indexOf('\n', lineEnd + 1));
      caret = Math.min(lineEnd + 1 + column, nextEnd);
    }
    codeArea.setSelectionRange(caret, caret);
    return true;
  }

  function moveCaret(command) {
    if (codeFocused()) return moveInCode(command);
    if (!mathfield) return false;
    mathfield.focus();
    const model = fieldModel();
    const index = lines.indexOf(mathfield);
    if (command === 'up' || command === 'down') {
      if (!moveVertically(command === 'up' ? -1 : 1) && !model) {
        mathfield.executeCommand(command === 'up' ? 'moveUp' : 'moveDown');
      }
      return true;
    }
    if ((command === 'left' || command === 'right') && model) return moveHorizontally(command === 'right' ? 1 : -1);
    mathfield.executeCommand({
      left: 'moveToPreviousChar', right: 'moveToNextChar',
      lineStart: 'moveToMathfieldStart', lineEnd: 'moveToMathfieldEnd',
    }[command]);
    return true;
  }

  // ---------------------------------------------------------------- synchronization

  // ---------------------------------------------------------------- undo

  // The document has one undo history, not one per line: splitting, joining and removing lines are
  // undone with everything else. An entry is the whole document with the caret. A run of typed
  // characters (or of deletions) is one step, as are all changes made by one command.
  const history = { past: [], future: [], current: null, lastKind: null, grouping: false, restoring: false };
  let inputKind = 'other'; // What the key being handled does: 'typing', 'deleting' or 'other'.

  function snapshot() {
    const model = fieldModel();
    return { latex: state.latex, line: Math.max(0, lines.indexOf(mathfield)), offset: model ? model.position : 0 };
  }

  function resetHistory() {
    Object.assign(history, { past: [], future: [], current: snapshot(), lastKind: null });
  }

  function recordChange() {
    const entry = snapshot();
    if (history.restoring || !history.current) { history.current = entry; return; }
    const kind = inputKind;
    const continues = history.grouping || (kind !== 'other' && kind === history.lastKind);
    if (!continues) {
      history.past.push(history.current);
      if (history.past.length > 500) history.past.shift();
    }
    history.future = [];
    history.current = entry;
    history.lastKind = kind;
    // Further changes made while handling the same event belong to this step.
    if (!history.grouping) {
      history.grouping = true;
      setTimeout(() => { history.grouping = false; });
    }
  }

  /** Undo (-1) or redo (+1). In the LaTeX pane, the text field's own undo applies. */
  function stepHistory(direction) {
    if (codeFocused()) { document.execCommand(direction < 0 ? 'undo' : 'redo'); return true; }
    if (composing) closeComposition();
    const from = direction < 0 ? history.past : history.future;
    const to = direction < 0 ? history.future : history.past;
    const entry = from.pop();
    if (!entry) return true;
    to.push(history.current);
    history.current = entry;
    history.lastKind = null;
    history.restoring = true;
    setAllSelected(false);
    (async () => {
      try {
        state.latex = entry.latex;
        await setDocumentLatex(entry.latex);
        codeArea.value = entry.latex;
        const field = lines[Math.min(entry.line, lines.length - 1)];
        field.focus();
        mathfield = field;
        field.position = Math.min(entry.offset, field.lastOffset);
        notifyChange();
        scheduleValidation();
      } finally {
        history.restoring = false;
      }
    })();
    return true;
  }

  function syncFromField() {
    if (!mathfield || loading || composing?.mode === 'math') return;
    if (!restoringPlaceholders) restorePlaceholders();
    const latex = documentLatex();
    if (latex === state.latex) return;
    state.latex = latex;
    recordChange();
    if (ui.mode === 'code' && !codeFocused()) codeArea.value = latex; // setMode fills it when shown.
    notifyChange();
    scheduleValidation();
  }

  function applyCodeNow() {
    clearTimeout(codeTimer);
    codeTimer = null;
    const latex = codeArea.value;
    if (lines.length) setDocumentLatex(latex);
    if (latex !== state.latex) {
      state.latex = latex;
      inputKind = 'other';
      recordChange();
      notifyChange();
    }
    scheduleValidation();
  }

  function scheduleValidation() {
    if (ui.mode !== 'code') return;
    clearTimeout(validationTimer);
    validationTimer = setTimeout(async () => {
      const result = await queueRender({ ...state });
      codeStatus.classList.toggle('error', !result.valid && !result.empty);
      codeStatus.textContent = result.valid ? `${result.width} × ${result.height} px`
        : result.empty ? 'Empty equation' : result.error;
    }, 200);
  }

  // ---------------------------------------------------------------- presentation

  function styleField(field) {
    field.style.fontSize = `${Math.round(state.fontSize * EDIT_SCALE)}px`;
    // The default ink follows the theme on screen; any other color is shown as chosen.
    field.style.color = state.color.toUpperCase() === DEFAULT_INK ? '' : state.color;
    field.defaultMode = state.displayStyle ? 'math' : 'inline-math';
  }

  function applyPresentation() {
    lines.forEach(styleField);
    $('font-size').value = String(state.fontSize);
    $('color').value = state.color.toLowerCase();
  }

  function setMode(mode, { focus = false } = {}) {
    ui.mode = mode;
    $('symbols-pane').hidden = mode !== 'symbols';
    $('code-pane').hidden = mode !== 'code';
    for (const button of document.querySelectorAll('.segmented button')) {
      button.setAttribute('aria-selected', String(button.dataset.mode === mode));
    }
    if (mode === 'code') {
      codeArea.value = state.latex;
      scheduleValidation();
      if (focus) codeArea.focus();
      updateMatches();
    } else {
      if (codeTimer) applyCodeNow();
      if (focus) mathfield?.focus();
    }
    post('mode', { mode });
    return true;
  }

  function toast(message) {
    const element = $('toast');
    element.textContent = message;
    element.classList.add('visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('visible'), 1600);
  }

  // ---------------------------------------------------------------- palette

  function previewLatex(item) {
    return (item.preview || item.latex).replace(/#@|#[0-9?]/g, '\\placeholder{}');
  }

  function glyph(latex) {
    try {
      resetTeXState();
      const output = MathJax.tex2svg(latex, { display: false, em: 16, ex: 7 });
      const svg = output.querySelector('svg');
      if (svg && !output.querySelector('[data-mml-node="merror"]')) return svg;
    } catch (_) { /* Fall back to text below. */ }
    const span = document.createElement('span');
    span.textContent = latex;
    return span;
  }

  function itemTitle(item) {
    const keys = combosFor({ insert: item.id }).map(displayCombo);
    return `${item.latex.replace(/#[@0-9?]/g, '□')}${keys.length ? `  (${keys.join(', ')})` : ''}`;
  }

  /** All categories side by side in one horizontally scrolling strip; the tabs jump between them. */
  function renderPalette() {
    const groups = VT_PALETTE.map(category => {
      const group = document.createElement('section');
      group.className = 'group';
      group.dataset.category = category.id;
      group.dataset.tint = category.tint;
      group.setAttribute('aria-label', category.title);
      const large = category.size === 'large';
      group.classList.toggle('large', large);
      // Four rows (two for large tiles), filled row by row.
      group.style.setProperty('--columns', Math.ceil(category.items.length / (large ? 2 : 4)));
      group.style.setProperty('--tint', `var(--tint-${category.tint})`);
      for (const item of category.items) {
        const tile = document.createElement('button');
        tile.className = 'tile';
        tile.dataset.id = item.id;
        tile.append(glyph((large ? '\\displaystyle ' : '') + previewLatex(item)));
        const key = document.createElement('span');
        key.className = 'key';
        tile.append(key);
        tile.addEventListener('mousedown', event => event.preventDefault()); // Keep the editor's caret.
        tile.addEventListener('click', () => insertItem(item));
        tile.addEventListener('contextmenu', event => {
          event.preventDefault();
          startRecording({ insert: item.id }, tile, item.id.replace(/-/g, ' '));
        });
        group.append(tile);
      }
      return group;
    });
    strip.replaceChildren(...groups);

    tabs.replaceChildren(...VT_PALETTE.map(category => {
      const button = document.createElement('button');
      button.setAttribute('role', 'tab');
      button.title = category.title;
      button.dataset.category = category.id;
      button.append(glyph(category.icon));
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => showCategory(category.id, { scroll: true }));
      return button;
    }));
    refreshKeyHints();
  }

  function showCategory(id, { scroll = false } = {}) {
    for (const button of tabs.children) button.setAttribute('aria-selected', String(button.dataset.category === id));
    if (scroll) {
      const group = strip.querySelector(`[data-category="${id}"]`);
      strip.scrollTo({ left: group.offsetLeft - strip.offsetLeft - 8, behavior: 'smooth' });
    }
    try { localStorage.setItem('vt.category', id); } catch (_) { /* Optional. */ }
  }

  function syncTabToScroll() {
    const left = strip.scrollLeft + 24;
    let current = VT_PALETTE[0].id;
    for (const group of strip.children) {
      if (group.offsetLeft - strip.offsetLeft <= left) current = group.dataset.category;
    }
    for (const button of tabs.children) button.setAttribute('aria-selected', String(button.dataset.category === current));
  }

  function refreshKeyHints() {
    for (const tile of strip.querySelectorAll('.tile')) {
      const item = paletteById.get(tile.dataset.id);
      const combos = combosFor({ insert: item.id });
      tile.querySelector('.key').textContent = combos.length ? displayCombo(combos[0]) : '';
      tile.title = itemTitle(item);
    }
    // Toolbar buttons name their command's current shortcuts (the menu commands' are fixed).
    for (const button of document.querySelectorAll('#toolbar [data-command]')) {
      button.dataset.label ??= button.title;
      const combos = combosFor({ command: button.dataset.command });
      button.title = combos.length ? `${button.dataset.label} (${combos.map(displayCombo).join(', ')})` : button.dataset.label;
    }
  }

  // ---------------------------------------------------------------- shortcut recording

  /** Records a shortcut for `binding`. `replacing` is an existing combo the new one replaces. */
  function startRecording(binding, anchor, title, { replacing = null, onDone = null } = {}) {
    recording = { binding, replacing, onDone };
    post('recording', { active: true });
    const recorder = $('recorder');
    recorder.querySelector('.recorder-title').textContent = title;
    recorder.querySelector('.recorder-keys').textContent = 'Press a shortcut…';
    recorder.hidden = false;
    const box = anchor.getBoundingClientRect();
    const width = recorder.offsetWidth;
    recorder.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, box.left + box.width / 2 - width / 2))}px`;
    recorder.style.top = `${Math.max(8, box.top - recorder.offsetHeight - 8)}px`;
  }

  function stopRecording() {
    const done = recording?.onDone;
    recording = null;
    $('recorder').hidden = true;
    post('recording', { active: false });
    done?.();
  }

  function handleRecordingKey(event) {
    event.preventDefault();
    event.stopPropagation();
    const key = keyName(event);
    if (!key) return; // A modifier on its own.
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    if (key === 'escape' && plain) return stopRecording();
    if (key === 'backspace' && plain) {
      for (const combo of combosFor(recording.binding)) unassign(combo);
      saveOverrides();
      toast('Shortcut removed');
      return stopRecording();
    }
    const combo = comboFromEvent(event);
    const message = text => { $('recorder').querySelector('.recorder-keys').textContent = text; };
    if (RESERVED.has(combo)) return message(`${displayCombo(combo)} is a menu command`);
    if (!event.ctrlKey && !event.altKey && !event.metaKey && !(event.shiftKey && (key === 'enter' || key === 'tab'))) {
      return message('Include ⌘, ⌃ or ⌥');
    }
    const previous = keymap[combo];
    if (recording.replacing && recording.replacing !== combo) unassign(recording.replacing);
    assign(combo, recording.binding);
    toast(previous && !sameTarget(previous, recording.binding)
      ? `${displayCombo(combo)} reassigned` : `${displayCombo(combo)} assigned`);
    stopRecording();
  }

  // ---------------------------------------------------------------- shortcuts sheet

  function bindingLabel(binding) {
    if (binding.command) return COMMAND_TITLES[binding.command] || binding.command;
    if (binding.insert) return paletteById.get(binding.insert)?.id.replace(/-/g, ' ') || binding.insert;
    return binding.latex;
  }

  function bindingGlyph(binding) {
    if (binding.insert) return glyph(previewLatex(paletteById.get(binding.insert)));
    if (binding.latex) return glyph(binding.latex.replace(/#@|#[0-9?]/g, '\\placeholder{}'));
    const span = document.createElement('span');
    span.textContent = '⌨︎';
    return span;
  }

  function renderShortcutList() {
    const filter = $('shortcut-filter').value.trim().toLowerCase();
    const rows = Object.entries(keymap)
      .sort(([a, x], [b, y]) => Number(!!x.command) - Number(!!y.command) || a.localeCompare(b))
      .filter(([combo, binding]) => !filter || bindingLabel(binding).toLowerCase().includes(filter) ||
        displayCombo(combo).toLowerCase().includes(filter) || combo.includes(filter))
      .map(([combo, binding]) => {
        const row = document.createElement('div');
        row.className = 'shortcut-row';
        const icon = document.createElement('div');
        icon.className = 'glyph';
        icon.append(bindingGlyph(binding));
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = bindingLabel(binding);
        const keycap = document.createElement('button');
        keycap.className = 'keycap';
        keycap.textContent = displayCombo(combo);
        keycap.addEventListener('click', () => {
          keycap.classList.add('recording');
          startRecording(binding, keycap, bindingLabel(binding), { replacing: combo, onDone: renderShortcutList });
        });
        const remove = document.createElement('button');
        remove.className = 'remove';
        remove.textContent = '×';
        remove.title = 'Remove shortcut';
        remove.addEventListener('click', () => { unassign(combo); saveOverrides(); renderShortcutList(); });
        row.append(icon, name, keycap, remove);
        return row;
      });
    $('shortcut-list').replaceChildren(...rows);
  }

  function showShortcuts() {
    $('shortcuts').hidden = false;
    $('shortcut-filter').value = '';
    renderShortcutList();
    $('shortcut-filter').focus();
  }

  // ---------------------------------------------------------------- command candidates
  //
  // Typing \name shows candidates the way an input method does: Space takes the first, 1–8 take
  // one by number, Enter keeps the command as typed, Esc cancels, and , . (or ← → PgUp PgDn) page.

  const PAGE_SIZE = 8;
  let commandIndex = null;
  let composing = null; // { mode: 'math' | 'code', text, page, list, start }
  const glyphCache = new Map();

  function buildCommandIndex() {
    const entries = [];
    const seen = new Set();
    const add = entry => {
      if (seen.has(entry.label)) return;
      seen.add(entry.label);
      entries.push(entry);
    };
    for (const category of VT_PALETTE) {
      for (const item of category.items) {
        const name = /^\\([a-zA-Z]+)/.exec(item.latex)?.[1];
        if (!name) continue;
        const label = item.latex.replace(/#[@0-9?]/g, '').replace(/\s+/g, '');
        add({ name, label, item, preview: previewLatex(item) });
      }
    }
    for (const name of VT_COMMANDS) add({ name, label: `\\${name}`, latex: `\\${name}`, preview: `\\${name}` });
    for (const latex of VT_COMMAND_TEMPLATES) {
      const item = { id: `command:${latex}`, latex };
      add({ name: /^\\([a-zA-Z]+)/.exec(latex)[1], label: latex.replace(/#[@0-9?]/g, ''), item, preview: previewLatex(item) });
    }
    const common = new Map(VT_COMMON_COMMANDS.map((name, index) => [name, index]));
    entries.forEach((entry, index) => { entry.rank = common.has(entry.name) ? common.get(entry.name) - 1000 : index; });
    return entries;
  }

  function isSubsequence(query, name) {
    let at = 0;
    for (const char of name) if (char === query[at]) at += 1;
    return at === query.length;
  }

  /** Candidates for `query` (the letters after \): exact, prefix, contains, subsequence, then first letter. */
  // Of two candidates with one name, the bare command (\lim) comes before the template (\lim_{▢\to▢}▢).
  const isTemplate = entry => ((entry.item?.latex ?? entry.latex ?? '').includes('#') ? 1 : 0);

  function candidatesFor(query) {
    commandIndex ??= buildCommandIndex();
    if (!query) return commandIndex.filter(entry => entry.rank < 0).sort((a, b) => a.rank - b.rank);
    const lower = query.toLowerCase();
    const tier = entry => {
      const name = entry.name;
      if (name === query) return 0;
      if (name.toLowerCase() === lower) return 0.5;
      if (name.startsWith(query)) return 1;
      if (name.toLowerCase().startsWith(lower)) return 1.5;
      if (name.toLowerCase().includes(lower)) return 2;
      if (isSubsequence(lower, name.toLowerCase())) return 3;
      if (name.toLowerCase().includes(lower[0])) return 4;
      return Infinity;
    };
    // Each command once (its first variant), except the one typed exactly, which shows every variant.
    const shown = new Set();
    return commandIndex.map(entry => ({ entry, tier: tier(entry) }))
      .filter(match => match.tier < Infinity)
      .sort((a, b) => a.tier - b.tier || isTemplate(a.entry) - isTemplate(b.entry) || a.entry.rank - b.entry.rank ||
        a.entry.name.length - b.entry.name.length)
      .filter(({ entry, tier: level }) => {
        if (level === 0) return true;
        if (shown.has(entry.name)) return false;
        shown.add(entry.name);
        return true;
      })
      .slice(0, PAGE_SIZE * 6)
      .map(match => match.entry);
  }

  function candidateGlyph(entry) {
    if (!glyphCache.has(entry.label)) glyphCache.set(entry.label, glyph(entry.preview));
    return glyphCache.get(entry.label).cloneNode(true);
  }

  /** Viewport coordinates of a textarea's caret, measured with a mirror element. */
  function textareaCaretPoint(textarea, index) {
    const style = getComputedStyle(textarea);
    const mirror = document.createElement('div');
    for (const property of ['font', 'letterSpacing', 'lineHeight', 'padding', 'border', 'boxSizing', 'tabSize', 'textIndent']) {
      mirror.style[property] = style[property];
    }
    Object.assign(mirror.style, { position: 'fixed', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
      width: `${textarea.clientWidth}px`, left: '0', top: '0' });
    mirror.textContent = textarea.value.slice(0, index);
    const marker = document.createElement('span');
    marker.textContent = '​';
    mirror.append(marker);
    document.body.append(mirror);
    const box = textarea.getBoundingClientRect();
    const point = { x: box.left + marker.offsetLeft - textarea.scrollLeft, top: box.top + marker.offsetTop - textarea.scrollTop,
      height: marker.offsetHeight };
    mirror.remove();
    return point;
  }

  function renderCandidates() {
    const panel = $('candidates');
    const preedit = panel.querySelector('.cand-preedit');
    const list = panel.querySelector('.cand-list');
    composing.list = candidatesFor(composing.text);
    const pages = Math.max(1, Math.ceil(composing.list.length / PAGE_SIZE));
    composing.page = Math.min(Math.max(composing.page, 0), pages - 1);
    const shown = composing.list.slice(composing.page * PAGE_SIZE, (composing.page + 1) * PAGE_SIZE);
    list.replaceChildren(...shown.map((entry, index) => {
      const button = document.createElement('button');
      button.className = `cand${index === 0 ? ' current' : ''}`;
      const label = document.createElement('span');
      label.className = 'cand-label';
      label.textContent = `${index + 1}.${entry.label}`;
      const glyphBox = document.createElement('span');
      glyphBox.className = 'cand-glyph';
      glyphBox.append(candidateGlyph(entry));
      button.append(label, glyphBox);
      button.addEventListener('mousedown', event => { event.preventDefault(); chooseCandidate(entry); });
      return button;
    }));
    if (pages > 1) {
      const more = document.createElement('span');
      more.className = 'cand-more';
      more.textContent = `${composing.page + 1}/${pages}`;
      list.append(more);
    }
    panel.hidden = false;

    // Position: the typed command sits at the caret; the bar goes below the line.
    let caretX;
    let lineBottom;
    if (composing.mode === 'math') {
      updateInlinePreedit();
      const model = fieldModel();
      const point = model && caretPoint(model, composing.start ?? model.position);
      const fieldBox = mathfield.getBoundingClientRect();
      caretX = point?.x ?? fieldBox.left;
      preedit.hidden = true;
      lineBottom = fieldBox.bottom;
    } else {
      const point = textareaCaretPoint(codeArea, composing.start);
      preedit.hidden = true;
      caretX = point.x;
      lineBottom = point.top + point.height + 2;
    }
    const width = list.offsetWidth;
    list.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, caretX - 4))}px`;
    const below = lineBottom + 4;
    list.style.top = `${below + list.offsetHeight > innerHeight - 8 ? Math.max(8, lineBottom - list.offsetHeight - 60) : below}px`;
  }

  /** Renders candidate glyphs in idle time, a few at a time, so the bar appears without delay. */
  function prewarmCandidateGlyphs() {
    commandIndex ??= buildCommandIndex();
    const pending = [...commandIndex].sort((a, b) => a.rank - b.rank);
    const step = () => {
      const until = performance.now() + 8;
      while (pending.length && performance.now() < until) {
        const entry = pending.shift();
        if (!glyphCache.has(entry.label)) glyphCache.set(entry.label, glyph(entry.preview));
      }
      if (pending.length) setTimeout(step, 30);
    };
    setTimeout(step, 500);
  }

  function startComposition(mode, text = '', start = 0) {
    composing = { mode, text, page: 0, list: [], start: mode === 'math' ? null : start };
    renderCandidates();
  }

  /**
   * In the equation the typed command is real, temporary content: blue raw text such as \mu that
   * takes the place of the slot or selection, as classic editors show it. It is never reported to
   * the document; choosing a candidate or cancelling removes it.
   */
  function updateInlinePreedit() {
    if (composing.preedit === composing.text) return;
    const model = fieldModel();
    if (!model) return;
    if (composing.start === null) {
      const [first] = [...model.selection.ranges[0]].sort((a, b) => a - b);
      composing.start = model.selectionIsCollapsed ? model.position : first;
      composing.field = mathfield;
    } else {
      mathfield.selection = { ranges: [[composing.start, composing.end]] };
    }
    const color = document.documentElement.dataset.theme === 'dark' ? '#6ea8ff' : '#2f6fe4';
    const raw = composing.text ? `\\backslash\\mathrm{${composing.text}}` : '\\backslash';
    mathfield.insert(`\\textcolor{${color}}{${raw}}`,
      { format: 'latex', insertionMode: 'replaceSelection', selectionMode: 'after', feedback: false });
    composing.end = mathfield.position;
    composing.preedit = composing.text;
  }

  function removeInlinePreedit(state) {
    if (state?.mode !== 'math' || state.end === undefined || !state.field?.isConnected) return;
    state.field.focus();
    mathfield = state.field;
    const model = fieldModel();
    const first = model.at(state.start);
    const fillsSlot = first?.type === 'first' && !first.parent?.isRoot && !model.at(state.end)?.rightSibling;
    mathfield.selection = { ranges: [[state.start, state.end]] };
    if (fillsSlot) {
      // Deleting a slot's whole content would delete its structure: put the empty slot back instead.
      mathfield.insert('\\placeholder{}', { format: 'latex', insertionMode: 'replaceSelection', feedback: false });
      selectPlaceholderAt(state.start + 1);
    } else {
      mathfield.executeCommand('deleteBackward');
    }
  }

  function closeComposition({ keepPreedit = false } = {}) {
    const state = composing;
    composing = null;
    $('candidates').hidden = true;
    if (!keepPreedit) removeInlinePreedit(state);
  }

  function chooseCandidate(entry) {
    const state = composing;
    closeComposition();
    if (!state || !entry) return;
    if (state.mode === 'code') {
      codeArea.focus();
      codeArea.setRangeText('', state.start, codeArea.selectionStart, 'end');
      insertIntoCode(entry.item ? entry.item.latex : entry.latex);
      return;
    }
    mathfield?.focus();
    if (entry.item) insertItem(entry.item);
    else insertLatex(entry.latex);
  }

  /** Enter: the command as typed if it exists, otherwise the best candidate (nothing for a lone backslash). */
  function commitTyped() {
    const state = composing;
    if (!state) return;
    const exact = state.list.find(entry => entry.name === state.text && entry.latex === `\\${state.text}`)
      ?? state.list.find(entry => entry.name === state.text);
    if (exact) return chooseCandidate(exact);
    if (state.text && state.list.length) return chooseCandidate(state.list[0]);
    closeComposition();
  }

  /** Keys while candidates are shown. Returns true if the key was used. */
  function handleCompositionKey(event) {
    const { key } = event;
    if (event.metaKey || event.ctrlKey || event.altKey) { closeComposition(); return false; }
    const page = delta => { composing.page += delta; renderCandidates(); return true; };
    const choose = index => { chooseCandidate(composing.list[composing.page * PAGE_SIZE + index]); return true; };
    if (composing.mode === 'code') {
      // Letters and Backspace edit the text itself; the input event refreshes the candidates.
      if (key === ' ') return composing.list.length ? choose(0) : (closeComposition(), false);
      if (/^[1-8]$/.test(key)) return composing.page * PAGE_SIZE + Number(key) - 1 < composing.list.length ? choose(Number(key) - 1) : false;
      if (key === 'Enter' || key === 'Escape') { closeComposition(); return true; }
      if (key === '.' || key === 'PageDown') return page(1);
      if (key === ',' || key === 'PageUp') return page(-1);
      return false;
    }
    if (/^[a-zA-Z]$/.test(key)) { composing.text += key; composing.page = 0; renderCandidates(); return true; }
    switch (key) {
      case 'Backspace':
        if (!composing.text) closeComposition();
        else { composing.text = composing.text.slice(0, -1); composing.page = 0; renderCandidates(); }
        return true;
      case ' ': case 'Tab':
        if (composing.list.length) return choose(0);
        commitTyped();
        return true;
      case 'Enter': commitTyped(); return true;
      case 'Escape': closeComposition(); return true;
      case '.': case 'PageDown': case 'ArrowRight': return page(1);
      case ',': case 'PageUp': case 'ArrowLeft': return page(-1);
      case 'ArrowUp': case 'ArrowDown': return true;
      case '\\': commitTyped(); startComposition('math'); return true;
      default:
        if (/^[1-8]$/.test(key)) {
          if (composing.page * PAGE_SIZE + Number(key) - 1 < composing.list.length) return choose(Number(key) - 1);
          return true;
        }
        if (key.length === 1) { commitTyped(); return false; } // Another character: keep the command and type on.
        return false;
    }
  }

  /** In the code pane, a \name before the caret shows candidates. */
  function updateCodeComposition() {
    const match = /\\([a-zA-Z]*)$/.exec(codeArea.value.slice(0, codeArea.selectionStart));
    if (!match || codeArea.selectionStart !== codeArea.selectionEnd) {
      if (composing?.mode === 'code') closeComposition();
      return;
    }
    const start = codeArea.selectionStart - match[0].length;
    if (composing?.mode === 'code' && composing.start === start) {
      composing.text = match[1];
      composing.page = 0;
      renderCandidates();
    } else {
      startComposition('code', match[1], start);
    }
  }

  // ---------------------------------------------------------------- matching brackets

  // Beside the caret, a bracket and its partner are highlighted — in the LaTeX code (\left( with
  // \right), { with }, ( with )) and in the equation — and the same pair in the other pane too.
  const FENCE_DELIM = String.raw`(?:\\[{}|]|\\[a-zA-Z]+|[()[\]|.<>/])`;
  const CODE_TOKENS = new RegExp(String.raw`\\(left|middle|right)\s*${FENCE_DELIM}|\\[a-zA-Z]+|\\.|[{}()[\]]`, 'g');

  /** The brackets of LaTeX code, paired: {start, end, kind (fence or brace), open, partner, line, ordinal}. */
  function codeBrackets(text) {
    const tokens = [];
    const stacks = { fence: [], brace: [] };
    const ordinals = new Map();
    for (const match of text.matchAll(CODE_TOKENS)) {
      const word = match[0];
      let kind;
      let open;
      if (match[1] === 'left') [kind, open] = ['fence', true];
      else if (match[1] === 'right') [kind, open] = ['fence', false];
      else if (word === '{' || word === '}') [kind, open] = ['brace', word === '{'];
      else if ('([)]'.includes(word) && word.length === 1) [kind, open] = ['fence', word === '(' || word === '['];
      else continue;
      const token = { start: match.index, end: match.index + word.length, kind, open, partner: null };
      if (open) {
        stacks[kind].push(token);
        if (kind === 'fence') {
          token.line = splitLines(text.slice(0, token.start)).length - 1;
          token.ordinal = ordinals.get(token.line) ?? 0;
          ordinals.set(token.line, token.ordinal + 1);
        }
      } else {
        const partner = stacks[kind].pop();
        if (partner) { partner.partner = token; token.partner = partner; token.line = partner.line; token.ordinal = partner.ordinal; }
      }
      tokens.push(token);
    }
    return tokens;
  }

  /** The brackets of a line, in order of their opening: \left…\right atoms and plain ( ) pairs. */
  function fieldFences(field) {
    const model = fieldModel(field);
    if (!model) return [];
    const fences = [];
    for (const atom of model.atoms) {
      if (atom.type === 'leftright') fences.push({ atom, start: atomRange(model, atom)[0] });
      if (atom.type === 'mopen') {
        let depth = 0;
        let close = null;
        for (let next = atom.rightSibling; next && !close; next = next.rightSibling) {
          if (next.type === 'mopen') depth += 1;
          else if (next.type === 'mclose') { if (depth === 0) close = next; else depth -= 1; }
        }
        fences.push({ atom, close, start: model.offsetOf(atom) });
      }
    }
    return fences.sort((a, b) => a.start - b.start);
  }

  /** The bracket pair beside the caret in a line, as an index into fieldFences(), or -1. */
  function fenceAtCaret(field, fences) {
    const model = fieldModel(field);
    if (!model || !(model.selectionIsCollapsed || model.selectionIsPlaceholder)) return -1;
    const position = model.selectionIsPlaceholder ? Math.max(...model.selection.ranges[0]) : model.position;
    const here = model.at(position);
    const candidates = [here, here?.rightSibling];
    if (here?.parent?.type === 'leftright' && (here.type === 'first' || !here.rightSibling)) candidates.push(here.parent);
    for (const atom of candidates) {
      if (!atom) continue; // At the end of a row there is nothing on the right.
      const index = fences.findIndex(fence => fence.atom === atom || (fence.close && fence.close === atom));
      if (index >= 0) return index;
    }
    return -1;
  }

  let matchedElements = [];
  let matchedFences = []; // {field, fence}: drawn again whenever MathLive redraws the line.
  function markFence(field, fence) {
    if (!fence) return;
    matchedFences.push({ field, fence });
    drawFence(field, fence);
  }
  const markFences = field => { for (const match of matchedFences) if (match.field === field) drawFence(field, match.fence); };
  function drawFence(field, fence) {
    const root = field.shadowRoot;
    const elements = fence.atom.type === 'leftright'
      ? [...root.querySelectorAll(`[data-atom-id="${fence.atom.id}"]`)].filter(el => /ML__(open|close)/.test(el.className))
      : [fence.atom, fence.close].filter(Boolean).map(atom => root.querySelector(`[data-atom-id="${atom.id}"]`)).filter(Boolean);
    for (const element of elements) if (!element.classList.contains('vt-match')) element.classList.add('vt-match');
    matchedElements.push(...elements);
  }

  const codeMirror = $('code-mirror');
  const escapeHTML = text => text.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
  function markCode(tokens) {
    const text = codeArea.value;
    let html = '';
    let at = 0;
    for (const token of [...tokens].sort((a, b) => a.start - b.start)) {
      html += escapeHTML(text.slice(at, token.start)) + `<mark>${escapeHTML(text.slice(token.start, token.end))}</mark>`;
      at = token.end;
    }
    codeMirror.innerHTML = html + escapeHTML(text.slice(at)) + (text.endsWith('\n') ? ' ' : '');
    codeMirror.scrollTop = codeArea.scrollTop;
  }

  /** Highlights the bracket pair beside the caret (in whichever pane has it) and its counterpart. */
  function updateMatches() {
    for (const element of matchedElements) element.classList.remove('vt-match');
    matchedElements = [];
    matchedFences = [];
    const showCode = ui.mode === 'code';
    const synced = codeArea.value === state.latex;
    let codeMarks = [];
    if (codeFocused()) {
      const caret = codeArea.selectionStart;
      if (caret !== codeArea.selectionEnd) return showCode && markCode([]);
      const tokens = codeBrackets(codeArea.value);
      const token = tokens.find(t => t.end === caret) ?? tokens.find(t => t.start === caret);
      if (token?.partner) {
        codeMarks = [token, token.partner];
        const open = token.open ? token : token.partner;
        if (synced && open.kind === 'fence' && lines[open.line]) {
          markFence(lines[open.line], fieldFences(lines[open.line])[open.ordinal]);
        }
      }
    } else if (mathfield) {
      const fences = fieldFences(mathfield);
      const index = fenceAtCaret(mathfield, fences);
      if (index >= 0) {
        markFence(mathfield, fences[index]);
        if (showCode && synced) {
          const line = lines.indexOf(mathfield);
          const open = codeBrackets(codeArea.value).find(t => t.kind === 'fence' && t.open && t.line === line && t.ordinal === index);
          if (open?.partner) codeMarks = [open, open.partner];
        }
      }
    }
    if (showCode) markCode(codeMarks);
  }

  for (const type of ['input', 'keyup', 'click', 'focus', 'blur']) codeArea.addEventListener(type, () => updateMatches());
  codeArea.addEventListener('scroll', () => { codeMirror.scrollTop = codeArea.scrollTop; });
  document.addEventListener('selectionchange', () => { if (codeFocused()) updateMatches(); });

  // ---------------------------------------------------------------- keyboard

  window.addEventListener('keydown', event => {
    if (recording) return handleRecordingKey(event);
    if (pendingFocus && !event.metaKey && !event.ctrlKey && !event.altKey && !composing &&
        !event.composedPath().includes(pendingFocus) && (event.key.length === 1 || event.key === 'Backspace')) {
      // The line just focused doesn't have the keyboard yet.
      event.preventDefault();
      event.stopImmediatePropagation();
      inputKind = event.key === 'Backspace' ? 'deleting' : 'typing';
      mathfield = pendingFocus;
      if (event.key === '\\') startComposition('math');
      else if (event.key === '^' || event.key === '_') insertLatex(`${event.key}{#0}`);
      else if (event.key === 'Backspace') { if (!backspace()) pendingFocus.executeCommand('deleteBackward'); }
      else pendingFocus.executeCommand(['typedText', event.key]);
      syncFromField();
      return;
    }
    if (!['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) {
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      inputKind = plain && event.key.length === 1 && !composing ? 'typing'
        : plain && (event.key === 'Backspace' || event.key === 'Delete') ? 'deleting' : 'other';
      if (inputKind === 'other') history.lastKind = null; // Moving the caret ends a run of typing.
    }
    if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) &&
        lines.some(field => event.composedPath().includes(field)) && extendAcrossLines(keyName(event))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (allSelected && keyName(event) && !['cmd+a', 'cmd+c', 'cmd+t', 'cmd+v', 'cmd+x'].includes(comboFromEvent(event)) &&
        !keymap[comboFromEvent(event)]) {
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      if (plain && (event.key === 'Backspace' || event.key === 'Delete')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        replaceSpan('');
        return;
      }
      if (plain && event.key.length === 1 && event.key !== '\\') {
        event.preventDefault();
        event.stopImmediatePropagation();
        replaceSpan('');
        mathfield.executeCommand(['typedText', event.key]); // The character takes the selection's place.
        syncFromField();
        return;
      }
      if (!event.metaKey && !event.ctrlKey && ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
        // An arrow collapses the selection to its start or end.
        event.preventDefault();
        event.stopImmediatePropagation();
        const edge = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? span.from : span.to;
        setAllSelected(false, null);
        focusAt(edge.line, edge.offset);
        return;
      }
      setAllSelected(false);
    }
    if (composing && handleCompositionKey(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    // Brackets come in pairs, as in classic editors: ( [ { insert \left…\right with the caret inside,
    // or around the selection; typed at the end of such a bracket's contents, its closing one steps out.
    if (BRACKETS[event.key] && !event.metaKey && !event.ctrlKey && !event.altKey && !composing &&
        lines.some(field => event.composedPath().includes(field)) && fieldModel()?.mode !== 'text' && typeBracket(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    // Typed ^ and _ make scripts the way the script shortcuts do.
    if ((event.key === '^' || event.key === '_') && !event.metaKey && !event.ctrlKey && !event.altKey &&
        lines.some(field => event.composedPath().includes(field)) &&
        (fieldModel()?.selectionIsCollapsed || fieldModel()?.selectionIsPlaceholder)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      insertLatex(`${event.key}{#0}`);
      return;
    }
    if (event.key === '\\' && !event.metaKey && !event.ctrlKey && !event.altKey &&
        lines.some(field => event.composedPath().includes(field))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      startComposition('math');
      return;
    }
    if (!$('shortcuts').hidden) {
      if (event.key === 'Escape') { $('shortcuts').hidden = true; mathfield?.focus(); event.preventDefault(); }
      return;
    }
    const key = keyName(event);
    if (greekPending && key) {
      setGreekPending(false);
      const entry = VT_GREEK_KEYS[key];
      if (entry && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        insertLatex(entry[event.shiftKey ? 1 : 0]);
        return;
      }
    }
    const combo = comboFromEvent(event);
    if (combo && keymap[combo] && runShortcut(combo)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const inField = lines.some(field => event.composedPath().includes(field));
    if (inField && !event.ctrlKey && !event.altKey && !event.metaKey && handleEditingKey(event, key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  // ---------------------------------------------------------------- export rendering

  function plainError(error) {
    return String(error?.message || error || 'Unable to typeset this equation.').replace(/^Error:\s*/, '');
  }

  function resetTeXState() {
    // MathJax keeps \newcommand definitions between conversions; every render starts clean.
    for (const map of dynamicTeXMaps) map.map.clear();
    MathJax.texReset();
  }

  function normalizedColor(value) {
    const color = String(value).trim();
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Choose a valid equation color.');
    return color.toUpperCase();
  }

  function normalizedState(update, base = state) {
    const next = { latex: base.latex, fontSize: base.fontSize, color: base.color, displayStyle: base.displayStyle };
    if (Object.hasOwn(update, 'latex')) next.latex = String(update.latex ?? '');
    if (next.latex.length > 100000) throw new Error('The equation exceeds the 100,000 character limit.');
    if (Object.hasOwn(update, 'fontSize')) next.fontSize = Number(update.fontSize);
    if (!Number.isFinite(next.fontSize) || next.fontSize < 8 || next.fontSize > 240) {
      throw new Error('Font size must be between 8 and 240 pixels.');
    }
    if (Object.hasOwn(update, 'color')) next.color = normalizedColor(update.color);
    if (Object.hasOwn(update, 'displayStyle')) next.displayStyle = !!update.displayStyle;
    return next;
  }

  /** One TeX expression for the whole document: several lines become a left-aligned array. */
  function documentTeX(latex, displayStyle) {
    // Trailing whitespace goes, except an escaped space (\ ) that the user typed.
    const trim = line => line.replace(/^\s+/, '').replace(/(?<!\\)\s+$/, '');
    const rows = splitLines(cleanLatex(latex)).map(line => trim(portableLatex(line)));
    // Blank lines between equations are kept, one line high; blank lines around them are not.
    while (rows.length && !rows[0]) rows.shift();
    while (rows.length && !rows.at(-1)) rows.pop();
    const parts = rows.map(line => line || '\\strut')
      // An empty slot inside \text{} would put a math symbol in text mode.
      .map(line => line.replace(/\\text\{\\placeholder\{\}\}/g, '\\placeholder{}'));
    if (parts.length <= 1) return parts[0] ?? '';
    const style = displayStyle ? '\\displaystyle ' : '';
    return `\\begin{array}{l}${parts.map(line => style + line).join(' \\\\[0.4em] ')}\\end{array}`;
  }

  async function buildResult(snapshot) {
    const latex = documentTeX(snapshot.latex, snapshot.displayStyle);
    if (!latex) return { valid: false, empty: true, error: 'The equation is empty.' };
    try {
      resetTeXState();
      const output = await MathJax.tex2svgPromise(latex, {
        display: snapshot.displayStyle, em: snapshot.fontSize, ex: snapshot.fontSize * 0.442,
        containerWidth: 100000, lineWidth: 100000,
      });
      const source = output.querySelector('svg');
      if (!source || output.querySelector('[data-mml-node="merror"]')) throw new Error('The equation could not be typeset.');
      if (source.querySelector('foreignObject, image')) throw new Error('The equation contains unsupported content.');
      const svg = source.cloneNode(true);
      const bounds = svg.getAttribute('viewBox')?.trim().split(/\s+/).map(Number);
      if (!bounds || bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[2] <= 0 || bounds[3] <= 0) {
        throw new Error('The equation has no visible content.');
      }
      const padding = 2;
      const unitsPerPixel = 1000 / snapshot.fontSize;
      const width = Math.ceil(bounds[2] / unitsPerPixel + padding * 2);
      const height = Math.ceil(bounds[3] / unitsPerPixel + padding * 2);
      svg.setAttribute('viewBox', `${bounds[0] - padding * unitsPerPixel} ${bounds[1] - padding * unitsPerPixel} ${width * unitsPerPixel} ${height * unitsPerPixel}`);
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('color', snapshot.color);
      svg.setAttribute('fill', snapshot.color);
      svg.removeAttribute('style');
      svg.removeAttribute('focusable');
      // Resolve currentColor so the file renders identically outside this page.
      for (const element of [svg, ...svg.querySelectorAll('*')]) {
        for (const attribute of ['fill', 'stroke', 'color']) {
          if (/currentColor/i.test(element.getAttribute(attribute) || '')) element.setAttribute(attribute, snapshot.color);
        }
        const style = element.getAttribute('style');
        if (style) element.setAttribute('style', style.replace(/currentColor/gi, snapshot.color));
      }
      resetTeXState();
      const mathml = await MathJax.tex2mmlPromise(latex, { display: snapshot.displayStyle });
      return { valid: true, svg: new XMLSerializer().serializeToString(svg), width, height, mathml };
    } catch (error) {
      return { valid: false, empty: false, error: plainError(error) };
    }
  }

  function queueRender(snapshot) {
    // MathJax's TeX input has shared state, so conversions run one at a time.
    const task = renderQueue.catch(() => {}).then(() => buildResult(snapshot));
    renderQueue = task;
    return task;
  }

  // ---------------------------------------------------------------- startup

  const ready = (async () => {
    if (!window.MathfieldElement || !window.MathJax?.startup) throw new Error('The bundled math engines failed to load.');
    MathfieldElement.fontsDirectory = new URL('vendor/mathlive/fonts', document.baseURI).href;
    MathfieldElement.soundsDirectory = null;
    MathfieldElement.computeEngine = null;
    MathfieldElement.openUrl = () => {};
    await customElements.whenDefined('math-field');

    scratchField = await createField({ scratch: true });
    placeholderClass(); // Sizes the slots before the first line renders.
    mathfield = await insertLine(0);
    resetHistory();

    await MathJax.startup.promise;
    const handlers = MathJax.startup.document.inputJax.find(jax => jax.name === 'TeX').parseOptions.handlers;
    dynamicTeXMaps = ['new-Command', 'new-Delimiter', 'new-Environment']
      .map(name => handlers.retrieve(name)).filter(map => map?.map instanceof Map);

    applyPresentation();
    overrides = sanitizeOverrides(window.VT_USER_SHORTCUTS || {});
    renderPalette();
    rebuildKeymap();
    let category = VT_PALETTE[0].id;
    try { category = localStorage.getItem('vt.category') || category; } catch (_) { /* Optional. */ }
    if (VT_PALETTE.some(entry => entry.id === category)) {
      const group = strip.querySelector(`[data-category="${category}"]`);
      strip.scrollLeft = group.offsetLeft - strip.offsetLeft - 8;
    }
    syncTabToScroll();
    mathfield.focus();
    post('ready', { mathlive: MathfieldElement.version, mathjax: MathJax.version });
    prewarmCandidateGlyphs();
  })().catch(error => {
    post('error', { message: plainError(error) });
    throw error;
  });
  ready.catch(() => {});

  // ---------------------------------------------------------------- UI wiring

  $('font-size').replaceChildren(...FONT_SIZES.map(size => new Option(`${size} pt`, String(size))));
  $('font-size').addEventListener('change', event => {
    state.fontSize = Number(event.target.value);
    applyPresentation();
    notifyChange();
    scheduleValidation();
    mathfield?.focus();
  });
  $('color').addEventListener('input', event => {
    state.color = event.target.value.toUpperCase();
    applyPresentation();
    notifyChange();
  });

  for (const button of document.querySelectorAll('[data-action]')) {
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => post('action', { name: button.dataset.action }));
  }
  for (const button of document.querySelectorAll('#toolbar [data-command]')) {
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => COMMANDS[button.dataset.command]());
  }
  for (const button of document.querySelectorAll('.segmented button')) {
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => setMode(button.dataset.mode, { focus: true }));
  }

  const exportMenu = $('export-menu');
  $('export-button').addEventListener('click', event => {
    event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    exportMenu.hidden = false;
    exportMenu.style.left = `${Math.min(innerWidth - exportMenu.offsetWidth - 8, box.left)}px`;
    exportMenu.style.top = `${box.bottom + 4}px`;
  });
  for (const button of exportMenu.querySelectorAll('button')) {
    button.addEventListener('click', () => {
      exportMenu.hidden = true;
      post('action', { name: 'export', format: button.dataset.format });
    });
  }
  // A paste replaces a selection across lines (pasted lines become lines).
  document.addEventListener('paste', event => {
    if (!allSelected || codeFocused()) return;
    const text = event.clipboardData?.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    replaceSpan(text);
  }, true);

  // A cut takes a selection across lines.
  document.addEventListener('cut', event => {
    if (!allSelected || codeFocused()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.clipboardData?.setData('text/plain', spanLatex());
    replaceSpan('');
  }, true);

  // Captured: MathLive keeps pointer events inside a line to itself. The other lines' selections
  // collapse once the click has moved the focus (changing them earlier would keep it where it was).
  document.addEventListener('pointerdown', event => {
    inputKind = 'other';
    history.lastKind = null; // A click ends a run of typing.
    const clicked = lines.find(field => event.composedPath().includes(field)) ?? null;
    const target = clicked ?? (event.composedPath().includes(canvas) ? lineBeside(event.clientY) : null);
    if (target && event.button === 0 && event.shiftKey && mathfield && (allSelected || target !== mathfield)) {
      // ⇧-click in another line: the selection runs from where it began to the click.
      event.preventDefault();
      event.stopImmediatePropagation();
      const anchor = allSelected ? span.anchor : topLevelPosition(mathfield, false);
      setSpan(anchor, { line: lines.indexOf(target), offset: offsetAtX(target, event.clientX) });
      requestAnimationFrame(() => paintSpan({ redraw: true }));
      return;
    }
    if (clicked && event.button === 0 && !event.shiftKey) {
      // A drag may go on into other lines; it is anchored where the press was.
      drag = { field: clicked, anchor: { line: lines.indexOf(clicked), offset: offsetAtX(clicked, event.clientX) } };
    } else if (!clicked && event.button === 0 && (event.target === canvas || event.target === fieldHost)) {
      // Beside a line (in the margin): the drag starts at that line's start or end and is ours alone.
      const beside = lineBeside(event.clientY);
      if (beside) drag = { field: null, anchor: { line: lines.indexOf(beside), offset: offsetAtX(beside, event.clientX) } };
    }
    // A click in the equation area ends any selection elsewhere (the toolbar and palette keep it:
    // they act on it). The line clicked, or beside the click, keeps its caret; below the lines, the last.
    if (event.shiftKey || !event.composedPath().includes(canvas)) return;
    const kept = clicked ?? lineBeside(event.clientY) ?? lines.at(-1);
    if (allSelected) setAllSelected(false, kept, false); // At once: a key typed right after the click must not replace everything.
    document.addEventListener('pointerup', () => setTimeout(() => { if (!allSelected) collapseLines(kept); }),
      { once: true, capture: true });
  }, true);

  // Dragging from one line into others selects across them, as in classic editors.
  let drag = null;

  /** The top-level offset in `field` nearest to x (MathLive's own hit test needs the line focused). */
  function offsetAtX(field, x) {
    const model = fieldModel(field);
    if (!model) return 0;
    let offset = 0;
    for (const atom of model.root.body) {
      if (atom.type === 'first') continue;
      const box = field._mathfield.getHTMLElement?.(atom)?.getBoundingClientRect();
      if (!box || x < box.left + box.width / 2) break;
      offset = model.offsetOf(atom);
    }
    return offset;
  }
  /** The line level with y, if any. */
  function lineBeside(y) {
    return lines.find(field => { const box = field.getBoundingClientRect(); return y >= box.top && y < box.bottom; }) ?? null;
  }

  function lineAt(y) {
    const boxes = lines.map(field => field.getBoundingClientRect());
    const index = boxes.findIndex(box => y >= box.top && y < box.bottom);
    if (index >= 0) return lines[index];
    return y < boxes[0].top ? lines[0] : lines.at(-1);
  }
  document.addEventListener('pointermove', event => {
    if (!drag?.anchor || !(event.buttons & 1)) return;
    const target = lineAt(event.clientY);
    if (target === drag.field) {
      // Back in the line where the drag began: MathLive's own selection again.
      if (allSelected && !span.all) setAllSelected(false, drag.field);
      return;
    }
    setSpan(drag.anchor, { line: lines.indexOf(target), offset: offsetAtX(target, event.clientX) });
    // While it has the drag, MathLive doesn't redraw the selection of the line it captured the drag
    // in: every frame of the drag draws the spanning selection anew.
    if (!drag.painting) {
      drag.painting = true;
      requestAnimationFrame(() => { if (drag) drag.painting = false; paintSpan({ redraw: true }); });
    }
  }, true);
  document.addEventListener('pointerup', () => {
    if (drag && allSelected) requestAnimationFrame(() => paintSpan({ redraw: true }));
    drag = null;
  }, true);
  document.addEventListener('mousedown', event => {
    if (composing && !$('candidates').contains(event.target)) closeComposition();
    if (!exportMenu.hidden && !exportMenu.contains(event.target)) exportMenu.hidden = true;
    if (recording && !$('recorder').contains(event.target)) stopRecording();
  });

  // A click below the last line puts the caret at the end of the document.
  canvas.addEventListener('mousedown', event => {
    if (event.target === canvas || event.target === fieldHost) {
      event.preventDefault();
      // Beside a line: the caret goes to that line's start or end; below the lines: to the end.
      const beside = lineBeside(event.clientY);
      if (beside) { focusAt(lines.indexOf(beside), offsetAtX(beside, event.clientX)); return; }
      const last = lines.at(-1);
      if (!last) return;
      last.focus();
      mathfield = last;
      last.executeCommand('moveToMathfieldEnd');
    }
  });

  // WebKit's default menu offers Reload, which would discard the equation; keep it for text fields only.
  document.addEventListener('contextmenu', event => {
    if (!event.target.closest('textarea, input')) event.preventDefault();
  });

  // The native host limits input methods to Roman keyboards while the equation has focus.
  document.addEventListener('focusin', () => post('focus', { math: document.activeElement?.tagName === 'MATH-FIELD' }));

  strip.addEventListener('scroll', syncTabToScroll, { passive: true });
  // A vertical scroll wheel scrolls the strip sideways.
  strip.addEventListener('wheel', event => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      strip.scrollLeft += event.deltaY;
      event.preventDefault();
    }
  }, { passive: false });

  codeArea.addEventListener('input', () => {
    updateCodeComposition();
    clearTimeout(codeTimer);
    codeTimer = setTimeout(applyCodeNow, 40);
  });
  codeArea.addEventListener('blur', () => { if (composing?.mode === 'code') closeComposition(); });
  window.addEventListener('blur', closeComposition);
  codeArea.addEventListener('keydown', event => {
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      codeArea.setRangeText('  ', codeArea.selectionStart, codeArea.selectionEnd, 'end');
      codeArea.dispatchEvent(new Event('input'));
    }
  });

  $('shortcut-filter').addEventListener('input', renderShortcutList);
  $('shortcuts-done').addEventListener('click', () => { $('shortcuts').hidden = true; mathfield?.focus(); });
  $('shortcuts-reset').addEventListener('click', () => {
    overrides = {};
    saveOverrides();
    renderShortcutList();
    toast('Default shortcuts restored');
  });

  // Resizable bottom pane.
  const root = document.documentElement;
  const setBottomHeight = height => {
    const clamped = Math.max(250, Math.min(innerHeight - 140, height));
    root.style.setProperty('--bottom-height', `${clamped}px`);
    return clamped;
  };
  try { const saved = Number(localStorage.getItem('vt.bottomHeight')); if (saved) setBottomHeight(saved); } catch (_) { /* Optional. */ }
  $('splitter').addEventListener('pointerdown', event => {
    const splitter = event.currentTarget;
    splitter.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = $('bottom').getBoundingClientRect().height;
    const move = moveEvent => {
      const height = setBottomHeight(startHeight + startY - moveEvent.clientY);
      try { localStorage.setItem('vt.bottomHeight', String(height)); } catch (_) { /* Optional. */ }
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', () => splitter.removeEventListener('pointermove', move), { once: true });
  });

  setMode('symbols');

  // ---------------------------------------------------------------- API for the native host

  window.vt = {
    async setState(update = {}) {
      await ready;
      const next = normalizedState(update);
      const latexChanged = next.latex !== state.latex;
      Object.assign(state, next);
      if (latexChanged) {
        await setDocumentLatex(state.latex);
        codeArea.value = state.latex;
        resetHistory(); // A document opened or replaced from outside starts a new history.
      }
      applyPresentation();
      scheduleValidation();
      return true;
    },
    getState: () => ({ ...state }),
    async insert(latex) { await ready; return insertLatex(latex); },
    async command(name) {
      await ready;
      if (name === 'focus') { mathfield.focus(); return true; }
      if (name === 'showShortcuts') { showShortcuts(); return true; }
      if (name === 'symbols' || name === 'code') return setMode(name, { focus: true });
      if (!COMMANDS[name]) throw new Error(`Unknown command: ${name}`);
      return COMMANDS[name]();
    },
    runShortcut(combo) { return runShortcut(combo); },
    setTheme: mode => setTheme(mode),
    selectionLatex,
    setShortcutOverrides(raw) { overrides = sanitizeOverrides(raw); rebuildKeymap(); },
    toast,
    async exportSVG(snapshot) {
      await ready;
      const result = await queueRender(normalizedState(snapshot || {}));
      if (!result.valid) throw new Error(result.error);
      return { svg: result.svg, width: result.width, height: result.height, mathml: result.mathml };
    },
    ready,
  };
})();
