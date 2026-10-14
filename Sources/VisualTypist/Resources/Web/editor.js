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
  const RESERVED = new Set(['cmd+c', 'cmd+v', 'cmd+x', 'cmd+z', 'shift+cmd+z', 'cmd+a', 'cmd+s', 'cmd+n', 'cmd+w',
    'cmd+m', 'cmd+,', 'cmd+tab', 'cmd+space', 'cmd+t', 'shift+cmd+o', 'alt+shift+cmd+s']);

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
    // A script with nothing before it (start of a slot, or an empty slot) needs an empty base: {}_{…}.
    const model = fieldModel();
    const anchor = model && caretAtom(model);
    if (/^[_^]/.test(latex) && (model?.selectionIsPlaceholder || anchor?.type === 'first')) latex = `{}${latex}`;
    mathfield.insert(latex, {
      format: 'latex', insertionMode: 'replaceSelection', selectionMode: 'placeholder', focus: true, feedback: false,
    });
    startInLowerLimit();
    syncFromField();
    return true;
  }

  /** A newly inserted ∑ or ∫ with limits starts in its lower limit, where the index goes. */
  function startInLowerLimit() {
    const model = fieldModel();
    const atom = model && caretAtom(model);
    const owner = atom?.parent;
    if (!model?.selectionIsPlaceholder || atom.parentBranch !== 'superscript' || !LARGE_OPERATORS.has(owner?.type)) return;
    const lower = branchAtoms(owner, 'subscript').find(child => child.type === 'placeholder');
    if (lower) selectPlaceholderAt(model.offsetOf(lower));
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

  // MathLive's style for what is typed next, per font command (null: no font).
  const FONT_STYLES = {
    mathrm: { variant: 'normal', variantStyle: 'up' }, null: { variant: 'normal', variantStyle: '' },
    mathit: { variant: 'normal', variantStyle: 'italic' }, mathbf: { variant: 'normal', variantStyle: 'bold' },
    boldsymbol: { variant: 'normal', variantStyle: 'bolditalic' }, mathsf: { variant: 'sans-serif', variantStyle: '' },
    mathtt: { variant: 'monospace', variantStyle: '' }, mathcal: { variant: 'calligraphic', variantStyle: '' },
    mathscr: { variant: 'script', variantStyle: '' }, mathfrak: { variant: 'fraktur', variantStyle: '' },
  };

  /** Sets the font of the selection (or of what is typed next): `command` is e.g. 'mathbf', or null for none. */
  function setFont(command) {
    const wrap = text => {
      const inner = stripFonts(text);
      return command ? `\\${command}{${inner}}` : inner;
    };
    if (codeFocused()) {
      const { selectionStart: start, selectionEnd: end, value } = codeArea;
      if (start === end) return command ? insertIntoCode(`\\${command}{#0}`) : true;
      codeArea.setRangeText(wrap(value.slice(start, end)), start, end, 'select');
      codeArea.dispatchEvent(new Event('input'));
      return true;
    }
    const model = fieldModel();
    if (!mathfield || !model) return false;
    mathfield.focus();
    if (model.selectionIsCollapsed || model.selectionIsPlaceholder) {
      mathfield.applyStyle(FONT_STYLES[command], { operation: 'set' });
      return true;
    }
    const [start, end] = [...model.selection.ranges[0]].sort((a, b) => a - b);
    const selected = mathfield.getValue(start, end, 'latex');
    const topLevel = model.at(start + 1)?.parent === model.root && model.at(end)?.parent === model.root;
    if (!topLevel) {
      // Inside a structure: MathLive's insert (it writes bold Latin letters as \mathbf).
      mathfield.insert(wrap(selected), { format: 'latex', insertionMode: 'replaceSelection', selectionMode: 'item', feedback: false });
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
      updated.selection = { ranges: [[start, updated.lastOffset - remaining]] };
      syncFromField();
    });
    return true;
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
    greekNext: 'Type the next letter in Greek', fontRoman: 'Font: upright (\\mathrm)',
    fontNormal: 'Font: normal (remove font)', fontItalic: 'Font: italic (\\mathit)', fontBold: 'Font: bold (\\mathbf)',
    fontBoldSymbol: 'Font: bold symbol (\\boldsymbol)', fontSans: 'Font: sans serif (\\mathsf)',
    fontMono: 'Font: typewriter (\\mathtt)', fontCalligraphic: 'Font: calligraphic (\\mathcal)',
    fontScript: 'Font: script (\\mathscr)', fontFraktur: 'Font: fraktur (\\mathfrak)',
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
    // A line break written as \\ at the end of a line is the separator, not part of the line.
    const finish = line => line.replace(/\s*\\\\\s*$/, '');
    const result = [];
    let current = null;
    let depth = 0;
    for (const raw of latex.split('\n')) {
      current = current === null ? raw : `${current}\n${raw}`;
      const code = raw.replace(/\\\\/g, '').replace(/\\[{}]/g, '').replace(/%.*$/, '');
      depth += (code.match(/\{/g) || []).length - (code.match(/\}/g) || []).length;
      depth += (code.match(/\\begin\{/g) || []).length - (code.match(/\\end\{/g) || []).length;
      if (depth <= 0) {
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
  const FIELD_CSS = `
    .vt-slot { color: transparent !important; background: linear-gradient(var(--vt-slot), var(--vt-slot)) center / 58% 74% no-repeat !important; }
    .ML__focused .vt-slot.vt-slot-active { background-image: linear-gradient(var(--vt-slot-active), var(--vt-slot-active)) !important; }
    .ML__container:has(.vt-slot-active) .ML__selection { display: none !important; }
  `;

  /** Marks MathLive's placeholder glyphs (▢) so the stylesheet above can repaint them. */
  function tagSlots(field) {
    // "Active" only when the selection is exactly one slot, not a larger selection containing slots.
    const slotSelected = !!fieldModel(field)?.selectionIsPlaceholder;
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
        if (field === mathfield && !restoringPlaceholders && restorePlaceholders()) syncFromField();
      });
      field.addEventListener('focusin', () => { mathfield = field; });
    }
    const mounted = new Promise(resolve => field.addEventListener('mount', resolve, { once: true }));
    (scratch ? document.body : fieldHost).insertBefore(field, scratch ? null : before);
    await mounted;
    field.menuItems = [];
    field.mathModeSpace = '\\ ';
    field.letterShapeStyle = 'tex';
    if (!scratch) {
      const style = document.createElement('style');
      style.textContent = FIELD_CSS;
      field.shadowRoot.append(style);
      new MutationObserver(() => tagSlots(field))
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

  /** The document as LaTeX: one line per equation line, separated by \\. */
  function documentLatex() {
    return lines.map(field => withoutPlaceholders(portableLatex(field.getValue('latex')))).join(' \\\\\n');
  }

  /** Empty slots are an editing aid; in LaTeX they are empty groups, as classic editors write them. */
  function withoutPlaceholders(latex) {
    return latex.replace(/\{\\placeholder\{\}\}/g, '{}').replace(/\\placeholder\{\}/g, '{}');
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
    }
    return PlaceholderAtom;
  }

  const sameBranch = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const branchAtoms = (atom, branch) => { try { return atom.branch(branch) ?? []; } catch (_) { return []; } };
  const isSlotEmpty = (atom, branch) => branchAtoms(atom, branch).every(child => child.type === 'first' || child.type === 'placeholder');
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
  function restorePlaceholders(field = mathfield) {
    const model = fieldModel(field);
    const Placeholder = placeholderClass();
    if (!model || !Placeholder || restoringPlaceholders) return false;
    const collapsed = model.selectionIsCollapsed;
    if (field === mathfield && !collapsed) return false;
    const anchor = model.at(model.position);
    let anchorPlaceholder = null;
    let changed = false;
    for (const atom of model.atoms) {
      if (atom.isRoot || atom.mode === 'text' || !atom.branches?.length) continue;
      const prescriptBase = atom.type === 'group' && atom.branches.some(branch => SCRIPT_BRANCHES.includes(branch));
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
    if (!changed) return false;
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
    if (!LARGE_OPERATORS.has(atom.type)) return branches;
    const rank = branch => ({ subscript: 0, superscript: 1 })[branch] ?? 2;
    return [...branches].sort((a, b) => rank(a) - rank(b));
  }

  const isStructure = atom => !!atom && atom.type !== 'first' && (atom.branches?.length ?? 0) > 0;
  const hasOwnSlots = atom => (atom.branches ?? []).some(branch => !SCRIPT_BRANCHES.includes(branch));
  const allSlotsEmpty = atom => (atom.branches ?? []).every(branch => isSlotEmpty(atom, branch));

  /** An operator's empty operand (the □ after ∑ or ∫) belongs to it. */
  function operandOf(atom) {
    return LARGE_OPERATORS.has(atom?.type) && atom.rightSibling?.type === 'placeholder' ? atom.rightSibling : null;
  }

  function atomRange(model, atom) {
    return [model.offsetOf(atom) - (atom.children?.length ?? 0) - 1, model.offsetOf(operandOf(atom) ?? atom)];
  }

  let pendingScripts = null; // The script structure selected by a first Backspace.

  /** Removes the (empty) scripts of `owner` with MathLive's own deletion, leaving the caret after it. */
  function removeScripts(owner) {
    const model = fieldModel();
    for (const branch of SCRIPT_BRANCHES) {
      const placeholder = branchAtoms(owner, branch).find(atom => atom.type === 'placeholder');
      if (!placeholder) continue;
      selectPlaceholderAt(model.offsetOf(placeholder));
      mathfield.executeCommand('deleteBackward');
    }
    mathfield.position = model.offsetOf(owner);
    syncFromField();
  }

  /**
   * Backspace as in classic equation editors: in an empty slot it selects the slot's structure
   * (a second Backspace deletes it); right after a structure it deletes the structure if all its
   * slots are empty and selects it otherwise. An empty script is selected and then removed on its own.
   */
  function backspace() {
    const model = fieldModel();
    if (!model) return false;
    const [start, end] = [...model.selection.ranges[0]].sort((a, b) => a - b);
    if (pendingScripts?.field === mathfield && pendingScripts.start === start && pendingScripts.end === end) {
      const { owner } = pendingScripts;
      pendingScripts = null;
      removeScripts(owner);
      return true;
    }
    pendingScripts = null;
    if (!model.selectionIsPlaceholder && !model.selectionIsCollapsed) return false;
    const atom = caretAtom(model);

    // In an operator's empty operand (the □ after ∑): the operator and operand go together.
    if (model.selectionIsPlaceholder && atom?.parent?.isRoot && LARGE_OPERATORS.has(atom.leftSibling?.type)) {
      mathfield.selection = { ranges: [atomRange(model, atom.leftSibling)] };
      return true;
    }

    // In an empty slot.
    if (atom && ['first', 'placeholder'].includes(atom.type) && atom.parent && !atom.parent.isRoot &&
        isSlotEmpty(atom.parent, atom.parentBranch)) {
      const owner = atom.parent;
      const range = atomRange(model, owner);
      mathfield.selection = { ranges: [range] };
      if (SCRIPT_BRANCHES.includes(atom.parentBranch) && !LARGE_OPERATORS.has(owner.type) && !hasOwnSlots(owner)) {
        if (owner.branches.filter(branch => SCRIPT_BRANCHES.includes(branch)).every(branch => isSlotEmpty(owner, branch))) {
          pendingScripts = { field: mathfield, owner, start: range[0], end: range[1] };
        }
      }
      return true;
    }

    // Right after a structure (or after an operator's empty operand).
    if (!model.selectionIsCollapsed) return false;
    let before = model.at(model.position);
    if (before?.type === 'placeholder' && LARGE_OPERATORS.has(before.leftSibling?.type)) before = before.leftSibling;
    if (!isStructure(before)) return false;
    if (!hasOwnSlots(before) && !LARGE_OPERATORS.has(before.type)) {
      // A symbol with scripts (x²): step into the last script.
      const last = slotOrder(before).at(-1);
      moveCaretTo(model.offsetOf(branchAtoms(before, last).at(-1)));
      return true;
    }
    mathfield.selection = { ranges: [atomRange(model, before)] };
    if (allSlotsEmpty(before)) {
      mathfield.executeCommand('deleteBackward');
      syncFromField();
    }
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
      if (next) {
        if (next.type === 'placeholder') selectPlaceholderAt(model.offsetOf(next));
        else if (isStructure(next)) enterSlot(next, slotOrder(next)[0], false);
        else mathfield.position = model.offsetOf(next);
        return true;
      }
      const owner = here.parent;
      if (!owner || owner.isRoot) return moveToLine(lineIndex + 1, 0, 'start') || true;
      const order = slotOrder(owner);
      const following = order[order.findIndex(branch => sameBranch(branch, here.parentBranch)) + 1];
      if (following !== undefined) enterSlot(owner, following, false);
      else if (operandOf(owner)) selectPlaceholderAt(model.offsetOf(operandOf(owner))); // From the limits into the operand.
      else mathfield.position = model.offsetOf(owner);
      return true;
    }
    if (here.type !== 'first') {
      if (here.type === 'placeholder') selectPlaceholderAt(model.offsetOf(here));
      else if (isStructure(here)) enterSlot(here, slotOrder(here).at(-1), true);
      else mathfield.position = model.offsetOf(here.leftSibling);
      return true;
    }
    const owner = here.parent;
    if (!owner || owner.isRoot) return moveToLine(lineIndex - 1, 0, 'end') || true;
    const order = slotOrder(owner);
    const preceding = order[order.findIndex(branch => sameBranch(branch, here.parentBranch)) - 1];
    if (preceding !== undefined) enterSlot(owner, preceding, true);
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
    const order = slotOrder(owner);
    const target = order[order.findIndex(branch => sameBranch(branch, atom.parentBranch)) + direction];
    if (target !== undefined) {
      moveCaretTo(model.offsetOf(branchAtoms(owner, target).at(-1)));
    } else {
      mathfield.position = direction > 0 ? model.offsetOf(owner) : model.offsetOf(owner.leftSibling);
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
        splitLine();
        return true;
      case 'backspace':
        if (shift) return false;
        if (collapsed && model.position === 0 && index > 0) { mergeLines(index - 1, index); return true; }
        return backspace();
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

  function syncFromField() {
    if (!mathfield || loading) return;
    if (!restoringPlaceholders) restorePlaceholders();
    const latex = documentLatex();
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
    if (lines.length) setDocumentLatex(latex);
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
      group.style.setProperty('--columns', Math.ceil(category.items.length / 4)); // Four rows, filled row by row.
      group.style.setProperty('--tint', `var(--tint-${category.tint})`);
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
    const parts = splitLines(cleanLatex(latex)).map(line => trim(portableLatex(line))).filter(Boolean)
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
    mathfield = await insertLine(0);

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

  // A click below the last line puts the caret at the end of the document.
  canvas.addEventListener('mousedown', event => {
    if (event.target === canvas || event.target === fieldHost) {
      event.preventDefault();
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
