const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, nativeTheme, screen } = require('electron');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const readline = require('node:readline');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { fileURLToPath } = require('node:url');
const { realpathSync } = require('node:fs');
const { idFor, readJson, saveJson, discover, parseGpu, scanFolder } = require('./core.cjs');
const { Journal } = require('./journal.cjs');
const { GpuControl } = require('./gpu-control.cjs');
const { ErrorLog } = require('./error-log.cjs');
const { Components } = require('./components.cjs');
const { observeLaunch, explain, proxyFiles, gameLogHints, graphicsFeatureFindings, watchSince, unseenCrash } = require('./launch-check.cjs');
const exec = promisify(execFile);
const ROOT = __dirname;
const trustedDocument = realpathSync(path.join(ROOT, 'index.html')).toLowerCase();
// Keep the existing library, rollback records and browser profile through the OPlay rename.
app.setPath('userData', path.join(app.getPath('appData'), 'Aether'));
const TEST = process.argv.includes('--aether-test');
if (TEST) app.setPath('userData', path.join(os.tmpdir(), 'aether-test-' + process.pid));
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } });
const errorLog = new ErrorLog(path.join(app.getPath('userData'), 'logs'));
process.on('uncaughtExceptionMonitor', error => errorLog.write('main-crash', error));
process.on('unhandledRejection', error => { errorLog.write('unhandled-rejection', error); app.quit(); });
app.on('child-process-gone', (_event, details) => { if (details.reason !== 'clean-exit') errorLog.write('child-process', JSON.stringify(details)); });
let win, worker, inventory, settings, journal, timer, pending = new Map(), sequence = 0;
let gpu = null, gpuError = null, processes = { top: [], errors: [] }, sampling = false, priorCpu, closing = false;
let supportedClocks = [], queue = Promise.resolve();
let runtimeNotice = '', history = [], cachedCovers = new Map();
let diskQueue = Promise.resolve();
let folderCandidates = new Map();
const gpuControl = new GpuControl(ROOT);
let gpuCapability = null, powerState = null, gpuHeartbeat;
let desktopApps = [];
let vendorScan = null, components, componentQueue = Promise.resolve(), catalogTimer, gameCrashTimer, crashPolling = false;
const smi = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe');
const dataFile = () => path.join(app.getPath('userData'), 'library.json');
function persist() {
  const copy = structuredClone(settings);
  const work = diskQueue.then(() => saveJson(dataFile(), copy));
  diskQueue = work.catch(() => {}); return work;
}
function ask(message) {
  return new Promise((resolve, reject) => {
    if (!worker || worker.exitCode !== null) return reject(Error('Windows helper is unavailable. Restart Aether.'));
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(Error('Windows helper timed out. Restart Aether.')); }, 30000);
    pending.set(id, { resolve, reject, timeout });
    worker.stdin.write(JSON.stringify({ ...message, id }) + '\n');
  });
}
function startWorker() {
  worker = spawn(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'worker.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  readline.createInterface({ input: worker.stdout }).on('line', line => {
    try {
      const r = JSON.parse(line), p = pending.get(r.id);
      if (!p) return;
      clearTimeout(p.timeout); pending.delete(r.id);
      if (r.ok) p.resolve(r.data); else { errorLog.write('windows-helper', r.error); p.reject(Error(r.error)); }
    } catch (error) { runtimeNotice = 'Windows helper returned an unreadable response.'; errorLog.write('helper-protocol', error); }
  });
  const stopped = err => {
    runtimeNotice = err?.message || 'Windows helper stopped. Restart Aether.';
    if (!closing) errorLog.write('helper-stopped', runtimeNotice);
    for (const p of pending.values()) { clearTimeout(p.timeout); p.reject(Error(runtimeNotice)); }
    pending.clear();
  };
  worker.on('error', stopped); worker.on('exit', () => stopped());
  worker.stdin.on('error', stopped);
  worker.stderr.on('data', b => { runtimeNotice = b.toString().slice(0, 400); errorLog.write('helper-stderr', runtimeNotice); });
}
function cpuPercent() {
  const totals = os.cpus().reduce((a, c) => {
    a.idle += c.times.idle; a.total += Object.values(c.times).reduce((x, y) => x + y, 0); return a;
  }, { idle: 0, total: 0 });
  const last = priorCpu; priorCpu = totals;
  return last && totals.total > last.total ? Math.round(100 * (1 - (totals.idle - last.idle) / (totals.total - last.total))) : null;
}
function serialize(fn) {
  const work = queue.then(fn); queue = work.catch(() => {}); return work;
}
function collectProcesses() {
  return serialize(async () => {
    const result = await ask({ action: 'processes', executables: settings.guard && !TEST ? settings.games.filter(g => g.optimized && g.executable).map(g => g.executable) : [] });
    if (result.boosted.length) {
      const known = new Set(settings.boosted.map(x => x.pid + ':' + x.start));
      settings.boosted.push(...result.boosted.filter(x => !known.has(x.pid + ':' + x.start)));
      await persist();
    }
    if (settings.guard) {
      const active = new Set(result.active.map(p => p.pid + ':' + p.start));
      const alive = settings.boosted.filter(p => active.has(p.pid + ':' + p.start));
      if (alive.length !== settings.boosted.length) { settings.boosted = alive; await persist(); }
    }
    return result;
  });
}
async function sample() {
  if (sampling || closing) return;
  sampling = true;
  try {
    const results = await Promise.allSettled([
      exec(smi, ['--id=0', '--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,clocks.gr,clocks.mem,power.draw,power.limit,clocks.max.graphics,clocks_event_reasons.hw_thermal_slowdown', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 3500 }),
      collectProcesses(),
      ask({ action: 'gpu' }),
      ask({ action: 'vendorScan', mode: 'Read' })
    ]);
    if (results[0].status === 'fulfilled') { gpu = parseGpu(results[0].value.stdout); gpuError = null; }
    else { gpu = null; gpuError = 'NVIDIA telemetry unavailable: ' + (results[0].reason.code || results[0].reason.message); }
    if (results[1].status === 'fulfilled') {
      processes = results[1].value;
    } else { processes = { top: [], errors: [results[1].reason.message] }; }
    if (results[2].status === 'fulfilled') gpuCapability = results[2].value;
    if (results[3].status === 'fulfilled') vendorScan = results[3].value;
    for (let i = 0; i < results.length; i++) if (results[i].status === 'rejected') errorLog.write('telemetry-' + i, results[i].reason);
    for (const error of processes.errors || []) errorLog.write('process-sample', error);
    const total = os.totalmem(), used = total - os.freemem();
    const telemetry = { at: Date.now(), cpu: cpuPercent(), total, used, memoryPercent: Math.round(used / total * 100), gpu, gpuError,
      top: processes.top, guard: settings.guard, boosted: settings.boosted.length, active: processes.active || [],
      gpuOffsets: gpuControl.state || gpuCapability, gpuControlEnabled: !!gpuControl.socket, gpuControlError: gpuControl.error,
      vendorScan, errors: processes.errors, notice: runtimeNotice };
    history.push({ cpu: telemetry.cpu, memory: telemetry.memoryPercent, gpu: gpu?.utilization, temperature: gpu?.temperature });
    if (history.length > 40) history.shift();
    telemetry.history = history;
    if (win && !win.isDestroyed()) win.webContents.send('telemetry', telemetry);
    return telemetry;
  } finally { sampling = false; }
}
async function cover(game, kind = 'cover') {
  const key = game.id + ':' + kind;
  if (cachedCovers.has(key)) return cachedCovers.get(key);
  if (game.store !== 'Steam' || !inventory.steam) return null;
  const dir = path.join(inventory.steam, 'appcache', 'librarycache');
  const names = kind === 'hero' ? ['library_hero.jpg', 'library_header.jpg'] : ['library_capsule.jpg', 'library_600x900.jpg'];
  const candidates = names.flatMap(name => [path.join(dir, game.appId + '_' + name.replace('library_', '')), path.join(dir, game.appId, name)]);
  try {
    for (const entry of (await fs.readdir(path.join(dir, game.appId), { withFileTypes: true })).slice(0, 40)) {
      if (entry.isFile() && names.includes(entry.name)) candidates.push(path.join(dir, game.appId, entry.name));
      if (entry.isDirectory() && /^[a-f0-9]{40}$/i.test(entry.name)) {
        for (const name of names) candidates.push(path.join(dir, game.appId, entry.name, name));
      }
    }
  } catch { /* Local artwork is optional. */ }
  for (const file of candidates) {
    try {
      const stat = await fs.stat(file);
      if (stat.size > 6e6) continue;
      const img = nativeImage.createFromPath(file);
      if (!img.isEmpty()) { const value = img.resize({ width: kind === 'hero' ? 1600 : 480 }).toDataURL(); cachedCovers.set(key, value); return value; }
    } catch { /* Try the next local cache layout. */ }
  }
  cachedCovers.set(key, null); return null;
}
async function snapshot() {
  const games = await Promise.all(settings.games.map(async g => ({ ...g, cover: await cover(g), hero: await cover(g, 'hero') })));
  return { inventory, games, theme: settings.theme || 'dark', components: components?.snapshot(), guard: settings.guard, warnings: settings.warnings, entries: journal.entries,
    supportedClocks, clockCap: settings.clockCap || null, gpuOffsets: gpuControl.state || gpuCapability,
    gpuControlEnabled: !!gpuControl.socket, gpuControlError: gpuControl.error, power: powerState,
    vendorScan,
    test: TEST, dataPath: app.getPath('userData'), logPath: errorLog.directory };
}
async function restorePriority() {
  if (!settings.boosted.length) return;
  const result = await ask({ action: 'restorePriority', items: settings.boosted });
  settings.boosted = result.failed || []; await persist();
  if (settings.boosted.length) throw Error('Windows denied priority restoration for ' + settings.boosted.length + ' processes. Recovery records retained; retry after closing the affected game.');
}
async function optimizeGame(g, prompt = true) {
  let exe = g.executable;
  if (!exe && g.installDir) {
    const scan = await scanFolder(g.installDir);
    if (scan.candidates.length === 1) exe = scan.candidates[0].executable;
  }
  if (!exe && prompt) exe = await chooseExe(g);
  if (!exe) return false;
  if (!await fs.stat(exe).then(s => s.isFile()).catch(() => false)) throw Error('Game executable is missing: ' + g.name);
  const preferencePath = 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
  const existing = await ask({ action: 'read', path: preferencePath, name: exe });
  if (existing.exists && existing.kind !== 'String') throw Error('The GPU preference has an unexpected registry type. Review it in Windows settings.');
  const flags = (existing.value || '').split(';').filter(flag => flag && !/^GpuPreference=/i.test(flag));
  await journal.apply(g.id, preferencePath, exe, [...flags, 'GpuPreference=2'].join(';') + ';', 'String');
  g.executable = exe; if (!g.launch) g.launch = exe; g.optimized = true; await persist(); return true;
}
function bind(channel, handler, mutation = false) {
  ipcMain.handle(channel, async (event, ...args) => {
    let documentPath;
    try { documentPath = realpathSync(fileURLToPath(event.senderFrame.url)).toLowerCase(); } catch { throw Error('Untrusted request'); }
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || documentPath !== trustedDocument) throw Error('Untrusted request');
    const run = async () => {
      if (mutation && TEST) throw Error('Mutations are disabled in test mode');
      return handler(...args);
    };
    try { return await (mutation ? serialize(run) : run()); }
    catch (error) { errorLog.write('operation:' + channel, error); throw error; }
  });
}
function getGame(id) {
  if (typeof id !== 'string') throw Error('Invalid game');
  const g = settings.games.find(g => g.id === id);
  if (!g) throw Error('Game no longer exists');
  return g;
}
async function chooseExe(game) {
  const selected = await dialog.showOpenDialog(win, { title: 'Choose the game executable (not its launcher or uninstaller)',
    defaultPath: game?.executable || game?.installDir, properties: ['openFile'], filters: [{ name: 'Game executable', extensions: ['exe'] }] });
  if (selected.canceled) return null;
  const exe = selected.filePaths[0];
  if (!path.win32.isAbsolute(exe) || !/\.exe$/i.test(exe) || !(await fs.stat(exe)).isFile()) throw Error('Choose an existing .exe file');
  return exe;
}
async function launchTarget(game) {
  if (/^uplay:\/\/launch\/\d+\/0$/.test(game.launch) || /^steam:\/\/rungameid\/\d+$/.test(game.launch) || /^com\.epicgames\.launcher:\/\/apps\/[^\s]+$/.test(game.launch)) await shell.openExternal(game.launch);
  else {
    if (!path.win32.isAbsolute(game.launch) || !/\.exe$/i.test(game.launch)) throw Error('Invalid launch target');
    const error = await shell.openPath(game.launch); if (error) throw Error(error);
  }
  game.lastLaunched = new Date().toISOString(); await persist();
}
async function checkGameLaunch(game, rollbackOnCrash = true) {
  if (!game.launch) throw Error('Choose a game executable before testing launch');
  if ((await ask({action:'gameRunning',root:game.installDir})).length) throw Error('Close the game before running a launch check');
  const proxies = await proxyFiles(game.installDir);
  const run = () => observeLaunch({
    launch: () => launchTarget(game),
    running: () => ask({action:'gameRunning',root:game.installDir}),
    crashes: since => ask({action:'gameCrashEvents',root:game.installDir,since}),
    onUpdate: phase => {if(win&&!win.isDestroyed())win.webContents.send('component-progress',{label:game.name,phase});}
  });
  const result = await run();
  result.gameId=game.id;result.gameName=game.name;result.proxies=proxies;
  result.featureFindings=await graphicsFeatureFindings(game.installDir,result.startedAt);
  if(result.crash){result.gpuEvents=(await ask({action:'gpuResetEvents',since:result.startedAt}).catch(()=>[])).filter(event=>Date.parse(event.at)<=Date.parse(result.crash.at)+2000);result.logHints=await gameLogHints(game.installDir,result.startedAt);}
  result.guidance=explain(result,proxies);
  if(result.featureFindings.some(finding=>finding.startsWith('Neural runtime did not load')))result.guidance+=' The neural runtime failed to load; the installed files alone do not establish neural rendering.';
  if(result.crash)errorLog.write('game-launch-crash',JSON.stringify({game:game.name,...result.crash,proxies}));
  if(result.outcome==='crashed'&&rollbackOnCrash){
    const transaction=components.journal.find(t=>t.gameId===game.id);
    if(transaction){
      try {
        const status=await components.statusGame(game);
        if(!status.installations.some(item=>item.id===transaction.id&&['installed','config changed'].includes(item.state)))throw Error('Installed files changed after OPlay wrote them');
        if((await ask({action:'gameRunning',root:game.installDir})).length)throw Error('Game process is still running');
        if(win&&!win.isDestroyed())win.webContents.send('component-progress',{label:game.name,phase:'rollback'});
        await components.restore(transaction.id);result.rollback='restored';
        result.baseline=await run();
        result.repaired=result.baseline.outcome==='launched';
        result.guidance+=result.repaired?' OPlay restored its package and the game stayed open in a second startup check.':' OPlay restored its package, but the second launch did not pass the startup check. Inspect the remaining mods and game logs.';
      } catch(error){result.rollback='blocked';result.rollbackReason=error.message;result.guidance+=' Automatic restore stopped: '+error.message;errorLog.write('game-launch-rollback',error);}
    }
  }
  await components.recordLaunchTest(result);
  return components.snapshot();
}
async function pollRecentGameCrashes(){
  for(const game of settings.games){
    const prior=components.launchTests.find(item=>item.gameId===game.id);
    const since=watchSince(prior);
    if(!since||!Number.isFinite(Date.parse(since))||Date.now()-Date.parse(since)>90*60*1000)continue;
    const events=await ask({action:'gameCrashEvents',root:game.installDir,since});
    const crash=unseenCrash(events,components.launchTests,since);
    if(!crash)continue;
    const gpuEvents=(await ask({action:'gpuResetEvents',since}).catch(()=>[])).filter(event=>Date.parse(event.at)<=Date.parse(crash.at)+2000);
    const result={gameId:game.id,gameName:game.name,startedAt:since,finishedAt:crash.at,outcome:'crashed',late:true,crash,proxies:prior.proxies||[],gpuEvents,logHints:await gameLogHints(game.installDir,since),featureFindings:await graphicsFeatureFindings(game.installDir,since)};
    result.guidance=explain(result,result.proxies);
    errorLog.write('game-launch-crash',JSON.stringify({game:game.name,...crash,gpuEvents:result.gpuEvents}));
    const transaction=components.journal.find(t=>t.gameId===game.id);
    if(transaction){
      try{
        if((await ask({action:'gameRunning',root:game.installDir})).length)throw Error('Game process is still running');
        const status=await components.statusGame(game);
        if(!status.installations.some(item=>item.id===transaction.id&&['installed','config changed'].includes(item.state)))throw Error('Installed files changed after OPlay wrote them');
        await components.restore(transaction.id);result.rollback='restored';result.guidance+=' OPlay restored its unchanged files after the crash. Use Test launch when ready to check the original profile.';
      }catch(error){result.rollback='blocked';result.rollbackReason=error.message;result.guidance+=' Automatic restore stopped: '+error.message;errorLog.write('game-launch-rollback',error);}
    }
    await components.recordLaunchTest(result);
    if(win&&!win.isDestroyed())win.webContents.send('components-updated',components.snapshot());
  }
}
function scheduleGameCrashPoll(){
  if(crashPolling)return;
  crashPolling=true;
  const work=componentQueue.then(pollRecentGameCrashes).catch(error=>errorLog.write('game-crash-watch',error)).finally(()=>{crashPolling=false;});
  componentQueue=work;
}
function handlers() {
  bind('theme', async mode => { if (!['dark','light'].includes(mode)) throw Error('Invalid theme'); nativeTheme.themeSource = mode; settings.theme = mode; await persist(); });
  bind('component-docs', () => shell.openExternal('https://github.com/optiscaler/OptiScaler/wiki/Installation')); 
  bind('unlocked-docs', () => shell.openExternal('https://github.com/ShyVortex/dlss-unlocked/releases'));
  bind('fsr-docs', () => shell.openExternal('https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK/releases'));
  bind('components', (operation, payload = {}) => {
    if (!['refresh','download','download-opti','download-unlocked','inspect','status','swap','force-runtime','opti','unlocked','restore','test-launch'].includes(operation) || !payload || typeof payload !== 'object') throw Error('Invalid component operation');
    if (TEST && !['inspect','status'].includes(operation)) throw Error('Mutations are disabled in test mode');
    const transferOperation=['download','download-opti','download-unlocked','opti','unlocked','swap','force-runtime','test-launch'].includes(operation);
    const work = componentQueue.then(async () => {
      if (operation === 'refresh') return components.refresh();
      if (operation === 'download') return components.download(payload.id);
      if (operation === 'download-opti') { await components.downloadOpti(); return components.snapshot(); }
      if (operation === 'download-unlocked') { await components.downloadUnlocked(); return components.snapshot(); }
      if (operation === 'inspect') return components.inspectGame(getGame(payload.gameId));
      if (operation === 'status') return components.statusGame(getGame(payload.gameId));
      const game = operation === 'restore' ? getGame(components.journal.find(t => t.id === payload.id)?.gameId) : getGame(payload.gameId);
      if(operation==='test-launch')return checkGameLaunch(game);
      if (['force-runtime','opti','unlocked'].includes(operation) && (!game.executable || !await fs.stat(game.executable).then(s => s.isFile()).catch(() => false))) {
        const executable = await chooseExe(game);
        if (!executable) throw Error('Game executable selection cancelled');
        const relative = path.relative(game.installDir, executable);
        if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw Error('Choose an executable inside this game folder');
        game.executable = executable; await persist();
      }
      const running = await ask({ action: 'gameRunning', root: game.installDir });
      if (running.length) throw Error('Close the game before changing components: ' + running.join(', '));
      if (operation === 'restore') return components.restore(payload.id);
      if (operation === 'swap') await components.swap(game, payload.relative, payload.cacheId);
      else if (operation === 'force-runtime') await components.installRuntime(game, payload.cacheId);
      else if (operation === 'unlocked') await components.installUnlocked(game);
      else await components.installOpti(game, payload.output, payload.upscaler);
      return checkGameLaunch(game);
    });
    const reported=work.then(result=>{if(transferOperation&&win&&!win.isDestroyed())win.webContents.send('component-progress',{phase:'complete'});return result;},error=>{if(transferOperation&&win&&!win.isDestroyed())win.webContents.send('component-progress',{phase:'failed'});throw error;});
    componentQueue = reported.catch(() => {}); return reported;
  });

  bind('report-error', report => {
    if (!report || typeof report.message !== 'string' || report.message.length > 8000 || !['renderer-error', 'renderer-rejection'].includes(report.source)) throw Error('Invalid error report');
    errorLog.write(report.source, report.message);
  });
  bind('open-logs', async () => {
    await fs.mkdir(errorLog.directory, { recursive: true });
    const error = await shell.openPath(errorLog.directory); if (error) throw Error(error);
  }, true);
  bind('snapshot', snapshot);
  bind('vendor-scan', async action => {
    if (!['Start', 'Stop', 'Navigate'].includes(action)) throw Error('Invalid scan operation');
    if (action === 'Start') {
      await gpuControl.close();
      vendorScan = await ask({ action: 'vendorScan', mode: 'Read' });
      if (vendorScan?.cpuTemperature >= 90) throw Error('CPU temperature is ' + vendorScan.cpuTemperature + '°C. Cool the laptop or select the Efficient CPU profile before starting a calibration.');
    }
    const vendor = path.join(process.env.ProgramFiles, 'NVIDIA Corporation', 'NVIDIA App', 'CEF', 'NVIDIA App.exe');
    if (!await fs.stat(vendor).then(s => s.isFile()).catch(() => false)) throw Error('NVIDIA App is not installed. Automatic calibration requires the vendor application.');
    {
      const child = spawn(vendor, ['--force-renderer-accessibility'], { detached: true, stdio: 'ignore', windowsHide: false });
      child.on('error', e => { runtimeNotice = e.message; errorLog.write('vendor-launch', e); }); child.unref();
      for (let i = 0; i < 20; i++) {
        vendorScan = await ask({ action: 'vendorScan', mode: 'Read' });
        if (vendorScan.windowReady || vendorScan.available) break;
        await new Promise(r => setTimeout(r, 250));
      }
    }
    vendorScan = await ask({ action: 'vendorScan', mode: action });
    return { state: await snapshot(), scan: vendorScan };
  }, true);
  bind('gpu-enable', async () => { await gpuControl.enable(); return snapshot(); }, true);
  bind('gpu-offsets', async values => {
    vendorScan = await ask({ action: 'vendorScan', mode: 'Read' });
    if (vendorScan.running) throw Error('Stop NVIDIA automatic calibration before applying manual offsets.');
    if (!values || !Number.isInteger(values.core) || !Number.isInteger(values.memory)) throw Error('Offsets must be whole MHz values');
    const current = gpuControl.state || gpuCapability;
    const increases = current?.offsets?.some(v => (v.type === 0 ? values.core : values.memory) > v.value);
    if (increases && vendorScan.cpuTemperature >= 90) throw Error('CPU temperature is ' + vendorScan.cpuTemperature + '°C. Cool the laptop before increasing GPU or VRAM offsets.');
    await gpuControl.request('apply', values); return snapshot();
  }, true);
  bind('gpu-curve', async values => {
    if (!values || !Number.isFinite(values.millivolts) || !Number.isInteger(values.megahertz)) throw Error('Invalid curve target');
    vendorScan = await ask({ action: 'vendorScan', mode: 'Read' });
    if (vendorScan.running) throw Error('Stop NVIDIA calibration before applying a GPU curve');
    await gpuControl.request('curve', values); return snapshot();
  }, true);
  bind('gpu-restore', async () => { await gpuControl.request('restore'); return snapshot(); }, true);
  bind('cpu-profile', async profile => {
    if (!['performance', 'efficient'].includes(profile)) throw Error('Invalid CPU profile');
    powerState = await ask({ action: 'power' });
    const p = 'POWER:' + powerState.scheme;
    const boostBackup = journal.entries.find(e => e.path === p && e.name === 'BoostMode');
    await journal.apply('cpu', p, 'BoostMode', profile === 'efficient' ? 0 : boostBackup ? boostBackup.before.value : powerState.boost, 'PowerAC');
    await journal.apply('cpu', p, 'MaximumProcessorState', profile === 'performance' ? 100 : 99, 'PowerAC');
    await journal.apply('cpu', p, 'EnergyPreference', profile === 'performance' ? 0 : 60, 'PowerAC');
    powerState = await ask({ action: 'power' }); return snapshot();
  }, true);
  bind('desktop-apps', async () => { desktopApps = await ask({ action: 'apps', owner: process.pid }); return desktopApps; });
  bind('close-app', async id => {
    if (!Number.isInteger(id)) throw Error('Invalid app');
    const target = desktopApps.find(p => p.pid === id); if (!target) throw Error('Refresh the app list first');
    const answer = await dialog.showMessageBox(win, { type: 'question', buttons: ['Cancel', 'Request close'], defaultId: 0, cancelId: 0,
      message: `Request ${target.name} to close?`, detail: 'Save your work first. Aether sends a normal close request. The app may show its own save prompt or decline to close; Aether never force-terminates it.' });
    if (answer.response !== 1) return null;
    return ask({ action: 'closeApp', owner: process.pid, ...target });
  }, true);
  bind('scan', async () => {
    inventory = await ask({ action: 'inventory' });
    const found = await discover(inventory, settings.games);
    settings.games = found.games; settings.warnings = found.warnings; cachedCovers.clear(); await persist(); return snapshot();
  }, true);
  bind('add-game', async () => {
    const exe = await chooseExe(); if (!exe) return snapshot();
    if (settings.games.some(g => g.executable?.toLowerCase() === exe.toLowerCase())) throw Error('This executable is already in your library');
    settings.games.push({ id: 'local-' + idFor(exe), name: path.basename(exe, '.exe'), store: 'Local', executable: exe, launch: exe, installDir: path.dirname(exe) });
    await persist(); return snapshot();
  }, true);
  bind('scan-folder', async () => {
    const selected = await dialog.showOpenDialog(win, { title: 'Choose a folder containing your games', properties: ['openDirectory'] });
    folderCandidates.clear();
    if (selected.canceled) return null;
    const result = await scanFolder(selected.filePaths[0]);
    for (const g of result.candidates) folderCandidates.set(g.id, g);
    return result;
  }, true);
  bind('import-games', async ids => {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !folderCandidates.has(id))) throw Error('Invalid import selection. Scan the folder again.');
    for (const id of new Set(ids)) {
      const g = folderCandidates.get(id);
      if (!await fs.stat(g.executable).then(s => s.isFile()).catch(() => false)) throw Error('Executable missing: ' + g.name);
      if (!settings.games.some(x => x.id === id || x.executable?.toLowerCase() === g.executable.toLowerCase())) settings.games.push(g);
    }
    await persist(); folderCandidates.clear(); return snapshot();
  }, true);
  bind('launch', async id => {
    const g = getGame(id);
    if (components.journal.some(t=>t.gameId===id&&t.status!=='installed')) throw Error('Restore the incomplete graphics profile in Graphics Studio before launching this game');
    if (!g.launch) { const executable = await chooseExe(g); if (!executable) return 'Launch cancelled'; g.executable = executable; g.launch = executable; await persist(); }
    await launchTarget(g); return 'Launch request sent to ' + g.name;
  }, true);
  bind('optimize-game', async id => {
    const g = getGame(id);
    await optimizeGame(g); return snapshot();
  }, true);
  bind('global', async () => {
    const targets = [
      ['HKCU:\\Software\\Microsoft\\GameBar', 'AutoGameModeEnabled', 1],
      ['HKCU:\\Software\\Microsoft\\GameBar', 'AllowAutoGameMode', 1],
      ['HKCU:\\System\\GameConfigStore', 'GameDVR_Enabled', 0],
      ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', 'AppCaptureEnabled', 0]
    ];
    let changed = 0;
    for (const [p, n, v] of targets) if (await journal.apply('global', p, n, v, 'DWord')) changed++;
    const skipped = [], failures = []; let configured = 0;
    for (const g of settings.games) {
      try { if (await optimizeGame(g, false)) configured++; else skipped.push(g.name); }
      catch (e) { errorLog.write('optimize-game', e); failures.push(g.name + ': ' + e.message); }
    }
    settings.guard = true; await persist();
    return { state: await snapshot(), message: `${changed} Windows settings changed and verified. ${configured} games configured; live guard enabled.${skipped.length ? ' Choose executables for: ' + skipped.join(', ') + '.' : ''}${failures.length ? ' Failures: ' + failures.join('; ') : ''}` };
  }, true);
  bind('guard', async enabled => {
    if (typeof enabled !== 'boolean') throw Error('Invalid setting');
    if (!enabled) await restorePriority();
    settings.guard = enabled; await persist(); return snapshot();
  }, true);
  bind('undo', async scope => {
    if (scope !== null && !['global', 'cpu'].includes(scope) && !settings.games.some(g => g.id === scope)) throw Error('Invalid backup scope');
    if (scope === null) { settings.guard = false; await restorePriority(); }
    const result = await journal.restore(scope);
    powerState = await ask({ action: 'power' });
    for (const g of settings.games) if ((scope === null || scope === g.id) && !journal.entries.some(e => e.scope === g.id)) g.optimized = false;
    await persist(); return { state: await snapshot(), result };
  }, true);
  bind('open-settings', async target => {
    const links = { graphics: 'ms-settings:display-advancedgraphics', gaming: 'ms-settings:gaming-gamemode', capture: 'ms-settings:gaming-gamedvr' };
    if (!Object.hasOwn(links, target)) throw Error('Invalid settings link');
    await shell.openExternal(links[target]);
  }, true);
  bind('window', action => {
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
  });
}
app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  cpuPercent();
  settings = await readJson(dataFile(), { games: [], guard: false, boosted: [], warnings: [] });
  if (!Array.isArray(settings.games) || !Array.isArray(settings.boosted)) throw Error('Library data is invalid; restore your library.json backup.');
  const inspector = async file => {
    const script = path.join(ROOT, 'component-tools.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    const r = await exec(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile','-File',script,'-Action','Inspect','-File',file], {windowsHide:true,timeout:30000});
    return JSON.parse(r.stdout);
  };
  components = new Components(path.join(app.getPath('userData'), 'components'), inspector, progress=>{if(win&&!win.isDestroyed())win.webContents.send('component-progress',progress);}); await components.load();
  nativeTheme.themeSource = settings.theme === 'light' ? 'light' : 'dark';
  startWorker(); inventory = await ask({ action: 'inventory' });
  try { gpuCapability = await ask({ action: 'gpu' }); } catch (e) { runtimeNotice = e.message; errorLog.write('runtime', e); }
  try { powerState = await ask({ action: 'power' }); } catch (e) { runtimeNotice = e.message; errorLog.write('runtime', e); }
  try { vendorScan = await ask({ action: 'vendorScan', mode: 'Read' }); } catch (e) { vendorScan = null; errorLog.write('vendor-status', e); }
  journal = new Journal(path.join(app.getPath('userData'), 'settings-backup.json'), ask); await journal.load();
  await restorePriority();
  const found = await discover(inventory, settings.games); settings.games = found.games; settings.warnings = found.warnings; await persist();
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({ width: Math.min(1440, area.width - 24), height: Math.min(960, area.height - 24), minWidth: 1040, minHeight: 740, show: false, frame: false,
    backgroundColor: Number(os.release().split('.')[2]) >= 22621 ? '#00000000' : '#101216',
    backgroundMaterial: Number(os.release().split('.')[2]) >= 22621 ? 'acrylic' : 'none',
    title: 'OPlay', icon: path.join(ROOT, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false } });
  win.webContents.on('render-process-gone', (_event, details) => { if (details.reason !== 'clean-exit') errorLog.write('renderer-crash', JSON.stringify(details)); });
  win.webContents.on('preload-error', (_event, _file, error) => errorLog.write('preload', error));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  handlers(); await win.loadFile(path.join(ROOT, 'index.html'));
  win.show(); await sample(); timer = setInterval(() => { sample().catch(e => { runtimeNotice = e.message; errorLog.write('sampling', e); }); }, 5000);
  gpuHeartbeat = setInterval(() => { if (gpuControl.socket) gpuControl.request('state').catch(e => { runtimeNotice = e.message; errorLog.write('gpu-heartbeat', e); }); }, 5000);
  if(!TEST){const check=()=>{const work=componentQueue.then(()=>components.refreshIfDue()).then(result=>{if(win&&!win.isDestroyed())win.webContents.send('components-updated',result);}).catch(e=>errorLog.write('catalog-refresh',e));componentQueue=work.catch(()=>{});};check();catalogTimer=setInterval(check,60*60*1000);scheduleGameCrashPoll();gameCrashTimer=setInterval(scheduleGameCrashPoll,30000);}
}).catch(e => { errorLog.write('startup', e); dialog.showErrorBox('OPlay could not start', e.message); app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (closing) return;
  event.preventDefault(); closing = true; clearInterval(timer); clearInterval(gpuHeartbeat); clearInterval(catalogTimer); clearInterval(gameCrashTimer);
  queue.then(async () => {
    await componentQueue; await diskQueue;
    // Wait for the last process sample before restoring priorities.
    for (let i = 0; sampling && i < 100; i++) await new Promise(r => setTimeout(r, 100));
    const recovery = await Promise.allSettled([restorePriority(), gpuControl.close()]);
    const errors = recovery.filter(r => r.status === 'rejected').map(r => r.reason);
    for (const error of errors) errorLog.write('shutdown-recovery', error);
    if (errors.length) throw new AggregateError(errors, errors.map(e => e.message).join('; '));
  }).catch(e => { errorLog.write('shutdown-recovery', e); dialog.showErrorBox('Settings restore incomplete', e.message + '\nThe recovery record will be retried next launch.'); }).finally(() => { worker?.kill(); app.quit(); });
});
