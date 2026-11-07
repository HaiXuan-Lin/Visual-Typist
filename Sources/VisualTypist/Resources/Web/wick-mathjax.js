'use strict';
// Wick contractions in MathJax. The parser lays out the expression and, for MathML, each line as a
// bracket over phantoms of what precedes it; the SVG output draws the lines as the packages do,
// from where the endpoints are (see VTInstallWickSVG).
(() => {
  /** The endpoint of \wick that a node of its expression is, if any: the node, or the base of its scripts. */
  const wickEnd = node => node.getProperty('vtWickEnd') ? node
    : node.isKind('msubsup') && node.childNodes[0]?.getProperty('vtWickEnd') ? node.childNodes[0] : null;

  window.VTInstallWickMathJax = () => {
    const { CommandMap } = MathJax._.input.tex.SymbolMap;
    const { Configuration } = MathJax._.input.tex.Configuration;
    const TexParser = MathJax._.input.tex.TexParser.default;
    const TexError = MathJax._.input.tex.TexError.default;
    const parse = (parser, latex) => new TexParser(latex, parser.stack.env, parser.configuration).mml();
    const row = (parser, nodes) => parser.create('node', 'mrow', nodes.filter(Boolean));
    /** The lines for MathML, which the SVG output leaves out. */
    const overlay = (parser, latex) => {
      const node = row(parser, [parse(parser, latex)]);
      node.setProperty('vtLinesOverlay', true);
      return node;
    };
    const methods = {
      Half(parser, name) {
        const body = parse(parser, parser.GetArgument(name));
        const phantom = parser.create('node', 'mphantom', [body]);
        parser.Push(parser.create('node', 'mpadded', [phantom], { width: '50%' }));
      },
      Contraction(parser, name) {
        const height = VTWick.dimension(parser.GetBrackets(name, '1ex'));
        const parts = Array.from({ length: 4 }, () => parser.GetArgument(name));
        const [prefix, left, middle, right] = parts;
        const below = name.startsWith('\\b');
        const bracket = below ? '\\underbracket' : '\\overbracket';
        const span = '\\vtwickhalf{' + left + '}\\hphantom{' + middle + '}\\vtwickhalf{' + right + '}';
        const lines = overlay(parser, '\\rlap{\\hphantom{' + prefix + '}\\vtwickhalf{' + left + '}' + bracket + '[.05em][' + height + 'em]{' + span + '}}');
        // The arguments as one expression; \contraction's unseen, taking no room, as the line is
        // drawn over what follows it.
        const shown = name.endsWith('contracted');
        const args = parts.map(part => shown ? row(parser, [parse(parser, part)]) : parser.create('node', 'mphantom', [row(parser, [parse(parser, part)])]));
        const contraction = row(parser, [lines, ...args]);
        contraction.setProperty('vtContraction', { height, below });
        parser.Push(shown ? contraction : parser.create('node', 'mpadded', [contraction], { width: '0' }));
      },
      Wick(parser, name) {
        const opts = VTWick.options(parser.GetBrackets(name, ''));
        const { body, ends, pairs } = VTWick.parse(parser.GetArgument(name));
        // The standard package's offset is measured from the baseline. A strut sets that baseline
        // independently of the endpoint glyphs before drawing the bracket.
        const lines = overlay(parser, pairs.map(pair => {
          const height = opts.offset + pair.level * opts.sep;
          const prefix = '\\hphantom{' + pair.prefix + '}\\vtwickhalf{' + pair.left + '}';
          const span = '\\vtwickhalf{' + pair.left + '}\\hphantom{' + pair.middle + '}\\vtwickhalf{' + pair.right + '}';
          return '\\rlap{' + prefix + '\\overbracket[.05em][.3em]{\\smash{' + span + '}\\rule{0pt}{' + Math.max(0, height - .3) + 'em}}}';
        }).join(''));
        const content = parse(parser, ends.reduceRight((latex, end) => latex.slice(0, end.start) + '\\vtwickend' + latex.slice(end.start), body));
        const wick = row(parser, [lines, content]);
        // Endpoints are elements of the expression (\left…\right, say, would take them in).
        if (wick.childNodes.filter(wickEnd).length !== ends.length) {
          throw new TexError('WickEndpoint', 'Wick endpoints must not be inside a group.');
        }
        wick.setProperty('vtWick', { ...opts, pairs: VTWick.pair(ends.map(end => end.level)) });
        parser.Push(wick);
        // The package ends with an empty atom, which takes scripts written after \wick{…}.
        parser.Push(parser.create('node', 'TeXAtom', [], { texClass: 0 }));
      },
      // An endpoint of \wick: a box of its own, as the package's TikZ node.
      WickEnd(parser, name) {
        const end = parser.create('node', 'TeXAtom', [row(parser, [parse(parser, parser.GetArgument(name))])], { texClass: 0 });
        end.setProperty('vtWickEnd', true);
        parser.Push(end);
      },
      Identity(parser, name) { parser.Push(parse(parser, parser.GetArgument(name))); },
    };
    new CommandMap('vt-wick', { contraction: 'Contraction', acontraction: 'Contraction', bcontraction: 'Contraction',
      acontracted: 'Contraction', bcontracted: 'Contraction', wick: 'Wick', vtwickend: 'WickEnd', vtwickhalf: 'Half', nomathglue: 'Identity' }, methods);
    Configuration.create('vt-wick', { handler: { macro: ['vt-wick'] }, priority: 1 });
    MathJax.config.tex.packages.push('vt-wick');
  };

  /**
   * Draws the lines in the SVG output as the packages do. simpler-wick: each leg from 3pt above its
   * endpoint (not its scripts) to the bar, offset + level·sep above the baseline. simplewick: legs
   * from half an ex above the left endpoint (or below the baseline), a rule wide, the left one
   * starting at that endpoint's center, the right one past the other's.
   */
  window.VTInstallWickSVG = () => {
    const factory = MathJax.startup.output.factory;
    const { line, gap } = VTWick.WICK;
    const { rule, ex } = VTWick.SIMPLE;
    class LinesRow extends factory.getNodeClass('mrow') {
      /** Each child with where it is placed (em), as MathJax places the children of a row. */
      placed() {
        let x = 0;
        return this.childNodes.map(child => {
          const box = child.getOuterBBox();
          const at = x + box.L * box.rscale;
          x += (box.L + box.w + box.R) * box.rscale;
          return { child, box, x: at };
        }).filter(({ child }) => !child.node.getProperty('vtLinesOverlay'));
      }
      /** The rules to draw: [x0, x1, y0, y1] in em, y up from the baseline. */
      lines() {
        const wick = this.node.getProperty('vtWick'), contraction = this.node.getProperty('vtContraction');
        if (contraction) {
          const [, left, , right] = this.placed();
          const [c1, c2] = [left, right].map(({ box, x }) => x + box.w * box.rscale / 2);
          const near = contraction.below ? -ex / 2 : left.box.h * left.box.rscale + ex / 2;
          const far = contraction.below ? near - contraction.height : near + contraction.height;
          const bar = contraction.below ? far + rule : far - rule;
          return [[c1, c1 + rule, near, far], [c1, c2 + 2 * rule, bar, far], [c2 + rule, c2 + 2 * rule, near, far]];
        }
        if (!wick) return [];
        const ends = this.placed().flatMap(({ child, box, x }) => {
          const node = wickEnd(child.node);
          if (!node) return [];
          const end = node === child.node ? child : child.childNodes[0];
          const own = end.getOuterBBox(), scale = box.rscale * (end === child ? 1 : own.rscale);
          return [{ x: x + ((end === child ? 0 : own.L) + own.w / 2) * scale, h: own.h * scale }];
        });
        return wick.pairs.flatMap(({ level, left, right }) => {
          const [a, b] = [ends[left], ends[right]], y = wick.offset + level * wick.sep;
          return [[a.x - line / 2, a.x + line / 2, a.h + gap, y + line / 2], [a.x - line / 2, b.x + line / 2, y - line / 2, y + line / 2],
            [b.x - line / 2, b.x + line / 2, b.h + gap, y + line / 2]];
        });
      }
      computeBBox(bbox, recompute) {
        super.computeBBox(bbox, recompute);
        for (const [, , y0, y1] of this.lines()) {
          bbox.h = Math.max(bbox.h, y0, y1);
          bbox.d = Math.max(bbox.d, -y0, -y1);
        }
      }
      addChildren(parent) {
        if (!this.node.getProperty('vtWick') && !this.node.getProperty('vtContraction')) return super.addChildren(parent);
        for (const { child, x } of this.placed()) {
          child.toSVG(parent);
          if (child.element) child.place(x, 0);
        }
        for (const [x0, x1, y0, y1] of this.lines()) {
          this.adaptor.append(parent, this.svg('rect', { x: this.fixed(x0), y: this.fixed(Math.min(y0, y1)),
            width: this.fixed(x1 - x0), height: this.fixed(Math.abs(y1 - y0)) }));
        }
      }
    }
    factory.setNodeClass('mrow', LinesRow);
  };
})();
