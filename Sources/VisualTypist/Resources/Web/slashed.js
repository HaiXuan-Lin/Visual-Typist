'use strict';
// The slashed package overlays a font glyph, centered on the argument's bounding box.
// These are its Computer Modern adjustments, in fractions of the argument's width.
window.VTSlash = {
  adjustment(latex) {
    return ({ D: [.08, 0], A: [.1, 0], k: [0, -.05], '\\partial': [.1, 0], f: [-.6, 0] })[latex.trim()] || [0, 0];
  },
  geometry(base, slash, adjustment) {
    // TeX's special negation glyph has zero advance; MathJax's replacement U+29F8 does not.
    if (adjustment[0] === -.6) slash = { ...slash, w: 0 };
    const width = Math.max(base.w, slash.w);
    const x = (width - slash.w) / 2 + adjustment[0] * base.w;
    const y = (base.h - base.d - slash.h + slash.d) / 2 + adjustment[1] * (slash.h + slash.d);
    return { width, x, y, baseX: (width - base.w) / 2,
      height: Math.max(base.h, slash.h + y), depth: Math.max(base.d, slash.d - y) };
  },
};
window.VTInstallSlashedMathLive = ({ define, Atom, Box, Context, atoms }) => {
  define('slashed', '{body:math}', {
    createAtom: t => new Atom({ ...t, type: 'mord', body: atoms(t.args[0]) }),
    render: (atom, parent) => {
      const context = new Context({ parent }, atom.style);
      const body = Atom.createBox(context, atom.body) || new Box(null);
      const latex = atom.bodyToLatex({});
      const slash = new Box(latex === 'f' ? 0xE020 : '/', { fontFamily: 'Main-Regular', classes: 'VT__slash ML__cmr' });
      const g = VTSlash.geometry({ w: body.width, h: body.height, d: body.depth },
        { w: slash.width, h: slash.height, d: slash.depth }, VTSlash.adjustment(latex));
      slash.setStyle('position', 'relative'); slash.setStyle('left', g.x, 'em'); slash.setStyle('top', -g.y, 'em');
      slash.setStyle('pointer-events', 'none');
      const overlay = new Box(slash, { type: 'ignore' });
      overlay.width = 0; overlay.setStyle('display', 'inline-block');
      body.left = g.baseX;
      const box = new Box([overlay, body], { type: 'ord', classes: 'VT__slashed' });
      box.width = g.width; box.height = g.height; box.depth = g.depth;
      if (atom.caret) box.caret = atom.caret;
      return atom.bind(context, atom.attachSupsub(context, { base: box }).wrap(context));
    },
  });
};
window.VTInstallSlashedMathJax = () => {
  const { CommandMap } = MathJax._.input.tex.SymbolMap;
  const { Configuration } = MathJax._.input.tex.Configuration;
  const TexParser = MathJax._.input.tex.TexParser.default;
  new CommandMap('vt-slashed', { slashed: 'Slashed' }, {
    Slashed(parser, name) {
      const latex = parser.GetArgument(name);
      const parse = source => new TexParser(source, parser.stack.env, parser.configuration).mml();
      const body = parser.create('node', 'mrow', [parse(latex)]), slash = parse(latex.trim() === 'f' ? '\\not' : '/');
      // An overlapping MathML representation, also readable outside our SVG renderer.
      const phantom = parser.create('node', 'mphantom', [parse(latex)]);
      const half = parser.create('node', 'mpadded', [phantom], { width: '50%' });
      const center = parser.create('node', 'mpadded', [slash], { width: '0', lspace: '-50%width' });
      const overlay = parser.create('node', 'mpadded', [parser.create('node', 'mrow', [half, center])], { width: '0' });
      const row = parser.create('node', 'mrow', [overlay, body]);
      row.setProperty('vtSlash', VTSlash.adjustment(latex));
      parser.Push(parser.create('node', 'TeXAtom', [row], { texClass: 0 }));
    },
  });
  Configuration.create('vt-slashed', { handler: { macro: ['vt-slashed'] }, priority: 1 });
  MathJax.config.tex.packages.push('vt-slashed');
};
window.VTInstallSlashedSVG = () => {
  const { SVGmrow } = MathJax._.output.svg.Wrappers.mrow;
  class SlashedRow extends SVGmrow {
    slashParts() {
      const body = this.childNodes[1];
      // mpadded wraps an inferred mrow; locate the actual slash through the centered pad.
      let overlay = this.childNodes[0];
      while (overlay.childNodes.length === 1) overlay = overlay.childNodes[0];
      let slash = overlay.childNodes[1];
      while (slash.childNodes.length === 1 && !['mi', 'mo', 'mn', 'mtext'].includes(slash.node.kind)) slash = slash.childNodes[0];
      const g = VTSlash.geometry(body.getBBox(), slash.getBBox(), this.node.getProperty('vtSlash'));
      return { body, slash, g };
    }
    computeBBox(bbox, recompute) {
      if (!this.node.getProperty('vtSlash')) return super.computeBBox(bbox, recompute);
      const { g } = this.slashParts();
      bbox.empty(); bbox.w = g.width; bbox.h = g.height; bbox.d = g.depth; bbox.clean();
    }
    toSVG(parent) {
      if (!this.node.getProperty('vtSlash')) return super.toSVG(parent);
      const svg = this.standardSVGnode(parent), { body, slash, g } = this.slashParts();
      body.toSVG(svg); body.place(g.baseX, 0);
      slash.toSVG(svg); slash.place(g.x, g.y);
    }
  }
  MathJax.startup.output.factory.setNodeClass('mrow', SlashedRow);
};
