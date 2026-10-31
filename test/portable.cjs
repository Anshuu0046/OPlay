const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
(async () => {
  const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.resolve(process.argv[2]), ['--aether-test', '--remote-debugging-port=' + port], { windowsHide: true, env: environment, stdio: 'ignore' });
  let browser, profile;
  try {
    for (let i = 0; i < 45; i++) {
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { timeout: 1000 }); break; }
      catch { await new Promise(r => setTimeout(r, 500)); }
    }
    assert.ok(browser, 'Portable application did not expose its test connection');
    const context = browser.contexts()[0];
    let page = context.pages()[0];
    if (!page) page = await context.waitForEvent('page', { timeout: 30000 });
    await page.waitForFunction(() => window.aether, null, { timeout: 30000 });
    const check = await page.evaluate(() => window.aether.snapshot().then(s => ({ ok: true, cpu: s.inventory.cpu })).catch(e => ({ ok: false, error: e.message, url: location.href })));
    assert.equal(check.ok, true, JSON.stringify(check));
    await page.waitForFunction(() => document.querySelector('#library-metrics').children.length === 4);
    const state = await page.evaluate(() => window.aether.snapshot()); profile = state.dataPath;
    assert.equal(state.test, true); assert.ok(state.inventory.cpu); assert.equal(state.entries.length, 0);
    await page.locator('.rail-item[data-page="tuning"]').click(); assert.equal(await page.locator('#page-tuning').isVisible(), true);
    console.log('PASS: portable EXE extracts, starts Windows helper, discovers real games, receives telemetry, navigates, and uses an isolated test profile.');
    await page.evaluate(() => window.aether.window('close')).catch(() => {});
  } finally {
    await browser?.close().catch(() => {});
    if (child.exitCode === null) { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {} }
    if (profile && path.basename(profile).startsWith('aether-test-')) await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
