'use strict';
// MathJax renders palette glyphs and all exports (SVG, PNG, PDF, MathML).
// tex-svg-full bundles every package and font below, so nothing is fetched at runtime.
window.MathJax = {
  startup: { typeset: false },
  loader: { paths: { mathjax: new URL('vendor/mathjax', document.baseURI).href } },
  tex: {
    packages: ['base', 'ams', 'newcommand', 'configmacros', 'cancel', 'color', 'bbox', 'braket',
      'mathtools', 'mhchem', 'cases', 'upgreek', 'unicode', 'textmacros', 'textcomp', 'boldsymbol',
      'empheq', 'extpfeil', 'gensymb', 'colortbl'],
    macros: { placeholder: ['{\\color[rgb]{0.6,0.64,0.68}{\\square}}', 1] },
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
