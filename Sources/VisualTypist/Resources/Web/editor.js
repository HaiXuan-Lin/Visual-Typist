'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('canvas');
  const codeArea = $('code');
  const codeStatus = $('code-status');
  const grid = $('grid');
  const tabs = $('tabs');

  const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96];
  const EDIT_SCALE = 1.25; // The canvas shows equations a little larger than their export size.

  const state = { latex: '', fontSize: 32, color: '#17191D', displayStyle: true };
  const ui = { mode: 'symbols', category: VT_PALETTE[0].id };
  const paletteById = new Map(VT_PALETTE.flatMap(category => category.items.map(item => [item.id, item])));

  let mathfield = null;
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
    NumpadEnter: 'enter', Space: 'space', Backspace: 'backspace', Escape: 'escape',
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  };
  const KEY_ALIASES = { return: 'enter', esc: 'escape', delete: 'backspace', quote: "'", apostrophe: "'" };
  const KEY_NAMES = new Set([...'abcdefghijklmnopqrstuvwxyz0123456789', ...Object.values(CODE_KEYS)]);
  const MODIFIERS = [['ctrl', '⌃'], ['alt', '⌥'], ['shift', '⇧'], ['cmd', '⌘']];
  const MODIFIER_ALIASES = { control: 'ctrl', option: 'alt', opt: 'alt', command: 'cmd' };
  const KEY_SYMBOLS = { left: '←', right: '→', up: '↑', down: '↓', tab: '⇥', enter: '↩', space: 'Space', backspace: '⌫', escape: '⎋' };

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
    for (const [combo, binding] of Object.entries(VT_DEFAULT_KEYMAP)) keymap[normalizeCombo(combo)] = binding;
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
    const defaultBinding = VT_DEFAULT_KEYMAP[combo];
    if (defaultBinding) overrides[combo] = null;
    else delete overrides[combo];
  }

  function runShortcut(combo) {
    const binding = keymap[normalizeCombo(combo)];
    if (!binding) return false;
    if (binding.insert) return insertItem(paletteById.get(binding.insert));
    if (binding.latex) return insertLatex(binding.latex);
    return COMMANDS[binding.command]?.() !== false;
  }

  // ---------------------------------------------------------------- editing

  const codeFocused = () => document.activeElement === codeArea;

  function insertLatex(latex) {
    if (codeFocused()) return insertIntoCode(latex);
    if (!mathfield) return false;
    mathfield.focus();
    mathfield.insert(latex, {
      format: 'latex', insertionMode: 'replaceSelection', selectionMode: 'placeholder', focus: true, feedback: false,
    });
    syncFromField();
    return true;
  }

  function insertItem(item) {
    return item ? insertLatex(item.latex) : false;
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

  function wrapSelection(command) {
    return insertLatex(`\\${command}{#0}`);
  }

  function matrixCommand(name) {
    if (codeFocused() || !mathfield) return false;
    mathfield.executeCommand(name);
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
    styleRegular: () => wrapSelection('mathrm'),
    styleItalic: () => wrapSelection('mathit'),
    styleBold: () => wrapSelection('mathbf'),
    styleBoldItalic: () => wrapSelection('boldsymbol'),
    styleSans: () => wrapSelection('mathsf'),
    styleMono: () => wrapSelection('mathtt'),
    addRowBefore: () => matrixCommand('addRowBefore'),
    addRowAfter: () => matrixCommand('addRowAfter'),
    addColumnBefore: () => matrixCommand('addColumnBefore'),
    addColumnAfter: () => matrixCommand('addColumnAfter'),
    removeRow: () => matrixCommand('removeRow'),
    removeColumn: () => matrixCommand('removeColumn'),
    cursorUp: () => moveCaret('up'),
    cursorDown: () => moveCaret('down'),
    cursorLeft: () => moveCaret('left'),
    cursorRight: () => moveCaret('right'),
    lineStart: () => moveCaret('lineStart'),
    lineEnd: () => moveCaret('lineEnd'),
    undo: () => { mathfield?.executeCommand('undo'); syncFromField(); return true; },
    redo: () => { mathfield?.executeCommand('redo'); syncFromField(); return true; },
  };

  const COMMAND_TITLES = {
    toggleMode: 'Switch between symbols and LaTeX code', applyCode: 'Apply LaTeX code to the equation',
    greekNext: 'Type the next letter in Greek', styleRegular: 'Upright', styleItalic: 'Italic',
    styleBold: 'Bold', styleBoldItalic: 'Bold italic', styleSans: 'Sans serif', styleMono: 'Typewriter',
    addRowBefore: 'Matrix: insert row above', addRowAfter: 'Matrix: insert row below',
    addColumnBefore: 'Matrix: insert column before', addColumnAfter: 'Matrix: insert column after',
    removeRow: 'Matrix: delete row', removeColumn: 'Matrix: delete column', undo: 'Undo', redo: 'Redo',
    cursorUp: 'Move up', cursorDown: 'Move down', cursorLeft: 'Move left', cursorRight: 'Move right',
    lineStart: 'Move to start of line', lineEnd: 'Move to end of line',
  };

  function setGreekPending(active) {
    greekPending = active;
    $('greek-indicator').hidden = !active;
  }

  // ---------------------------------------------------------------- synchronization

  function cleanLatex(latex) {
    const source = latex.trim();
    if (source.startsWith('$$') && source.endsWith('$$') && source.length >= 4) return source.slice(2, -2).trim();
    if (source.startsWith('$') && source.endsWith('$') && source.length >= 2) return source.slice(1, -1).trim();
    if ((source.startsWith('\\[') && source.endsWith('\\]')) ||
        (source.startsWith('\\(') && source.endsWith('\\)'))) return source.slice(2, -2).trim();
    return source;
  }

  async function createField(parent, { scratch = false } = {}) {
    const field = new MathfieldElement();
    field.setAttribute('math-virtual-keyboard-policy', 'manual');
    field.setAttribute('smart-fence', 'on');
    if (scratch) {
      field.setAttribute('aria-hidden', 'true');
      field.tabIndex = -1;
      field.style.cssText = 'position:fixed;left:-10000px;top:0;width:400px;';
    } else {
      field.setAttribute('aria-label', 'Equation editor');
      field.addEventListener('input', syncFromField);
    }
    const mounted = new Promise(resolve => field.addEventListener('mount', resolve, { once: true }));
    parent.append(field);
    await mounted;
    field.menuItems = [];
    field.mathModeSpace = '\\,';
    field.letterShapeStyle = 'tex';
    return field;
  }

  /**
   * Replaces the editor contents. MathLive 0.109 can keep invisible empty-group atoms across
   * setValue() after some insertions; when the result differs from a clean field's, the editor
   * element is rebuilt.
   */
  async function setFieldValue(latex) {
    const value = cleanLatex(latex);
    const options = { silenceNotifications: true, format: 'latex', mode: 'math' };
    mathfield.mode = 'math'; // Leave text mode, e.g. after inserting \text{}.
    mathfield.setValue(value, options);
    scratchField.setValue(value, options);
    if (mathfield.getValue('latex') === scratchField.getValue('latex')) return;
    const hadFocus = mathfield.hasFocus();
    const stale = mathfield;
    stale.style.display = 'none';
    mathfield = await createField($('field-host'));
    mathfield.setValue(value, options);
    applyPresentation();
    // Focus moves before the old element is removed: MathLive blurs it and fails if it is detached.
    if (hadFocus) mathfield.focus();
    stale.remove();
  }

  /** Rewrites MathLive output that standard LaTeX (and MathJax) rejects, e.g. `\middle{|}` or `\bm`. */
  function portableLatex(latex) {
    return latex
      .replace(/\\bm(?![a-zA-Z])/g, '\\boldsymbol')
      .replace(/\\doubleprime(?![a-zA-Z])/g, '\\prime\\prime')
      .replace(/\\middle\{(\\[a-zA-Z]+|\\?[^{}\s])\}/g,
      (_, delimiter) => `\\middle${delimiter}${/^\\[a-zA-Z]+$/.test(delimiter) ? ' ' : ''}`);
  }

  // ---------------------------------------------------------------- structural editing
  //
  // Classic equation-editor behavior on top of MathLive: every empty slot shows a placeholder box,
  // Backspace in an empty slot steps out of (or removes) its structure, and the up/down arrows
  // move the caret to the nearest slot above or below. These use MathLive's internal model
  // (the bundled version is pinned); each helper degrades to MathLive's default if it is missing.

  const SCRIPT_BRANCHES = ['superscript', 'subscript'];
  let restoringPlaceholders = false;
  let PlaceholderAtom = null;

  function fieldModel() {
    const model = mathfield?._mathfield?.model;
    return model && typeof model.offsetOf === 'function' && model.root ? model : null;
  }

  function placeholderClass() {
    if (!PlaceholderAtom && scratchField) {
      scratchField.setValue('\\placeholder{}', { silenceNotifications: true });
      PlaceholderAtom = scratchField._mathfield?.model?.root?.body?.find(atom => atom.type === 'placeholder')?.constructor ?? null;
    }
    return PlaceholderAtom;
  }

  const sameBranch = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const branchAtoms = (atom, branch) => { try { return atom.branch(branch) ?? []; } catch (_) { return []; } };
  const isSlotEmpty = (atom, branch) => branchAtoms(atom, branch).every(child => child.type === 'first' || child.type === 'placeholder');
  const hasNoAtoms = (atom, branch) => branchAtoms(atom, branch).every(child => child.type === 'first');

  /** The slots that belong together with `branch`: scripts pair with scripts, other branches with each other. */
  function siblingSlots(atom, branch) {
    const script = SCRIPT_BRANCHES.includes(branch);
    return (atom.branches ?? []).filter(other => SCRIPT_BRANCHES.includes(other) === script);
  }

  /** Puts a placeholder into every empty slot. Returns true if anything changed. */
  function restorePlaceholders() {
    const model = fieldModel();
    const Placeholder = placeholderClass();
    if (!model || !Placeholder || restoringPlaceholders || !model.selectionIsCollapsed) return false;
    const caretAtom = model.at(model.position);
    let caretPlaceholder = null;
    let changed = false;
    for (const atom of model.atoms) {
      // Empty groups ({} before prescripts) and text are intentionally empty.
      if (atom.isRoot || atom.type === 'group' || atom.mode === 'text' || !atom.branches?.length) continue;
      for (const branch of atom.branches) {
        if (!hasNoAtoms(atom, branch)) continue;
        const placeholder = new Placeholder();
        atom.addChild(placeholder, branch);
        changed = true;
        if (caretAtom?.type === 'first' && caretAtom.parent === atom && sameBranch(caretAtom.parentBranch, branch)) {
          caretPlaceholder = placeholder;
        }
      }
    }
    if (!changed) return false;
    restoringPlaceholders = true;
    try {
      model.contentDidChange({ inputType: 'insertText' });
      if (caretPlaceholder) selectPlaceholderAt(model.offsetOf(caretPlaceholder));
      else mathfield.position = model.offsetOf(caretAtom);
    } finally {
      restoringPlaceholders = false;
    }
    return true;
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

  /** The slot (owner atom and branch) whose only content is the caret or a selected placeholder. */
  function emptySlotAtCaret(model) {
    const [start, end] = model.selection.ranges[0];
    const atom = model.selectionIsPlaceholder ? model.at(Math.max(start, end))
      : start === end ? model.at(model.position) : null;
    if (!atom || !['first', 'placeholder'].includes(atom.type)) return null;
    const owner = atom.parent;
    if (!owner || owner.isRoot || !isSlotEmpty(owner, atom.parentBranch)) return null;
    return { owner, branch: atom.parentBranch };
  }

  /**
   * Backspace in an empty slot of a multi-slot structure (fraction, limits, matrix…): moves to the
   * previous slot, or removes the structure once all of its slots are empty. Single-slot structures
   * use MathLive's own behavior, which already removes them.
   */
  function backspaceInEmptySlot() {
    const model = fieldModel();
    if (!model) return false;
    const slot = emptySlotAtCaret(model);
    if (!slot) return false;
    const { owner, branch } = slot;
    const slots = siblingSlots(owner, branch);
    if (slots.length <= 1) return false;
    if (slots.some(other => !isSlotEmpty(owner, other))) {
      mathfield.position = model.offsetOf(branchAtoms(owner, branch)[0]);
      mathfield.executeCommand('moveToPreviousChar');
      return true;
    }
    restoringPlaceholders = true;
    try {
      if (SCRIPT_BRANCHES.includes(branch)) {
        for (const script of slots) owner.removeBranch(script);
        model.contentDidChange({ inputType: 'deleteContentBackward' });
        mathfield.position = model.offsetOf(owner);
      } else {
        const previous = owner.leftSibling;
        owner.parent.removeChild(owner);
        model.contentDidChange({ inputType: 'deleteContentBackward' });
        mathfield.position = previous ? model.offsetOf(previous) : 0;
      }
    } finally {
      restoringPlaceholders = false;
    }
    syncFromField();
    return true;
  }

  function caretPoint(model, offset) {
    const atom = model.at(offset);
    const element = atom && mathfield._mathfield.getHTMLElement?.(atom);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { x: atom.type === 'first' ? box.left : box.right, y: box.top + box.height / 2 };
  }

  /** Moves the caret to the nearest position above (direction -1) or below (+1). */
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
    const candidates = [];
    for (let offset = 0; offset <= model.lastOffset; offset += 1) {
      const atom = model.at(offset);
      // Positions in the caret's own row are never above or below it, even next to a tall ∫ or Σ.
      if (atom.parent === here.parent && sameBranch(atom.parentBranch, here.parentBranch)) continue;
      const point = caretPoint(model, offset);
      if (!point) continue;
      const distance = (point.y - origin.y) * direction;
      if (distance < 4) continue;
      // Prefer positions straight above or below: horizontal distance counts double.
      const score = distance + 2 * Math.abs(point.x - origin.x);
      candidates.push({ offset, score, outer: enclosing.has(atom.parent) });
    }
    const best = (list => list.reduce((a, b) => (b.score < a.score ? b : a), list[0]))(
      candidates.some(candidate => !candidate.outer) ? candidates.filter(candidate => !candidate.outer) : candidates);
    if (!best) return false;
    moveCaretTo(best.offset);
    return true;
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
    if (command === 'up' || command === 'down') {
      if (!moveVertically(command === 'up' ? -1 : 1) && !fieldModel()) {
        mathfield.executeCommand(command === 'up' ? 'moveUp' : 'moveDown');
      }
      return true;
    }
    mathfield.executeCommand({
      left: 'moveToPreviousChar', right: 'moveToNextChar',
      lineStart: 'moveToMathfieldStart', lineEnd: 'moveToMathfieldEnd',
    }[command]);
    return true;
  }

  function syncFromField() {
    if (!mathfield) return;
    if (!restoringPlaceholders) restorePlaceholders();
    const latex = portableLatex(mathfield.getValue('latex'));
    if (latex === state.latex) return;
    state.latex = latex;
    if (!codeFocused()) codeArea.value = latex;
    notifyChange();
    scheduleValidation();
  }

  function applyCodeNow() {
    clearTimeout(codeTimer);
    codeTimer = null;
    const latex = codeArea.value;
    if (mathfield) setFieldValue(latex);
    if (latex !== state.latex) {
      state.latex = latex;
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

  function applyPresentation() {
    if (!mathfield) return;
    mathfield.style.fontSize = `${Math.round(state.fontSize * EDIT_SCALE)}px`;
    mathfield.style.color = state.color;
    mathfield.defaultMode = state.displayStyle ? 'math' : 'inline-math';
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

  function renderTabs() {
    tabs.replaceChildren(...VT_PALETTE.map(category => {
      const button = document.createElement('button');
      button.setAttribute('role', 'tab');
      button.textContent = category.tab;
      button.title = category.title;
      button.dataset.category = category.id;
      button.addEventListener('click', () => showCategory(category.id));
      return button;
    }));
  }

  const renderedCategories = new Map();

  function showCategory(id) {
    ui.category = id;
    for (const button of tabs.children) button.setAttribute('aria-selected', String(button.dataset.category === id));
    if (!renderedCategories.has(id)) {
      const category = VT_PALETTE.find(entry => entry.id === id);
      const tiles = document.createElement('div');
      tiles.className = 'tiles';
      tiles.dataset.tint = category.tint;
      tiles.style.setProperty('--columns', category.columns);
      for (const item of category.items) {
        const tile = document.createElement('button');
        tile.className = 'tile';
        tile.dataset.id = item.id;
        tile.append(glyph(previewLatex(item)));
        const key = document.createElement('span');
        key.className = 'key';
        tile.append(key);
        tile.addEventListener('mousedown', event => event.preventDefault()); // Keep the editor's caret.
        tile.addEventListener('click', () => insertItem(item));
        tile.addEventListener('contextmenu', event => {
          event.preventDefault();
          startRecording({ insert: item.id }, tile, glyphTitle(item));
        });
        tiles.append(tile);
      }
      renderedCategories.set(id, tiles);
    }
    grid.replaceChildren(renderedCategories.get(id));
    refreshKeyHints();
    try { localStorage.setItem('vt.category', id); } catch (_) { /* Optional. */ }
  }

  function glyphTitle(item) {
    return item.id.replace(/-/g, ' ');
  }

  function refreshKeyHints() {
    for (const tiles of renderedCategories.values()) {
      for (const tile of tiles.children) {
        const item = paletteById.get(tile.dataset.id);
        const combos = combosFor({ insert: item.id });
        tile.querySelector('.key').textContent = combos.length ? displayCombo(combos[0]) : '';
        tile.title = itemTitle(item);
      }
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
    if (event.metaKey) {
      $('recorder').querySelector('.recorder-keys').textContent = '⌘ shortcuts belong to the menus';
      return;
    }
    if (!event.ctrlKey && !event.altKey && !(event.shiftKey && (key === 'enter' || key === 'tab'))) {
      $('recorder').querySelector('.recorder-keys').textContent = 'Include ⌃ or ⌥';
      return;
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

  // ---------------------------------------------------------------- keyboard

  window.addEventListener('keydown', event => {
    if (recording) return handleRecordingKey(event);
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
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    const inField = mathfield && event.composedPath().includes(mathfield);
    if (plain && inField) {
      const handled = key === 'backspace' ? backspaceInEmptySlot()
        // With nothing above or below, the caret stays where it is.
        : key === 'up' ? (moveVertically(-1), !!fieldModel())
        : key === 'down' ? (moveVertically(1), !!fieldModel()) : false;
      if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
    const combo = comboFromEvent(event);
    if (!combo || !keymap[combo]) return;
    if (runShortcut(combo)) {
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

  async function buildResult(snapshot) {
    // An empty slot inside \text{} would put a math symbol in text mode.
    const latex = portableLatex(cleanLatex(snapshot.latex)).replace(/\\text\{\\placeholder\{\}\}/g, '\\placeholder{}');
    if (!latex) return { valid: false, empty: true, error: 'The equation is empty.' };
    try {
      resetTeXState();
      const output = await MathJax.tex2svgPromise(latex, {
        display: snapshot.displayStyle, em: snapshot.fontSize, ex: snapshot.fontSize * 0.442,
        containerWidth: 100000, lineWidth: 100000,
      });
      const source = output.querySelector('svg');
      if (!source || output.querySelector('[data-mml-node="merror"]')) throw new Error('The equation could not be typeset.');
      if (source.querySelector('text, foreignObject, image')) {
        throw new Error('The equation contains a character without a vector outline.');
      }
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

    scratchField = await createField(document.body, { scratch: true });
    mathfield = await createField($('field-host'));

    await MathJax.startup.promise;
    const handlers = MathJax.startup.document.inputJax.find(jax => jax.name === 'TeX').parseOptions.handlers;
    dynamicTeXMaps = ['new-Command', 'new-Delimiter', 'new-Environment']
      .map(name => handlers.retrieve(name)).filter(map => map?.map instanceof Map);

    applyPresentation();
    overrides = sanitizeOverrides(window.VT_USER_SHORTCUTS || {});
    rebuildKeymap();
    let category = VT_PALETTE[0].id;
    try { category = localStorage.getItem('vt.category') || category; } catch (_) { /* Optional. */ }
    showCategory(VT_PALETTE.some(entry => entry.id === category) ? category : VT_PALETTE[0].id);
    mathfield.focus();
    post('ready', { mathlive: MathfieldElement.version, mathjax: MathJax.version });
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
  document.addEventListener('mousedown', event => {
    if (!exportMenu.hidden && !exportMenu.contains(event.target)) exportMenu.hidden = true;
    if (recording && !$('recorder').contains(event.target)) stopRecording();
  });

  canvas.addEventListener('mousedown', event => {
    if (event.target === canvas || event.target.id === 'field-host') {
      event.preventDefault();
      mathfield?.focus();
      mathfield?.executeCommand('moveToMathfieldEnd');
    }
  });

  // WebKit's default menu offers Reload, which would discard the equation; keep it for text fields only.
  document.addEventListener('contextmenu', event => {
    if (!event.target.closest('textarea, input')) event.preventDefault();
  });

  // The native host limits input methods to Roman keyboards while the equation has focus.
  document.addEventListener('focusin', () => post('focus', { math: document.activeElement?.tagName === 'MATH-FIELD' }));

  codeArea.addEventListener('input', () => {
    clearTimeout(codeTimer);
    codeTimer = setTimeout(applyCodeNow, 150);
  });
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
    const clamped = Math.max(120, Math.min(innerHeight - 160, height));
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

  renderTabs();
  setMode('symbols');

  // ---------------------------------------------------------------- API for the native host

  window.vt = {
    async setState(update = {}) {
      await ready;
      const next = normalizedState(update);
      const latexChanged = next.latex !== state.latex;
      Object.assign(state, next);
      if (latexChanged) {
        await setFieldValue(state.latex);
        codeArea.value = state.latex;
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
