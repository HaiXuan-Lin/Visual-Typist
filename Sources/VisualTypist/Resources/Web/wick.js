'use strict';
// Shared syntax/geometry for the two bundled math engines. Source stays standard package LaTeX.
window.VTWick = (() => {
  function dimension(value, fallback = '1ex') {
    const match = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*(em|ex|pt|mu|mm|cm|in)\s*$/.exec(value || fallback);
    if (!match) throw new Error('Wick dimensions must be non-negative TeX lengths.');
    const em = Number(match[1]) * ({ em: 1, ex: .431, pt: .1, mu: 1 / 18, mm: .28453, cm: 2.8453, in: 7.227 }[match[2]]);
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
  function parse(source) {
    let body = '', i = 0;
    const open = new Map(), pairs = [];
    while (i < source.length) {
      const marker = /^\\c(?![a-zA-Z])([0-9]?)/.exec(source.slice(i));
      if (marker) {
        i += marker[0].length;
        const level = Number(marker[1] || 1);
        if (level === 0) continue;
        const arg = argument(source, i); i = arg.end;
        const previous = open.get(level);
        if (previous) {
          pairs.push({ level, prefix: body.slice(0, previous.start), left: previous.value,
            middle: body.slice(previous.end), right: arg.value });
          open.delete(level);
        } else open.set(level, { start: body.length, end: body.length + arg.value.length + 2, value: arg.value });
        body += '{' + arg.value + '}';
      } else if (source[i] === '\\') {
        const token = /^\\(?:[a-zA-Z]+|.)/.exec(source.slice(i));
        body += token ? token[0] : '\\'; i += token ? token[0].length : 1;
      } else body += source[i++];
    }
    if (open.size) throw new Error('Each Wick contraction label must have two endpoints.');
    return { body, pairs };
  }
  return { dimension, options, parse };
})();

// Called once from the pinned MathLive bundle. Keep the patch small; implement features here.
window.VTInstallMathLive = api => {
  const { define, Atom, Box, Context, parse, atoms } = api;
  window.VTInstallSlashedMathLive?.(api);
  const measured = (context, latex) => Atom.createBox(context, parse(latex, { context })) || new Box(null);
  const finish = (atom, context, box) => {
    if (atom.caret) box.caret = atom.caret;
    return atom.bind(context, atom.attachSupsub(context, { base: box }).wrap(context));
  };
  function overlay(context, parts, height, below = false) {
    const [prefix, left, middle, right] = parts.map(x => measured(context, x));
    const start = prefix.width + left.width / 2;
    const width = Math.max(.05, left.width / 2 + middle.width + right.width / 2);
    const edge = below ? -.215 : Math.max(left.height, right.height) + .215;
    const top = below ? edge - height : edge + height;
    const line = new Box(null, { classes: 'VT__contraction', type: 'ignore' });
    line.width = start + width; line.height = below ? 0 : top + .05; line.depth = below ? -top + .05 : 0;
    line.setStyle('position', 'relative'); line.setStyle('display', 'inline-block');
    const y1 = line.height - edge, y2 = line.height - top;
    line.svgOverlay = '<path d="M ' + start + ' ' + y1 + ' V ' + y2 + ' H ' + (start + width) + ' V ' + y1 + '" fill="none" stroke="currentColor" stroke-width=".05"/>';
    const box = new Box(line, { type: 'ignore' });
    box.width = 0; box.setStyle('display', 'inline-block');
    return box;
  }
  define(['contraction', 'acontraction', 'bcontraction', 'acontracted', 'bcontracted'], '[height:string]{prefix:balanced-string}{left:balanced-string}{middle:balanced-string}{right:balanced-string}', {
    createAtom: t => new Atom({ ...t, type: 'mord', captureSelection: !t.command.endsWith('contracted'),
      body: t.command.endsWith('contracted') ? t.args.slice(1).map(part => new Atom({ type: 'group', body: parse(part) })) : undefined }),
    serialize: (t, options) => t.command + (t.args[0] ? '[' + t.args[0] + ']' : '') + (t.body ? t.body.filter(x => x.type !== 'first').map(x => x.bodyToLatex(options)) : t.args.slice(1)).map(x => '{' + x + '}').join('') + t.supsubToLatex(options),
    render: (t, parent) => {
      const context = new Context({ parent }, t.style);
      try {
        const parts = t.body ? t.body.filter(x => x.type !== 'first').map(x => x.bodyToLatex({})) : t.args.slice(1);
        const line = overlay(context, parts, VTWick.dimension(t.args[0]), t.command.startsWith('\\b'));
        const body = t.body ? Atom.createBox(context, t.body) : null;
        return finish(t, context, new Box([line, body], { type: body ? 'ord' : 'ignore' }));
      } catch (_) { return finish(t, context, new Box('?', { classes: 'ML__error' })); }
    },
  });
  define('vtwickmark', '{level:string}{body:math}', {
    createAtom: t => Object.assign(new Atom({ ...t, type: 'group', body: atoms(t.args[1]) }), { verbatimLatex: null }),
    serialize: (t, options) => '\\c' + t.args[0] + '{' + t.bodyToLatex(options) + '}',
  });
  define('wick', '[options:string]{body:string}', {
    parse: parser => {
      const options = parser.scanOptionalArgument('string');
      const raw = parser.scanArgument('balanced-string') || '';
      const marked = raw.replace(/\\c(?![a-zA-Z])([0-9]?)/g, (_, n) => n === '0' ? '' : '\\vtwickmark{' + (n || '1') + '}');
      return [options, parse(marked, { context: parser.context, style: parser.style })];
    },
    createAtom: t => new Atom({ ...t, type: 'mord', body: atoms(t.args[1]) }),
    serialize: (t, options) => '\\wick' + (t.args[0] ? '[' + t.args[0] + ']' : '') + '{' + t.bodyToLatex(options) + '}' + t.supsubToLatex(options),
    render: (t, parent) => {
      const context = new Context({ parent }, t.style);
      const body = Atom.createBox(context, t.body) || new Box(null);
      try {
        const parsed = VTWick.parse(t.bodyToLatex({})), opts = VTWick.options(t.args[0]);
        const lines = parsed.pairs.map(pair => {
          const left = measured(context, pair.left), right = measured(context, pair.right);
          const height = Math.max(.05, opts.offset + pair.level * opts.sep - Math.max(left.height, right.height) - .215);
          return overlay(context, [pair.prefix, pair.left, pair.middle, pair.right], height);
        });
        return finish(t, context, new Box([...lines, body], { type: 'ord' }));
      } catch (_) { body.classes += ' ML__error'; return finish(t, context, body); }
    },
  });
  define('nomathglue', '{body:math}', { createAtom: t => new Atom({ ...t, type: 'mord', body: atoms(t.args[0]) }) });
};
