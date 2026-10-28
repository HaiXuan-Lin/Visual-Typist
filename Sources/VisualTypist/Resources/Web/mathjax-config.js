'use strict';
// MathJax renders palette glyphs and all exports (SVG, PNG, PDF, MathML).
// tex-svg-full bundles every package and font below, so nothing is fetched at runtime.
window.MathJax = {
  startup: {
    typeset: false,
    // MathJax 3.2 writes \grave with U+0060, which its TeX fonts draw as the opening quote ‘ (TeX's
    // grave accent is another glyph of the font): \grave uses the grave accent U+02CB instead.
    ready() {
      const { CommandMap } = MathJax._.input.tex.SymbolMap;
      const { Configuration } = MathJax._.input.tex.Configuration;
      new CommandMap('vt-accents', { grave: ['Accent', '02CB'] }, MathJax._.input.tex.base.BaseMethods.default);
      Configuration.create('vt-accents', { handler: { macro: ['vt-accents'] }, priority: 1 });
      MathJax.config.tex.packages.push('vt-accents');
      MathJax.startup.defaultReady();
    },
  },
  loader: { paths: { mathjax: new URL('vendor/mathjax', document.baseURI).href } },
  tex: {
    packages: ['base', 'ams', 'newcommand', 'configmacros', 'cancel', 'color', 'bbox', 'braket',
      'mathtools', 'mhchem', 'cases', 'upgreek', 'unicode', 'textmacros', 'textcomp', 'boldsymbol',
      'empheq', 'extpfeil', 'gensymb', 'colortbl'],
    // An empty slot: the light-blue block the editor shows.
    macros: {
      placeholder: ['{\\color[rgb]{0.71,0.85,0.97}{\\rule[-0.05em]{0.42em}{0.68em}}}', 1],
      vtraw: ['\\mathrm{#1}', 1], // Raw text left in the equation: literal, upright text.
    },
    maxBuffer: 100000,
    maxMacros: 10000,
    formatError: (_jax, error) => { throw new Error(error.message); },
  },
  svg: { fontCache: 'none' },
  options: {
    enableMenu: false,
    enableAssistiveMml: false,
    compileError: (_doc, _math, error) => { throw new Error(error.message); },
  },
};
