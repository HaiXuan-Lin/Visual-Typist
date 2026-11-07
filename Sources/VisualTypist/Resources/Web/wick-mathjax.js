'use strict';
window.VTInstallWickMathJax = () => {
  const { CommandMap } = MathJax._.input.tex.SymbolMap;
  const { Configuration } = MathJax._.input.tex.Configuration;
  const TexParser = MathJax._.input.tex.TexParser.default;
  const parse = (parser, latex) => new TexParser(latex, parser.stack.env, parser.configuration).mml();
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
      const bracket = name.startsWith('\\b') ? '\\underbracket' : '\\overbracket';
      const span = '\\vtwickhalf{' + left + '}\\hphantom{' + middle + '}\\vtwickhalf{' + right + '}';
      const latex = '\\rlap{\\hphantom{' + prefix + '}\\vtwickhalf{' + left + '}' + bracket + '[.05em][' + height + 'em]{' + span + '}}' + (name.endsWith('contracted') ? parts.join('') : '');
      parser.Push(parse(parser, latex));
    },
    Wick(parser, name) {
      const opts = VTWick.options(parser.GetBrackets(name, ''));
      const { body, pairs } = VTWick.parse(parser.GetArgument(name));
      // The standard package's offset is measured from the baseline. A strut sets that baseline
      // independently of the endpoint glyphs before drawing the bracket.
      const lines = pairs.map(pair => {
        const height = opts.offset + pair.level * opts.sep;
        const prefix = '\\hphantom{' + pair.prefix + '}\\vtwickhalf{' + pair.left + '}';
        const span = '\\vtwickhalf{' + pair.left + '}\\hphantom{' + pair.middle + '}\\vtwickhalf{' + pair.right + '}';
        return '\\rlap{' + prefix + '\\overbracket[.05em][.3em]{\\smash{' + span + '}\\rule{0pt}{' + Math.max(0, height - .3) + 'em}}}';
      }).join('');
      parser.Push(parse(parser, lines + body));
    },
    Identity(parser, name) { parser.Push(parse(parser, parser.GetArgument(name))); },
  };
  new CommandMap('vt-wick', { contraction: 'Contraction', acontraction: 'Contraction', bcontraction: 'Contraction',
    acontracted: 'Contraction', bcontracted: 'Contraction', wick: 'Wick', vtwickhalf: 'Half', nomathglue: 'Identity' }, methods);
  Configuration.create('vt-wick', { handler: { macro: ['vt-wick'] }, priority: 1 });
  MathJax.config.tex.packages.push('vt-wick');
};
