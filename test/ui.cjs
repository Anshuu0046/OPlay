const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
async function main() {
  const target = process.argv[2];
  const launch = target ? { executablePath: path.resolve(target), args: ['--aether-test'] } : { args: [path.resolve(__dirname, '..'), '--aether-test'] };
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ ...launch, timeout: 60000, env: environment });
  let page, profile; const errors = [];
  try {
    page = await app.firstWindow({ timeout: 60000 });
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => document.querySelector('#device-name').textContent !== 'Your PC', { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('#library-metrics').children.length === 4, { timeout: 30000 });
    const state = await page.evaluate(() => window.aether.snapshot()); profile = state.dataPath;
    assert.equal(state.test, true); assert.ok(state.inventory.cpu); assert.ok(state.inventory.ram > 0);
    assert.equal(await page.evaluate(() => typeof require), 'undefined');
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]; const p = w.webContents.getLastWebPreferences();
      return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
    });
    assert.deepEqual(prefs, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    const hwnd = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
    if (Number(require('node:os').release().split('.')[2]) >= 22621) {
      const material = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', path.join(__dirname, 'material.ps1'), hwnd], { windowsHide: true, encoding: 'utf8' }));
      assert.equal(material.result, 0); assert.equal(material.material, 3, 'DWM should use native Acrylic');
    }
    console.log('Hardware:', state.inventory.model, '| Games:', state.games.length, '| Supported clock entries:', state.supportedClocks.length);
    await page.locator('#search').fill('___nothing_matches___'); assert.equal(await page.locator('.game-card').count(), 0);
    await page.locator('#search').fill(''); assert.equal(await page.locator('.game-card').count(), state.games.length);
    await page.locator('[data-collection="optimized"]').click();
    assert.equal(await page.locator('.game-card').count(), state.games.filter(g => g.optimized).length);
    await page.locator('[data-collection="all"]').click();
    assert.equal(await page.locator('.game-card').count(), state.games.length);
    if (state.games.length) assert.ok((await page.locator('#featured-game').innerText()).includes(([...state.games].sort((a,b)=>(b.lastLaunched||'').localeCompare(a.lastLaunched||'')||Number(!!b.hero)-Number(!!a.hero))[0]).name));
    if (state.games.length) {
      await page.locator('.game-art').first().press('Enter'); assert.equal(await page.locator('#game-dialog').evaluate(e => e.open), true);
      assert.equal(await page.locator('#game-dialog .game-route').count(), 4);
      assert.ok((await page.locator('#game-install-status').innerText()).includes('No OPlay graphics package installed'));
      assert.equal(await page.locator('#game-dialog [data-game-action="optimize"],#game-dialog [data-game-action="undo"]').count(), 1);
      assert.equal(await page.locator('#game-dialog [data-game-action="test"]').count(), 1);
      await page.screenshot({path:path.resolve(__dirname,'../../../outputs/OPlay-game-actions-preview.png')});
      await page.keyboard.press('Escape');
    }
    await page.locator('.rail-item[data-page="components"]').click();
    assert.equal(await page.locator('#page-components').isVisible(), true);
    assert.equal(await page.locator('.compatibility-card').count(), 6);
    assert.equal(await page.locator('#force-runtime-install').isVisible(), true);
    assert.equal(await page.locator('#force-runtime-install').isDisabled(), true, 'No runtime is cached in the isolated profile');
    assert.equal(await page.locator('#unlocked-install').isVisible(), true);
    assert.ok((await page.locator('#component-installed').innerText()).includes('No OPlay graphics package installed'));
    assert.equal(await page.locator('[data-action="component-test-launch"]').count(), 1);
    if(state.games.length)assert.deepEqual((await page.evaluate(id=>window.aether.components('status',{gameId:id}),state.games[0].id)).installations,[]);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('component-progress',{label:'DLSS Unlocked test package',phase:'downloading',received:5242880,total:10485760}));
    await page.waitForSelector('#download-tray:not([hidden])');
    assert.equal(await page.locator('#download-percent').innerText(),'50%');
    assert.ok((await page.locator('#download-detail').innerText()).includes('5.0 of 10.0 MB'));
    await page.screenshot({path:path.resolve(__dirname,'../../../outputs/OPlay-download-preview.png')});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('component-progress',{phase:'complete'}));
    await page.waitForFunction(()=>document.querySelector('#download-percent').textContent==='Done');
    await page.evaluate(()=>document.querySelector('#download-tray').hidden=true);
    await page.locator('#game-picker-trigger').click();
    assert.equal(await page.locator('#game-picker-menu').isVisible(), true);
    assert.equal(await page.locator('.game-picker-option').count(), state.games.length);
    await page.screenshot({path:path.resolve(__dirname,'../../../outputs/OPlay-game-picker-preview.png')});
    await page.locator('.game-picker-option').last().click();
    assert.equal(await page.locator('#game-picker-menu').isVisible(), false);
    assert.equal(await page.locator('#component-game').inputValue(), state.games.at(-1).id);
    await page.evaluate(id=>{state.components.launchTests=[{gameId:id,finishedAt:'2026-11-01T15:14:22Z',outcome:'crashed',crash:{at:'2026-11-01T15:14:22Z',app:'Game.exe',module:'KERNELBASE.dll',code:'c00000fd'},rollback:'restored',baseline:{outcome:'launched'},guidance:'A graphics proxy conflict is likely.'}];renderStudio();},state.games.at(-1).id);
    assert.match(await page.locator('#component-launch-test').innerText(),/Windows crash recorded.*KERNELBASE.dll.*0xc00000fd.*Second check: launched/s);
    await page.screenshot({path:path.resolve(__dirname,'../../../outputs/OPlay-launch-diagnosis-preview.png')});
    await page.evaluate(()=>renderState(state));
    assert.match(await page.locator('#launch-history').innerText(),/Game launch checks.*KERNELBASE.dll.*0xc00000fd/s);
    await page.locator('#game-picker-trigger').focus(); await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#game-picker-menu').isVisible(), true);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#game-picker-menu').isVisible(), false);
    await page.locator('[data-studio-view="downloads"]').click();
    assert.equal(await page.locator('#studio-downloads').isVisible(), true);
    assert.equal(await page.locator('.package-card').count(), 2);
    await page.locator('[data-studio-view="compatibility"]').click();
    assert.equal(await page.locator('#studio-compatibility').isVisible(), true);
    await page.locator('#page-components').evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
    await page.evaluate(()=>document.querySelector('#toast').classList.remove('visible'));
    await page.screenshot({path:path.resolve(__dirname,'../../../outputs/OPlay-graphics-preview.png'),fullPage:true});
    await page.locator('[data-studio-view="games"]').click();
    await page.locator('#page-components').evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
    await page.screenshot({path:path.resolve(__dirname,'../../../outputs/OPlay-graphics-profiles-preview.png'),fullPage:true});
    await assert.rejects(page.evaluate(()=>window.aether.components('swap',{gameId:'invalid'})), /disabled in test mode/);
    await assert.rejects(page.evaluate(()=>window.aether.components('unlocked',{gameId:'invalid'})), /disabled in test mode/);
    await assert.rejects(page.evaluate(()=>window.aether.components('force-runtime',{gameId:'invalid'})), /disabled in test mode/);
    await page.locator('[data-action="theme"]').click();
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await page.locator('.rail-item[data-page="library"]').click();
    await page.locator('#page-library').evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
    await page.evaluate(()=>document.querySelector('#toast').classList.remove('visible'));
    await page.screenshot({path:path.resolve(__dirname,'../../../outputs/OPlay-light-preview.png'),fullPage:true});
    await page.locator('[data-action="theme"]').click();
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    const controlsHit = await page.evaluate(() => ['minimize','maximize','close'].map(action=>{const el=document.querySelector(`[data-window="${action}"]`),r=el.getBoundingClientRect();return {action,hit:document.elementFromPoint(r.left+r.width/2,2)?.closest('[data-window]')?.dataset.window};}));
    assert.ok(controlsHit.every(x=>x.action===x.hit),'Top-edge window controls must be the pointer target');
    const maximize=page.locator('[data-window="maximize"]');const box=await maximize.boundingBox();
    await page.mouse.click(box.x+box.width/2,2);
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized()),true);
    const restoredBox=await maximize.boundingBox();await page.mouse.click(restoredBox.x+restoredBox.width/2,2);
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized()),false);
    const minimizeBox=await page.locator('[data-window="minimize"]').boundingBox();await page.mouse.click(minimizeBox.x+minimizeBox.width/2,2);
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMinimized()),true);
    await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.restore();win.show();win.focus();});
    // Exercise the requested hold-and-drag gesture across the glass selector.
    await page.locator('.rail-nav').scrollIntoViewIfNeeded();
    const from = await page.locator('.rail-item[data-page="library"]').boundingBox(), to = await page.locator('.rail-item[data-page="tuning"]').boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 }); await page.mouse.up();
    assert.equal(await page.locator('#page-tuning').isVisible(), true);
    if (state.gpuOffsets?.curve?.available) {
      assert.equal(await page.locator('#curve-graph polyline').count(), 1);
      assert.ok((await page.locator('#curve-status').innerText()).includes(state.gpuOffsets.curve.points.length + ' driver curve points'));
      assert.equal(await page.locator('#curve-apply').isDisabled(), true, 'Curve writes require the elevated helper');
      assert.ok(Number(await page.locator('#curve-frequency').inputValue()) % 15 === 0);
    }
    await assert.rejects(page.evaluate(() => window.aether.gpuCurve({millivolts:850,megahertz:1500})), /disabled in test mode/);
    await page.locator('.rail-item[data-page="tuning"]').focus(); await page.keyboard.press('ArrowUp'); assert.equal(await page.locator('#page-optimize').isVisible(), true);
    await page.locator('[data-action="global"]').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('disabled in test mode'));
    const after = await page.evaluate(() => window.aether.snapshot()); assert.equal(after.entries.length, 0); assert.equal(after.guard, false);
    await page.locator('.rail-item[data-page="library"]').click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.rail-pill').evaluate(e => getComputedStyle(e).transitionDuration), '0s');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('#toast').classList.remove('visible'); });
    await page.locator('#toast').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
    await page.locator('#page-library').evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))));
    await fs.mkdir(path.resolve(__dirname, '../../../outputs'), { recursive: true });
    await page.screenshot({ path: path.resolve(__dirname, '../../../outputs/OPlay-preview.png'), fullPage: true });
    // Use a test backdrop so native translucency can be inspected without exposing other desktop apps.
    const nativePreview = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
      const main = BrowserWindow.getAllWindows()[0]; const b = main.getBounds();
      const backdrop = new BrowserWindow({ ...b, frame: false, skipTaskbar: true, webPreferences: { sandbox: true, nodeIntegration: false } });
      await backdrop.loadURL('data:text/html,' + encodeURIComponent('<body style="margin:0;background:linear-gradient(125deg,#536b8e 0%,#566d70 35%,#8c705c 65%,#354e6d 100%);height:100vh"></body>'));
      main.show(); main.focus(); await new Promise(r => setTimeout(r, 500));
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1800, height: 1200 } });
      const source = sources.find(s => s.id === main.getMediaSourceId());
      return { data: source?.thumbnail.toDataURL(), bounds: b, backdropId: backdrop.id };
    });
    if (nativePreview?.data) {
      const scale = await page.evaluate(() => devicePixelRatio);
      const b = nativePreview.bounds;
      try {
        execFileSync('powershell.exe', ['-NoProfile', '-File', path.join(__dirname, 'capture.ps1'), String(Math.round(b.x * scale)), String(Math.round(b.y * scale)), String(Math.round(b.width * scale)), String(Math.round(b.height * scale)), path.resolve(__dirname, '../../../outputs/OPlay-native-glass-preview.png')], { windowsHide: true });
      } catch (e) { if(e.status!==20)throw e; console.log('Native screenshot skipped while Windows secure desktop is active.'); }
      finally { await app.evaluate(({ BrowserWindow }, id) => { BrowserWindow.fromId(id)?.destroy(); }, nativePreview.backdropId); }
    }
    await page.locator('.rail-item[data-page="optimize"]').click();
    await page.locator('#page-optimize').evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))));
    await page.screenshot({ path: path.resolve(__dirname, '../../../outputs/OPlay-optimize-preview.png'), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false);
    await page.setViewportSize({ width: 1040, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('.rail-item[data-page="components"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    // Deliberately inject failures only after asserting the normal UI has no errors.
    await page.evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'Aether injected renderer failure', error: Error('Aether injected renderer failure') }));
      window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: Error('Aether injected rejection') }));
    });
    const logFile = path.join(state.logPath, 'errors.jsonl');
    for (let i = 0; i < 30; i++) {
      const content = await fs.readFile(logFile, 'utf8').catch(() => '');
      if (content.includes('Aether injected rejection')) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const logs = (await fs.readFile(logFile, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(logs.some(e => e.source === 'operation:global' && /disabled in test mode/.test(e.message)));
    assert.ok(logs.some(e => e.source === 'renderer-error' && e.message.includes('Aether injected renderer failure')));
    assert.ok(logs.some(e => e.source === 'renderer-rejection' && e.message.includes('Aether injected rejection')));
    await assert.rejects(page.evaluate(() => window.aether.reportError({ source: 'invalid', message: 'bad' })), /Invalid error report/);
    console.log('PASS: rejected operations, renderer errors and unhandled rejections are logged automatically; invalid reports rejected.');
    console.log('PASS: real discovery, telemetry, sandbox, search, dialog, drag tabs, keyboard, guarded mutations, reduced motion, layouts.');
  } finally {
    await app.close();
    if (profile && path.basename(profile).startsWith('aether-test-')) await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
