// Run against scripts/build-site.sh output. See README for dependencies and invocation.
const { chromium } = require(process.env.VT_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const out = process.env.VT_TEST_OUTPUT || '/tmp/visual-typist-browser';
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    ...(process.env.VT_CHROME ? { executablePath: process.env.VT_CHROME } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.VT_TEST_URL || 'http://127.0.0.1:8765');
    await page.waitForFunction(() => window.vt);
    await page.evaluate(() => vt.ready);
    const set = latex => page.evaluate(x => vt.setState({ latex: x }), latex);
    const state = () => page.evaluate(() => vt.getState().latex);
    const exported = async name => {
      const result = await page.evaluate(() => vt.exportSVG());
      assert.ok(result.width > 0 && result.height > 0);
      assert.ok(!result.svg.includes('merror') && !result.mathml.includes('merror'));
      fs.writeFileSync(path.join(out, name + '.svg'), result.svg);
      return result;
    };
    // Dimensions above MathLive's default ten-column limit; all delimiters and maximum size.
    for (const [rows, cols, kind] of [[1,1,'matrix'],[3,12,'bmatrix'],[20,20,'pmatrix'],[2,3,'Bmatrix'],[2,3,'vmatrix'],[2,3,'Vmatrix']]) {
      await set(''); await page.locator('[data-id="custom-matrix"]').click();
      await page.locator('#matrix-rows').fill(String(rows)); await page.locator('#matrix-cols').fill(String(cols));
      await page.locator('#matrix-kind').selectOption(kind); await page.locator('#matrix-form button[type=submit]').click();
      const actual = await page.evaluate(() => {
        const atom = document.querySelector('math-field')._mathfield.model.root.children.find(x => x.type === 'array');
        return [atom.rowCount, atom.colCount];
      });
      assert.deepEqual(actual, [rows, cols]); await exported('matrix-' + kind);
    }
    await set('x'); await page.locator('[data-id="custom-matrix"]').click();
    await page.locator('#matrix-rows').fill('21'); await page.locator('#matrix-form button[type=submit]').click();
    assert.equal(await page.locator('#matrix-dialog').evaluate(x => x.open), true);
    await page.keyboard.press('Escape'); assert.equal(await state(), 'x');
    await set(''); await page.locator('[data-id="custom-matrix"]').click();
    await page.locator('#matrix-rows').fill('3');await page.locator('#matrix-cols').fill('12');
    await page.locator('#matrix-kind').selectOption('bmatrix');await page.locator('#matrix-form button[type=submit]').click();
    await page.keyboard.type('a');await page.keyboard.press('Tab');await page.waitForTimeout(80);await page.keyboard.type('b');await page.keyboard.press('Tab');await page.waitForTimeout(80);
    assert.match(await state(), /a & b &/);
    await page.screenshot({path:path.join(out,'matrix.png')});
    // All user-facing physics templates contain real editable endpoint/operand slots.
    for (const [id, values, pattern] of [
      ['wick',['A','B'], /\\wick\{\\c1\{A\}\\c1\{B\}\}/],
      ['wick-crossed',['A','B','C','D'], /\\c2\{D\}/],
      ['acontracted',['A','B'], /\\acontracted\{\}\{A\}\{\}\{B\}/],
      ['bcontracted',['A','B'], /\\bcontracted\{\}\{A\}\{\}\{B\}/],
      ['slashed',['p'], /\\slashed\{p\}/],
    ]) {
      await set('');await page.locator('[data-id="'+id+'"]').click();
      for (const value of values) { await page.keyboard.type(value); await page.keyboard.press('Tab');await page.waitForTimeout(80); }
      assert.match(await state(), pattern, id);
      assert.ok(!(await state()).includes('vtwickmark'));
      await exported('template-' + id);
      const final = await state(); await page.evaluate(()=>vt.command('undo')); await page.evaluate(()=>vt.command('redo'));
      assert.equal(await state(), final);
    }
    const samples = [
      '\\wick[sep=4pt,offset=1.2em]{\\c1{\\psi(x)}\\c2{\\bar\\psi(y)}\\c2{\\psi(z)}\\c1{\\bar\\psi(w)}}',
      '\\contraction[2ex]{}{A}{BC}{D}\\bcontraction{A}{B}{}{C}ABCD',
      '\\slashed{p}+\\slashed{D}+\\slashed{\\partial}+\\slashed{k}+\\slashed{f}',
      '\\frac{\\slashed{p}+m}{p^2-m^2}+A_{\\slashed{k}}+B^{\\slashed{q}}',
    ];
    for (const [index, latex] of samples.entries()) {
      await set(latex);
      assert.deepEqual(await page.evaluate(()=>document.querySelector('math-field').errors), []);
      await exported('physics-' + index);
      await page.screenshot({path:path.join(out,'physics-' + index + '.png')});
    }
    await set('\\wick{\\c1 A}');
    assert.equal(await page.evaluate(()=>vt.exportSVG().then(()=>false,()=>true)), true);
    // Download a real standalone document through the same UI used in the browser edition.
    await set(samples.join('\n'));
    await page.locator('#export-button').click();
    const download = page.waitForEvent('download');await page.locator('[data-format="latex"]').click();
    const file = await download;await file.saveAs(path.join(out,'Equation.tex'));
    const tex = fs.readFileSync(path.join(out,'Equation.tex'),'utf8');
    for (const name of ['simplewick','simpler-wick','slashed']) assert.ok(tex.includes(name));
    await exported('combined');
    await page.evaluate(()=>vt.setTheme('dark'));await page.screenshot({path:path.join(out,'dark.png')});
    assert.deepEqual(errors, []);
    // Inspect the exported image independently of the editor canvas.
    const svg = fs.readFileSync(path.join(out,'physics-2.svg'));
    await page.setContent('<body style="padding:40px;background:white"><img width="800" src="data:image/svg+xml;base64,'+svg.toString('base64')+'"></body>');
    await page.screenshot({path:path.join(out,'slashed-export.png')});
    console.log('Browser checks passed: matrices, limits, cancellation, Tab, undo/redo, Wick/slashed editing, SVG/MathML and LaTeX download. Artifacts: ' + out);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
