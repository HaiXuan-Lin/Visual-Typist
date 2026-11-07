'use strict';
// Shared syntax/geometry for the two bundled math engines. Source stays standard package LaTeX.
window.VTWick = (() => {
  // The packages' geometry, in em (their pt lengths as at 10pt). simpler-wick draws 0.4pt TikZ lines
  // from 3pt above each endpoint up to offset + level·sep above the baseline; simplewick draws 0.05em
  // rules, its legs starting half an ex above the left endpoint (or below the baseline).
  const WICK = { line: .04, gap: .3 };
  const SIMPLE = { rule: .05, ex: .431 };
  function dimension(value, fallback = '1ex') {
    const match = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*(em|ex|pt|mu|mm|cm|in)\s*$/.exec(value || fallback);
    if (!match) throw new Error('Wick dimensions must be non-negative TeX lengths.');
    const em = Number(match[1]) * ({ em: 1, ex: SIMPLE.ex, pt: .1, mu: 1 / 18, mm: .28453, cm: 2.8453, in: 7.227 }[match[2]]);
    if (em > 20) throw new Error('Wick dimensions must not exceed 20em.');
    return em;
  }
  function options(source) {
    const result = { sep: .3, offset: 1 };
    for (const part of (source || '').split(',').filter(x => x.trim())) {
      const [key, value, extra] = part.split('=').map(x => x.trim());
      if (!Object.hasOwn(result, key) || !value || extra !== undefined) throw new Error('Wick options: sep=<length>, offset=<length>.');
      result[key] = dimension(value);
    }
    return result;
  }
  /** Pairs endpoints by label, in the order they close: [{ level, left, right }] with endpoint indexes. */
  function pair(levels) {
    const open = new Map(), pairs = [];
    levels.forEach((level, index) => {
      if (!open.has(level)) return open.set(level, index);
      pairs.push({ level, left: open.get(level), right: index });
      open.delete(level);
    });
    if (open.size) throw new Error('Each Wick contraction label must have two endpoints.');
    return pairs;
  }
  // Read one TeX token or balanced group; escaped braces never change the nesting depth.
  function argument(source, start) {
    let i = start;
    while (/\s/.test(source[i] || '') && i < source.length) i++;
    const begin = i;
    if (source[i] === '{') {
      let depth = 1; i++;
      const inner = i;
      while (i < source.length) {
        if (source[i] === '\\') { const m = /^\\(?:[a-zA-Z]+|.)/.exec(source.slice(i)); i += m ? m[0].length : 1; continue; }
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return { value: source.slice(inner, i), end: i + 1 };
        i++;
      }
      throw new Error('Unclosed Wick argument.');
    }
    const token = /^(?:\\[a-zA-Z]+|\\.|[^\s])/.exec(source.slice(i));
    if (!token) throw new Error('Missing Wick endpoint.');
    return { value: token[0], end: begin + token[0].length };
  }
  /**
   * \wick's argument as the expression `body`, each endpoint a group in it (`ends`: where, and its
   * label), and the contractions between them. Endpoints are elements of the expression itself, as
   * both editors lay them out; one inside a group is not supported.
   */
  function parse(source) {
    let body = '', i = 0, depth = 0;
    const ends = [];
    while (i < source.length) {
      const marker = /^\\c(?![a-zA-Z])([0-9]?)/.exec(source.slice(i));
      if (marker) {
        i += marker[0].length;
        const level = Number(marker[1] || 1);
        if (level === 0) continue;
        if (depth) throw new Error('Wick endpoints must not be inside a group.');
        const arg = argument(source, i); i = arg.end;
        ends.push({ level, value: arg.value, start: body.length, end: body.length + arg.value.length + 2 });
        body += '{' + arg.value + '}';
      } else if (source[i] === '\\') {
        const token = /^\\(?:[a-zA-Z]+|.)/.exec(source.slice(i));
        body += token ? token[0] : '\\'; i += token ? token[0].length : 1;
      } else {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        body += source[i++];
      }
    }
    const pairs = pair(ends.map(end => end.level)).map(({ level, left, right }) => ({ level, left, right,
      prefix: body.slice(0, ends[left].start), middle: body.slice(ends[left].end, ends[right].start) }));
    for (const p of pairs) [p.left, p.right] = [ends[p.left].value, ends[p.right].value];
    return { body, ends, pairs };
  }

  /**
   * Places the lines drawn in the editor (see VTInstallMathLive) between the boxes they join, where
   * the browser has drawn them. Each line holds the ids of two anchors and offsets (em) from their
   * centers; it is positioned in em from the start of its strip.
   */
  function layout(root) {
    const scale = new Map();
    for (const line of root.querySelectorAll('[data-vt-line]')) {
      const strip = line.parentElement;
      if (!scale.has(strip)) {
        scale.set(strip, [strip.getBoundingClientRect().left, parseFloat(getComputedStyle(strip).fontSize)]);
      }
      const [origin, em] = scale.get(strip);
      const [from, to, dx0, dx1] = line.dataset.vtLine.split(' ');
      const [a, b] = [from, to].map(id => root.querySelector(`[data-vt-anchor="${id}"]`)?.getBoundingClientRect());
      if (!a || !b || !em) continue;
      const x0 = ((a.left + a.right) / 2 - origin) / em + Number(dx0);
      const x1 = ((b.left + b.right) / 2 - origin) / em + Number(dx1);
      line.style.left = `${x0.toFixed(4)}em`;
      line.style.width = `${Math.max(0, x1 - x0).toFixed(4)}em`;
      line.style.visibility = 'visible';
    }
  }
  const layoutAll = () => {
    for (const field of document.querySelectorAll('math-field')) if (field.shadowRoot) layout(field.shadowRoot);
  };
  let scheduled = false;
  /** Lays out the lines once the markup just rendered is in the page, before it is painted. */
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; layoutAll(); });
    requestAnimationFrame(layoutAll); // In case the markup goes in later in the frame.
  }
  window.document?.fonts?.addEventListener('loadingdone', layoutAll); // Widths change as fonts load.

  return { WICK, SIMPLE, dimension, options, pair, parse, layout, schedule };
})();

// Called once from the pinned MathLive bundle. Keep the patch small; implement features here.
window.VTInstallMathLive = api => {
  const { define, Atom, Box, Context, parse, atoms } = api;
  window.VTInstallSlashedMathLive?.(api);
  const { WICK, SIMPLE } = VTWick;
  const finish = (atom, context, box) => {
    if (atom.caret) box.caret = atom.caret;
    return atom.bind(context, atom.attachSupsub(context, { base: box }).wrap(context));
  };
  // A list's boxes take part in the spacing around them; a group's box (type 'ignore') would not.
  const listBox = (context, list, type) => Atom.createBox(context, list, { type }) || new Box(null, { type });

  let anchors = 0;
  const ids = new WeakMap();
  /**
   * Marks `box` as one lines are drawn from; returns the id they refer to it by. The box of `atom`
   * keeps its id: MathLive renders an atom again to place scripts after it, and that box is dropped.
   */
  const anchor = (box, atom = null) => {
    const id = ids.get(atom) ?? String(++anchors);
    if (atom) ids.set(atom, id);
    box.attributes = { ...box.attributes, 'data-vt-anchor': id };
    return id;
  };
  /**
   * A line from `dx0` em past the center of anchor `from` to `dx1` past that of `to`, from `y0` to `y1`
   * em above the baseline. Where the anchors are is known once the browser draws them (VTWick.layout):
   * MathLive's widths are no guide (an accent's, as patched, is an em too wide).
   */
  const line = (from, to, dx0, dx1, y0, y1) => {
    const box = new Box(null, { attributes: { 'data-vt-line': [from, to, dx0, dx1].join(' ') } });
    for (const [property, value] of [['position', 'absolute'], ['left', '0'], ['width', '0'], ['visibility', 'hidden'],
      ['background', 'currentColor'], ['pointer-events', 'none']]) box.setStyle(property, value);
    box.setStyle('top', `${(-Math.max(y0, y1)).toFixed(4)}em`); // Not rounded up, as a number would be.
    box.setStyle('height', `${Math.abs(y1 - y0).toFixed(4)}em`);
    return box;
  };
  /** A strip on the baseline where the structure starts, taking no room, that the lines are placed from. */
  const strip = children => {
    const box = new Box(children, { classes: 'VT__lines' });
    for (const [property, value] of [['display', 'inline-block'], ['position', 'relative'], ['width', '0'],
      ['height', '0'], ['vertical-align', 'baseline']]) box.setStyle(property, value);
    VTWick.schedule();
    return box;
  };

  // simplewick: the line spans from the center of the left endpoint to that of the right one, placed
  // as the package places it from its arguments' widths; \acontracted and \bcontracted also set the
  // expression, whose parts are edited in place.
  define(['contraction', 'acontraction', 'bcontraction', 'acontracted', 'bcontracted'], '[height:string]{prefix:balanced-string}{left:balanced-string}{middle:balanced-string}{right:balanced-string}', {
    createAtom: t => new Atom({ ...t, type: 'mord', captureSelection: !t.command.endsWith('contracted'),
      body: t.command.endsWith('contracted') ? t.args.slice(1).map(part => new Atom({ type: 'group', body: parse(part) })) : undefined }),
    serialize: (t, options) => t.command + (t.args[0] ? '[' + t.args[0] + ']' : '') + (t.body ? t.body.filter(x => x.type !== 'first').map(x => x.bodyToLatex(options)) : t.args.slice(1)).map(x => '{' + x + '}').join('') + t.supsubToLatex(options),
    render: (t, parent) => {
      const context = new Context({ parent }, t.style);
      let height;
      try { height = VTWick.dimension(t.args[0]); } catch (_) { return finish(t, context, new Box('?', { classes: 'ML__error' })); }
      // The four arguments, as one expression (the package measures each between empty atoms).
      // \contraction draws only the line, over what follows it: its arguments are laid out unseen.
      const shown = !!t.body;
      const groups = shown ? t.body.filter(x => x.type !== 'first') : t.args.slice(1).map(part => new Atom({ type: 'group', body: parse(part) }));
      const partContext = shown ? context : new Context({ parent: context, isPhantom: true });
      const parts = groups.map(group => shown ? group.createBox(partContext, { boxType: 'lift' }) : listBox(partContext, group.body, 'lift'));
      const [left, right] = [anchor(parts[1]), anchor(parts[3])];
      const { rule, ex } = SIMPLE;
      // Legs `height` long from half an ex above the left endpoint (or below the baseline); a rule
      // wide, the left one starting at the endpoint's center; the bar between them, a rule thick.
      const below = t.command.startsWith('\\b');
      const [near, far] = below ? [-ex / 2, -ex / 2 - height] : [parts[1].height + ex / 2, parts[1].height + ex / 2 + height];
      const bar = below ? far + rule : far - rule;
      const lines = [line(left, left, 0, rule, near, far), line(left, right, 0, 2 * rule, bar, far), line(right, right, rule, 2 * rule, near, far)];
      let box;
      if (shown) {
        box = new Box([strip(lines), ...parts], { type: 'lift' });
      } else {
        const unseen = new Box(parts);
        for (const [property, value] of [['position', 'absolute'], ['left', '0'], ['top', '0'], ['white-space', 'nowrap']]) unseen.setStyle(property, value);
        box = new Box(strip([unseen, ...lines]), { type: 'ord' });
        box.height = 0;
        box.depth = 0;
      }
      if (below) box.depth = Math.max(box.depth, -far);
      else box.height = Math.max(box.height, far);
      return finish(t, context, box);
    },
  });
  // An endpoint of \wick: a box of its own, as the package's TikZ node.
  const endpoints = new WeakMap(); // Endpoint atom → { id, height } of its box, as last rendered.
  define('vtwickmark', '{level:string}{body:math}', {
    createAtom: t => Object.assign(new Atom({ ...t, type: 'group', body: atoms(t.args[1]) }), { verbatimLatex: null }),
    serialize: (t, options) => '\\c' + t.args[0] + '{' + t.bodyToLatex(options) + '}' + t.supsubToLatex(options),
    render: (atom, parent) => {
      const context = new Context({ parent }, atom.style);
      const box = atom.createBox(context, { boxType: 'ord' });
      endpoints.set(atom, { id: anchor(box, atom), height: box.height });
      return atom.attachSupsub(context, { base: box }).wrap(context);
    },
  });
  define('wick', '[options:string]{body:string}', {
    parse: parser => {
      const options = parser.scanOptionalArgument('string');
      // As MathLive's balanced-string, but a letter after a command stays apart from it (\c a, not \ca).
      let raw = '';
      parser.skipFiller();
      if (parser.match('<{>')) {
        for (let depth = 1; !parser.end();) {
          const token = parser.get();
          if (token === '<{>') depth++;
          else if (token === '<}>' && --depth === 0) break;
          const text = { '<{>': '{', '<}>': '}', '<space>': ' ', '<$>': '$', '<$$>': '$$' }[token] ?? token;
          raw += (/\\[a-zA-Z]+$/.test(raw) && /^[a-zA-Z]/.test(text) ? ' ' : '') + text;
        }
      }
      const marked = raw.replace(/\\c(?![a-zA-Z])([0-9]?)/g, (_, n) => n === '0' ? '' : '\\vtwickmark{' + (n || '1') + '}');
      return [options, parse(marked, { context: parser.context, style: parser.style })];
    },
    createAtom: t => new Atom({ ...t, type: 'mord', body: atoms(t.args[1]) }),
    serialize: (t, options) => '\\wick' + (t.args[0] ? '[' + t.args[0] + ']' : '') + '{' + t.bodyToLatex(options) + '}' + t.supsubToLatex(options),
    render: (t, parent) => {
      const context = new Context({ parent }, t.style);
      // The expression is laid out as if \wick were not there, as in the package.
      const body = listBox(context, t.body, 'lift');
      try {
        const opts = VTWick.options(t.args[0]);
        const marks = t.body.filter(atom => atom.command === '\\vtwickmark');
        // As the export: endpoints are elements of the expression (\left…\right, say, would take them in).
        if (VTWick.parse(t.bodyToLatex({})).ends.length !== marks.length) throw new Error('Wick endpoints must not be inside a group.');
        const { line: width, gap } = WICK;
        let top = 0;
        // Each leg from 3pt above its endpoint to the bar, offset + level·sep above the baseline.
        const lines = VTWick.pair(marks.map(atom => Number(atom.args[0]))).flatMap(({ level, left, right }) => {
          const [a, b] = [marks[left], marks[right]].map(atom => endpoints.get(atom));
          const y = opts.offset + level * opts.sep;
          top = Math.max(top, y + width / 2);
          return [line(a.id, a.id, -width / 2, width / 2, a.height + gap, y + width / 2),
            line(a.id, b.id, -width / 2, width / 2, y - width / 2, y + width / 2),
            line(b.id, b.id, -width / 2, width / 2, b.height + gap, y + width / 2)];
        });
        const box = new Box([strip(lines), body], { type: 'lift' });
        box.height = Math.max(box.height, top);
        return finish(t, context, box);
      } catch (_) {
        body.classes += ' ML__error';
        return finish(t, context, new Box([body], { type: 'lift' }));
      }
    },
  });
  define('nomathglue', '{body:math}', { createAtom: t => new Atom({ ...t, type: 'mord', body: atoms(t.args[0]) }) });
};
