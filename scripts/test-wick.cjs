// Pure syntax tests: node scripts/test-wick.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync('Sources/VisualTypist/Resources/Web/wick.js', 'utf8'), sandbox);
const { parse, options, dimension, pair } = sandbox.window.VTWick;
const crossed = parse('\\c1 A\\c2 B\\c1 C\\c2 D');
assert.equal(crossed.body, '{A}{B}{C}{D}');
// Values from the sandbox are compared as JSON: their arrays have its prototypes.
const json = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(json(crossed.ends.map(end => [end.level, end.start, end.end])), [[1, 0, 3], [2, 3, 6], [1, 6, 9], [2, 9, 12]]);
assert.deepEqual(json(pair([1, 2, 1, 2])), [{ level: 1, left: 0, right: 2 }, { level: 2, left: 1, right: 3 }]);
assert.equal(parse('\\c1 \\psi^\\dagger \\c1 a_p').body, '{\\psi}^\\dagger {a}_p');
assert.equal(crossed.pairs[0].middle, '{B}');
assert.equal(crossed.pairs[1].prefix, '{A}');
assert.equal(crossed.pairs[1].middle, '{C}');
assert.equal(parse('\\c{\\psi(x)} \\c{\\bar{\\psi}(y)}').pairs[0].right, '\\bar{\\psi}(y)');
assert.equal(parse('\\cos x+\\c0 A').body, '\\cos x+ A');
assert.equal(parse('\\c1{\\{x\\}}\\c1 y').pairs[0].left, '\\{x\\}');
assert.equal(parse('\\c1 A\\c1 B\\c1 C\\c1 D').pairs.length, 2);
assert.equal(options('sep=4pt,offset=1.2em').sep, .4);
assert.equal(dimension('2ex'), .862);
// Unpaired labels, unclosed or missing endpoints, endpoints inside a group.
for (const input of ['\\c1 A', '\\c1{A', '\\c1', '{\\c1 A}\\c1 B', '\\frac{\\c1 a}{b}\\c1 c']) assert.throws(() => parse(input));
for (const input of ['sep=oops', 'other=1em', 'sep=-1pt']) assert.throws(() => options(input));
console.log('Wick syntax tests passed');
