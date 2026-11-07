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
    // In the canvas, each line meets the center of the box it is drawn from, wherever the browser
    // draws it (accents, scripts, spacing): [LaTeX, lines, a glyph each end is centered on].
    for (const [latex, count, glyphs] of [
      ['\\wick{\\c1{\\bar\\psi}\\c1{\\bar\\psi}}', 3],
      ['\\wick{\\c1{\\psi(x)}\\c2{\\bar\\psi(y)}\\c2{\\psi(z)}\\c1{\\bar\\psi(w)}}', 6],
      ['\\wick{\\c1 a + \\c1 b}', 3, ['a', 'b']],
      ['\\wick{\\c{\\phi_1}\\c{\\phi_2^\\dagger}}', 3],
      ['\\wick{\\c a\\c b}', 3, ['a', 'b']],
      ['\\wick{\\c1 \\psi^\\dagger \\c1 a_p}', 3, ['ψ', 'a']],
      ['\\contraction{}{\\psi}{(x)}{\\bar\\psi}\\psi(x)\\bar\\psi(y)', 3],
      ['\\acontracted{}{A}{+}{B}', 3, ['A', 'B']],
      ['\\bcontracted{}{A}{BC}{D}', 3, ['A', 'D']],
    ]) {
      await set(latex);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await state(), latex);
      const drawn = await page.evaluate(() => {
        const root = document.querySelector('math-field').shadowRoot;
        const center = element => { const r = element.getBoundingClientRect(); return (r.left + r.right) / 2; };
        const em = parseFloat(getComputedStyle(root.querySelector('.ML__content')).fontSize);
        const glyph = text => [...root.querySelectorAll('.ML__content span')].find(span => !span.children.length && span.textContent === text);
        return { error: !!root.querySelector('.ML__error'), em, middle: glyph('A') && (r => (r.top + r.bottom) / 2)(glyph('A').getBoundingClientRect()),
          plus: glyph('+') && [glyph('a') ?? glyph('A'), glyph('+'), glyph('b') ?? glyph('B')].map(span => span.getBoundingClientRect()),
          lines: [...root.querySelectorAll('[data-vt-line]')].map(line => {
            const [from, to, dx0, dx1] = line.dataset.vtLine.split(' ');
            const r = line.getBoundingClientRect(), anchor = id => root.querySelector(`[data-vt-anchor="${id}"]`);
            return { visible: getComputedStyle(line).visibility === 'visible', left: r.left, right: r.right, top: r.top,
              from: anchor(from) && center(anchor(from)) + dx0 * em, to: anchor(to) && center(anchor(to)) + dx1 * em };
          }),
          glyphs: Object.fromEntries(['a', 'b', 'A', 'B', 'D', 'ψ'].map(text => [text, glyph(text) && center(glyph(text))])) };
      });
      assert.ok(!drawn.error, latex);
      assert.equal(drawn.lines.length, count, latex);
      for (const line of drawn.lines) {
        assert.ok(line.visible && Math.abs(line.left - line.from) < 1 && Math.abs(line.right - line.to) < 1, latex);
      }
      if (glyphs) {
        const xs = drawn.lines.flatMap(line => [line.left, line.right]);
        for (const text of glyphs) assert.ok(xs.some(x => Math.abs(x - drawn.glyphs[text]) < .12 * drawn.em), latex + ' at ' + text);
      }
      if (drawn.plus) assert.ok(drawn.plus[1].left - drawn.plus[0].right > .15 * drawn.em && drawn.plus[2].left - drawn.plus[1].right > .15 * drawn.em, latex + ': binary spacing');
      if (latex.startsWith('\\bcontracted')) assert.ok(drawn.lines.every(line => line.top > drawn.middle), latex + ': below');
    }
    // A slash is centered on its argument as the browser draws it, and takes no room beside it.
    for (const latex of ['a\\slashed{\\bar\\psi}b', 'a\\slashed{\\vec{k}}b', 'a\\slashed{\\frac{x}{y}}b', 'a\\slashed{p}b']) {
      await set(latex);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const drawn = await page.evaluate(() => {
        const root = document.querySelector('math-field').shadowRoot;
        const glyphs = element => [...element.querySelectorAll('span')].filter(span => !span.children.length && span.textContent.trim());
        const slashed = root.querySelector('.VT__slashed'), slash = root.querySelector('.VT__slash');
        const argument = glyphs(slashed).filter(span => span !== slash).map(span => span.getBoundingClientRect());
        return { slash: slash.getBoundingClientRect().left, left: Math.min(...argument.map(r => r.left)), right: Math.max(...argument.map(r => r.right)),
          after: glyphs(root).find(span => span.textContent === 'b').getBoundingClientRect().left,
          em: parseFloat(getComputedStyle(root.querySelector('.ML__content')).fontSize) };
      });
      // The slash, a glyph half an em wide, starts where it is placed.
      assert.ok(Math.abs(drawn.slash + drawn.em / 4 - (drawn.left + drawn.right) / 2) < .05 * drawn.em, latex + ': centered');
      assert.ok(drawn.after - drawn.right < .2 * drawn.em, latex + ': width');
    }
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
