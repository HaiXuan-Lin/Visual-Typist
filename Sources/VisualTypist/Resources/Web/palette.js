'use strict';
// Symbol palette. Each item is [id, latex] or [id, latex, options].
//
// In `latex`, #0 is the current selection (or the first empty slot), #1, #2… are further
// slots and #@ is the selection or the atom before the caret. Categories with size 'large' show
// bigger tiles with display-style glyphs. A leading ^ or _ attaches the
// script to the atom before the caret. `options.preview` overrides the button glyph.

(() => {
  const symbols = names => names.map(name => [name, `\\${name}`]);

  window.VT_PALETTE = [
    {
      id: 'greek', title: 'Greek Letters', icon: '\\alpha\\beta\\Delta\\Omega', tint: 'blue',
      items: symbols([
        'alpha', 'beta', 'chi', 'delta', 'epsilon', 'varepsilon', 'phi', 'varphi', 'gamma', 'eta',
        'iota', 'kappa', 'lambda', 'mu', 'nu', 'pi', 'varpi', 'theta', 'vartheta', 'rho',
        'varrho', 'sigma', 'varsigma', 'tau', 'upsilon', 'omega', 'xi', 'psi', 'zeta', 'Delta',
        'Phi', 'Gamma', 'Lambda', 'Pi', 'Theta', 'Sigma', 'Omega', 'Xi', 'Psi', 'Upsilon',
      ]),
    },
    {
      id: 'structures', title: 'Fractions, Roots & Scripts', icon: '\\sqrt{\\square}\\,\\tfrac{\\square}{\\square}', tint: 'rose',
      items: [
        ['sqrt', '\\sqrt{#0}'],
        ['root', '\\sqrt[#1]{#0}'],
        ['frac', '\\frac{#0}{#1}'],
        ['tfrac', '\\tfrac{#0}{#1}'],
        ['slash-frac', '{#0}/{#1}'],
        ['cfrac', '\\cfrac{#0}{#1}'],
        ['binom', '\\binom{#0}{#1}'],
        ['superscript', '^{#0}', { preview: '\\placeholder{}^{\\placeholder{}}' }],
        ['subscript', '_{#0}', { preview: '\\placeholder{}_{\\placeholder{}}' }],
        ['subsup', '_{#?}^{#0}', { caret: 'upper', preview: '\\placeholder{}_{\\placeholder{}}^{\\placeholder{}}' }],
        ['prescript', '{}_{#1}^{#2}{#0}', { preview: '{}_{\\placeholder{}}^{\\placeholder{}}\\placeholder{}' }],
        ['overset', '\\overset{#1}{#0}'],
        ['underset', '\\underset{#1}{#0}'],
        ['stackrel', '\\stackrel{#1}{#0}'],
        ['text', '\\text{#0}', { preview: '\\text{abc}' }],
        ['boxed', '\\boxed{#0}'],
      ],
    },
    {
      id: 'operators', title: 'Operators', icon: '\\pm\\times\\div', tint: 'green',
      items: [
        ['plus', '+'], ['minus', '-'], ...symbols(['pm', 'mp', 'times', 'div', 'cdot', 'circ', 'ast', 'star',
          'oplus', 'ominus', 'otimes', 'odot', 'bullet', 'dagger', 'wedge', 'vee', 'cap', 'cup',
          'setminus', 'angle', 'measuredangle', 'triangle', 'square', 'diamond', 'bigcirc',
          'cdots', 'ldots', 'vdots', 'ddots', 'therefore', 'because']),
        ['degree', '#@^{\\circ}', { preview: '\\placeholder{}^{\\circ}' }],
      ],
    },
    {
      id: 'relations', title: 'Relations', icon: '=\\le\\approx', tint: 'green',
      items: [
        ['equals', '='], ['less', '<'], ['greater', '>'],
        ...symbols(['ne', 'le', 'ge', 'leqslant', 'geqslant', 'll', 'gg', 'equiv', 'approx', 'sim',
          'simeq', 'cong', 'propto', 'prec', 'succ', 'preceq', 'succeq', 'perp', 'parallel', 'mid',
          'in', 'notin', 'ni', 'subset', 'supset', 'subseteq', 'supseteq', 'nsubseteq', 'forall',
          'exists', 'nexists', 'neg', 'land', 'lor', 'vdash', 'models']),
        ['defined-as', '\\coloneqq', { preview: '\\coloneqq' }],
        ['triangleq', '\\triangleq'],
        ['equals-label', '\\overset{#0}{=}'],
      ],
    },
    {
      id: 'symbols', title: 'Symbols & Fonts', icon: '\\partial\\infty\\mathbb{R}', tint: 'amber',
      items: [
        ...symbols(['partial', 'infty', 'nabla', 'hbar', 'ell', 'Re', 'Im', 'wp', 'aleph', 'emptyset']),
        ['varnothing', '\\varnothing'],
        ['prime', "'", { preview: "f'" }],
        ['double-prime', "''", { preview: "f''" }],
        ['differential', '\\mathrm{d}', { preview: '\\mathrm{d}' }],
        ['imaginary', '\\mathrm{i}', { preview: '\\mathrm{i}' }],
        ['euler', '\\mathrm{e}', { preview: '\\mathrm{e}' }],
        ['reals', '\\mathbb{R}'], ['complexes', '\\mathbb{C}'], ['integers', '\\mathbb{Z}'],
        ['naturals', '\\mathbb{N}'], ['rationals', '\\mathbb{Q}'],
        ['mathbb', '\\mathbb{#0}', { preview: '\\mathbb{A}' }],
        ['mathcal', '\\mathcal{#0}', { preview: '\\mathcal{A}' }],
        ['mathscr', '\\mathscr{#0}', { preview: '\\mathscr{A}' }],
        ['mathfrak', '\\mathfrak{#0}', { preview: '\\mathfrak{A}' }],
        ['mathrm', '\\mathrm{#0}', { preview: '\\mathrm{Ab}' }],
        ['mathbf', '\\mathbf{#0}', { preview: '\\mathbf{Ab}' }],
        ['boldsymbol', '\\boldsymbol{#0}', { preview: '\\boldsymbol{\\alpha}' }],
        ['mathsf', '\\mathsf{#0}', { preview: '\\mathsf{Ab}' }],
        ['mathtt', '\\mathtt{#0}', { preview: '\\mathtt{Ab}' }],
      ],
    },
    {
      id: 'accents', title: 'Accents', icon: '\\hat{a}\\,\\ddot{a}\\,\\tilde{a}', tint: 'rose',
      items: [
        ...['hat', 'check', 'tilde', 'bar', 'vec', 'dot', 'ddot', 'dddot', 'acute', 'grave', 'breve',
          'mathring', 'widehat', 'widetilde', 'overline', 'underline', 'overrightarrow', 'overleftarrow',
          'overleftrightarrow', 'underrightarrow', 'underleftarrow']
          .map(name => [name, `\\${name}{#0}`, { accent: true }]),
      ],
    },
    {
      id: 'braces', title: 'Over & Under', icon: '\\overbrace{\\square\\,\\square}', tint: 'rose', size: 'large',
      items: [
        ['overbrace', '\\overbrace{#0}^{#1}'],
        ['underbrace', '\\underbrace{#0}_{#1}'],
        ['overbrace-plain', '\\overbrace{#0}'],
        ['underbrace-plain', '\\underbrace{#0}'],
        ['overline-label', '\\overline{#0}'],
        ['cancel', '\\cancel{#0}'],
        ['bcancel', '\\bcancel{#0}'],
        ['xcancel', '\\xcancel{#0}'],
      ],
    },
    {
      id: 'brackets', title: 'Brackets', icon: '(\\,)\\,[\\,]\\,\\{\\,\\}', tint: 'violet',
      items: [
        ['parens', '\\left( #0 \\right)'],
        ['brackets', '\\left[ #0 \\right]'],
        ['curly', '\\left\\{ #0 \\right\\}'],
        ['abs', '\\left| #0 \\right|'],
        ['norm', '\\left\\| #0 \\right\\|'],
        ['angles', '\\left\\langle #0 \\right\\rangle'],
        ['floor', '\\left\\lfloor #0 \\right\\rfloor'],
        ['ceil', '\\left\\lceil #0 \\right\\rceil'],
        ['bra', '\\left\\langle #0 \\right|'],
        ['ket', '\\left| #0 \\right\\rangle'],
        ['braket', '\\left\\langle #0 \\middle| #1 \\right\\rangle'],
        ['braket-op', '\\left\\langle #0 \\middle| #1 \\middle| #2 \\right\\rangle'],
        ['paren-mid', '\\left( #0 \\middle| #1 \\right)'],
        ['set-builder', '\\left\\{ #0 \\middle| #1 \\right\\}'],
        ['half-open-right', '\\left[ #0 \\right)'],
        ['half-open-left', '\\left( #0 \\right]'],
        ['left-curly', '\\left\\{ #0 \\right.'],
        ['eval-bar', '\\left. #0 \\right|_{#1}^{#2}'],
      ],
    },
    {
      id: 'integrals', title: 'Integrals', icon: '\\int\\!\\oint\\!\\iint', tint: 'violet', size: 'large',
      items: [
        ['int', '\\int'], ['iint', '\\iint'], ['iiint', '\\iiint'], ['oint', '\\oint'],
        ['int-limits', '\\int_{#?}^{#?}{#0}', { caret: 'lower', caretWithSelection: 'lower' }],
        ['int-full', '\\int_{#?}^{#?}{#0}\\,\\mathrm{d}#?', { caret: 'lower', caretWithSelection: 'lower' }],
        ['int-indefinite', '\\int #0 \\,\\mathrm{d}#1'],
        ['iint-region', '\\iint_{#?}{#0}\\,\\mathrm{d}A', { caret: 'lower', caretWithSelection: 'lower' }],
        ['iiint-region', '\\iiint_{#?}{#0}\\,\\mathrm{d}V', { caret: 'lower', caretWithSelection: 'lower' }],
        ['oint-contour', '\\oint_{#?}{#0}\\,\\mathrm{d}#?', { caret: 'lower', caretWithSelection: 'lower' }],
        ['derivative', '\\frac{\\mathrm{d}#0}{\\mathrm{d}#1}'],
        ['partial-derivative', '\\frac{\\partial #0}{\\partial #1}'],
        ['second-derivative', '\\frac{\\mathrm{d}^2 #0}{\\mathrm{d}#1^2}'],
        ['partial-2', '\\frac{\\partial^2 #0}{\\partial #1 \\partial #2}'],
      ],
    },
    {
      id: 'bigops', title: 'Large Operators', icon: '\\textstyle\\sum\\prod\\bigcup', tint: 'violet', size: 'large',
      items: [
        ['sum', '\\sum'], ['prod', '\\prod'],
        ['sum-limits', '\\sum_{#0}^{#?}{#?}', { caret: 'lower', caretWithSelection: 'operand' }],
        ['prod-limits', '\\prod_{#0}^{#?}{#?}', { caret: 'lower', caretWithSelection: 'operand' }],
        ['sum-sub', '\\sum_{#0}{#?}', { caret: 'lower', caretWithSelection: 'operand' }],
        ['coprod-limits', '\\coprod_{#0}^{#?}{#?}', { caret: 'lower', caretWithSelection: 'operand' }],
        ['bigcup-limits', '\\bigcup_{#0}^{#?}{#?}', { caret: 'lower', caretWithSelection: 'operand' }],
        ['bigcap-limits', '\\bigcap_{#0}^{#?}{#?}', { caret: 'lower', caretWithSelection: 'operand' }],
        ['bigoplus-limits', '\\bigoplus_{#0}^{#?}{#?}', { caret: 'lower', caretWithSelection: 'operand' }],
        ['bigotimes-limits', '\\bigotimes_{#0}^{#?}{#?}', { caret: 'lower', caretWithSelection: 'operand' }],
        ['lim', '\\lim_{#1 \\to #2} #0'],
        ['max', '\\max_{#1} #0'],
        ['min', '\\min_{#1} #0'],
        ['sup', '\\sup_{#1} #0'],
        ['inf', '\\inf_{#1} #0'],
      ],
    },
    {
      id: 'functions', title: 'Functions', icon: '\\sin\\,\\log', tint: 'violet',
      items: [
        ...symbols(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'ln', 'log', 'exp', 'det']),
        ['log-base', '\\log_{#1} #0'],
        ['arcsin', '\\arcsin'], ['arccos', '\\arccos'], ['arctan', '\\arctan'],
        ['sinh', '\\sinh'], ['cosh', '\\cosh'], ['tanh', '\\tanh'],
      ],
    },
    {
      id: 'matrices', size: 'large', title: 'Matrices & Arrays', icon: '\\left(\\begin{smallmatrix}\\square&\\square\\\\\\square&\\square\\end{smallmatrix}\\right)', tint: 'amber',
      items: [
        ['pmatrix', '\\begin{pmatrix} #0 & #1 \\\\ #2 & #3 \\end{pmatrix}'],
        ['bmatrix', '\\begin{bmatrix} #0 & #1 \\\\ #2 & #3 \\end{bmatrix}'],
        ['vmatrix', '\\begin{vmatrix} #0 & #1 \\\\ #2 & #3 \\end{vmatrix}'],
        ['Vmatrix', '\\begin{Vmatrix} #0 & #1 \\\\ #2 & #3 \\end{Vmatrix}'],
        ['Bmatrix', '\\begin{Bmatrix} #0 & #1 \\\\ #2 & #3 \\end{Bmatrix}'],
        ['matrix', '\\begin{matrix} #0 & #1 \\\\ #2 & #3 \\end{matrix}'],
        ['pmatrix-3', '\\begin{pmatrix} #0 & #1 & #2 \\\\ #3 & #4 & #5 \\\\ #6 & #7 & #8 \\end{pmatrix}'],
        ['bmatrix-3', '\\begin{bmatrix} #0 & #1 & #2 \\\\ #3 & #4 & #5 \\\\ #6 & #7 & #8 \\end{bmatrix}'],
        ['column-2', '\\begin{pmatrix} #0 \\\\ #1 \\end{pmatrix}'],
        ['column-3', '\\begin{pmatrix} #0 \\\\ #1 \\\\ #2 \\end{pmatrix}'],
        ['row-3', '\\begin{pmatrix} #0 & #1 & #2 \\end{pmatrix}'],
        ['general-matrix', '\\begin{pmatrix} a_{11} & \\cdots & a_{1n} \\\\ \\vdots & \\ddots & \\vdots \\\\ a_{m1} & \\cdots & a_{mn} \\end{pmatrix}'],
        ['cases', '\\begin{cases} #0 & #1 \\\\ #2 & #3 \\end{cases}'],
        ['cases-3', '\\begin{cases} #0 & #1 \\\\ #2 & #3 \\\\ #4 & #5 \\end{cases}'],
        ['aligned', '\\begin{aligned} #0 &= #1 \\\\ #2 &= #3 \\end{aligned}'],
        ['gathered', '\\begin{gathered} #0 \\\\ #1 \\end{gathered}'],
      ],
    },
    {
      id: 'arrows', title: 'Arrows', icon: '\\to\\,\\Rightarrow', tint: 'green',
      items: [
        ...symbols(['to', 'gets', 'leftrightarrow', 'Rightarrow', 'Leftarrow', 'Leftrightarrow', 'mapsto',
          'uparrow', 'downarrow', 'updownarrow', 'Uparrow', 'Downarrow', 'longrightarrow', 'longleftarrow',
          'Longrightarrow', 'Longleftarrow', 'Longleftrightarrow', 'longmapsto', 'hookrightarrow',
          'hookleftarrow', 'rightleftharpoons', 'rightharpoonup', 'leftharpoonup', 'nearrow', 'searrow',
          'nwarrow', 'swarrow', 'implies', 'iff', 'leadsto']),
        ['xrightarrow', '\\xrightarrow{#0}'],
        ['xleftarrow', '\\xleftarrow{#0}'],
        ['xrightarrow-both', '\\xrightarrow[#1]{#0}'],
        ['xRightarrow', '\\xRightarrow{#0}'],
      ],
    },
  ];

  // Mark default ids so shortcuts can refer to them; ids are unique across categories.
  const seen = new Set();
  for (const category of window.VT_PALETTE) {
    category.items = category.items.map(([id, latex, options = {}]) => {
      if (seen.has(id)) throw new Error(`Duplicate palette id: ${id}`);
      seen.add(id);
      return { id, latex, category: category.id, ...options };
    });
  }
})();

// Further commands offered when typing \name (the palette items are offered too).
window.VT_COMMANDS = [
  // Letters and symbols
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega', 'digamma',
  'imath', 'jmath', 'hbar', 'hslash', 'ell', 'wp', 'Re', 'Im', 'aleph', 'beth', 'gimel', 'partial', 'nabla',
  'infty', 'emptyset', 'varnothing', 'prime', 'backprime', 'top', 'bot', 'angle', 'measuredangle',
  'sphericalangle', 'triangle', 'square', 'blacksquare', 'lozenge', 'star', 'bigstar', 'dagger', 'ddagger',
  'clubsuit', 'diamondsuit', 'heartsuit', 'spadesuit', 'flat', 'natural', 'sharp', 'checkmark', 'circledR',
  'degree', 'backslash', 'surd', 'complement',
  // Operators
  'pm', 'mp', 'times', 'div', 'cdot', 'ast', 'circ', 'bullet', 'oplus', 'ominus', 'otimes', 'oslash', 'odot',
  'cap', 'cup', 'sqcap', 'sqcup', 'uplus', 'wedge', 'vee', 'setminus', 'wr', 'amalg', 'ltimes', 'rtimes',
  'boxplus', 'boxminus', 'boxtimes', 'boxdot', 'dotplus', 'divideontimes', 'intercal', 'barwedge',
  // Relations
  'le', 'leq', 'ge', 'geq', 'ne', 'neq', 'leqslant', 'geqslant', 'll', 'gg', 'lll', 'ggg', 'equiv', 'approx',
  'approxeq', 'sim', 'simeq', 'cong', 'doteq', 'propto', 'prec', 'succ', 'preceq', 'succeq', 'perp', 'parallel',
  'nparallel', 'mid', 'nmid', 'in', 'notin', 'ni', 'subset', 'supset', 'subseteq', 'supseteq', 'subsetneq',
  'supsetneq', 'sqsubseteq', 'sqsupseteq', 'vdash', 'dashv', 'models', 'vDash', 'asymp', 'bowtie', 'smile',
  'frown', 'lesssim', 'gtrsim', 'nless', 'ngtr', 'nleq', 'ngeq', 'nsim', 'ncong', 'coloneqq', 'triangleq',
  'therefore', 'because', 'multimap',
  // Logic
  'forall', 'exists', 'nexists', 'neg', 'lnot', 'land', 'lor', 'implies', 'impliedby', 'iff',
  // Arrows
  'to', 'gets', 'leftarrow', 'rightarrow', 'leftrightarrow', 'Leftarrow', 'Rightarrow', 'Leftrightarrow',
  'longleftarrow', 'longrightarrow', 'longleftrightarrow', 'Longleftarrow', 'Longrightarrow', 'Longleftrightarrow',
  'uparrow', 'downarrow', 'updownarrow', 'Uparrow', 'Downarrow', 'Updownarrow', 'mapsto', 'longmapsto',
  'hookleftarrow', 'hookrightarrow', 'nearrow', 'searrow', 'swarrow', 'nwarrow', 'leftharpoonup',
  'rightharpoonup', 'leftharpoondown', 'rightharpoondown', 'rightleftharpoons', 'leftrightarrows',
  'rightleftarrows', 'twoheadrightarrow', 'rightsquigarrow', 'leadsto', 'circlearrowleft', 'circlearrowright',
  // Delimiters and dots
  'langle', 'rangle', 'lfloor', 'rfloor', 'lceil', 'rceil', 'vert', 'Vert', 'lvert', 'rvert', 'lVert', 'rVert',
  'ldots', 'cdots', 'vdots', 'ddots', 'dots',
  // Large operators and functions
  'sum', 'prod', 'coprod', 'int', 'iint', 'iiint', 'oint', 'bigcup', 'bigcap', 'bigsqcup', 'bigvee', 'bigwedge',
  'bigoplus', 'bigotimes', 'bigodot', 'biguplus', 'lim', 'limsup', 'liminf', 'max', 'min', 'sup', 'inf', 'arg',
  'det', 'dim', 'exp', 'gcd', 'hom', 'ker', 'deg', 'Pr', 'log', 'lg', 'ln', 'sin', 'cos', 'tan', 'cot', 'sec',
  'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth',
  // Spacing
  'quad', 'qquad',
];

// Further commands that classic equation editors accept.
window.VT_COMMANDS.push(
  'Bbbk', 'Box', 'Bumpeq', 'Cap', 'Cup', 'Diamond', 'Join', 'Lleftarrow', 'Lsh', 'Rrightarrow', 'Rsh', 'Subset',
  'Supset', 'Vdash', 'Vvdash', 'backepsilon', 'backsim', 'backsimeq', 'bigtriangledown', 'bigtriangleup',
  'blacklozenge', 'blacktriangle', 'blacktriangledown', 'blacktriangleleft', 'blacktriangleright', 'bmod',
  'bumpeq', 'centerdot', 'circeq', 'circledS', 'circledast', 'circledcirc', 'circleddash', 'colon',
  'curlyeqprec', 'curlyeqsucc', 'curlyvee', 'curlywedge', 'curvearrowleft', 'curvearrowright', 'daleth',
  'dashleftarrow', 'dashrightarrow', 'diagdown', 'diagup', 'doteqdot', 'dotsb', 'dotsc', 'dotsi', 'dotsm',
  'doublebarwedge', 'doublecap', 'doublecup', 'downdownarrows', 'downharpoonright', 'enspace', 'eqcirc',
  'eqqcolon', 'eqsim', 'eqslantgtr', 'eqslantless', 'eth', 'fallingdotseq', 'geqq', 'gnapprox', 'gneq', 'gneqq',
  'gnsim', 'gtrapprox', 'gtrdot', 'gtreqless', 'gtreqqless', 'gtrless', 'gvertneqq', 'iiiint', 'lbrace',
  'lbrack', 'leftarrowtail', 'leftleftarrows', 'leftrightharpoons', 'leftrightsquigarrow', 'leftthreetimes',
  'leqq', 'lessapprox', 'lessdot', 'lesseqgtr', 'lesseqqgtr', 'lessgtr', 'lhd', 'lnapprox', 'lneq', 'lneqq',
  'lnsim', 'looparrowleft', 'looparrowright', 'lvertneqq', 'maltese', 'mho', 'nLeftarrow', 'nLeftrightarrow',
  'nRightarrow', 'nVDash', 'nVdash', 'negthinspace', 'ngeqq', 'ngeqslant', 'nleftarrow', 'nleftrightarrow',
  'nleqq', 'nleqslant', 'nonumber', 'not', 'nprec', 'npreceq', 'nrightarrow', 'nshortmid', 'nshortparallel',
  'nsubseteqq', 'nsucc', 'nsucceq', 'nsupseteq', 'nsupseteqq', 'ntriangleleft', 'ntrianglelefteq',
  'ntriangleright', 'ntrianglerighteq', 'nvDash', 'nvdash', 'owns', 'pitchfork', 'precapprox', 'preccurlyeq',
  'precnapprox', 'precneqq', 'precnsim', 'precsim', 'rbrace', 'rbrack', 'rhd', 'rightarrowtail',
  'rightrightarrows', 'rightthreetimes', 'risingdotseq', 'shortmid', 'shortparallel', 'small', 'smallfrown',
  'smallint', 'smallsetminus', 'smallsmile', 'sqsubset', 'sqsupset', 'subseteqq', 'subsetneqq', 'succapprox',
  'succcurlyeq', 'succnapprox', 'succneqq', 'succnsim', 'succsim', 'supseteqq', 'supsetneqq', 'textperthousand',
  'thickapprox', 'thicksim', 'thinspace', 'triangledown', 'triangleleft', 'trianglelefteq', 'triangleright',
  'trianglerighteq', 'twoheadleftarrow', 'unlhd', 'unrhd', 'upharpoonleft', 'upharpoonright', 'upuparrows',
  'varDelta', 'varGamma', 'varLambda', 'varOmega', 'varPhi', 'varPi', 'varPsi', 'varSigma', 'varTheta',
  'varUpsilon', 'varXi', 'varinjlim', 'varkappa', 'varliminf', 'varlimsup', 'varprojlim', 'varpropto',
  'varsubsetneq', 'varsubsetneqq', 'varsupsetneq', 'varsupsetneqq', 'vartriangle', 'vartriangleleft',
  'vartriangleright', 'veebar',
);

// Commands with arguments, offered as templates (#0 is the first slot, #? the next one).
window.VT_COMMAND_TEMPLATES = [
  '\\dfrac{#0}{#?}', '\\tfrac{#0}{#?}', '\\textbf{#0}', '\\textit{#0}', '\\textrm{#0}', '\\textsf{#0}',
  '\\texttt{#0}', '\\textup{#0}', '\\mathit{#0}', '\\mathnormal{#0}', '\\mbox{#0}', '\\operatorname{#0}',
  '\\mathop{#0}', '\\mathrel{#0}', '\\mathord{#0}', '\\phantom{#0}', '\\hphantom{#0}', '\\vphantom{#0}',
  '\\pmod{#0}', '\\pod{#0}', '\\pmb{#0}', '\\xleftrightarrow{#0}', '\\xLeftarrow{#0}', '\\xLeftrightarrow{#0}',
  '\\overbracket{#0}', '\\underbracket{#0}', '\\underleftrightarrow{#0}', '\\ddddot{#0}', '\\mod{#0}',
];

// Commands ranked first among equally good matches (the most common ones).
window.VT_COMMON_COMMANDS = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'theta', 'lambda', 'mu', 'pi', 'sigma', 'phi',
  'varphi', 'omega', 'frac', 'sqrt', 'sum', 'int', 'infty', 'partial', 'prime', 'mathcal', 'mathbb', 'mathrm',
  'cdot', 'times', 'pm', 'le', 'ge', 'ne', 'approx', 'to', 'hat', 'bar', 'vec', 'dot', 'nabla', 'lim', 'left',
  'right', 'otimes', 'oplus', 'in', 'subset', 'forall', 'exists', 'rightarrow', 'Rightarrow', 'ldots', 'cdots',
];
