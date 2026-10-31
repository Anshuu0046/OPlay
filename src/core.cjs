const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function vdf(text) {
  const tokens = [...text.matchAll(/"((?:\\.|[^"\\])*)"|([{}])|\/\/[^\r\n]*/g)]
    .filter(m => !m[0].startsWith('//')).map(m => m[2] || m[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"'));
  let i = 0;
  function object(nested) {
    const result = {};
    while (i < tokens.length) {
      const key = tokens[i++];
      if (key === '}') { if (!nested) throw Error('Unexpected VDF brace'); return result; }
      if (i >= tokens.length) throw Error('Incomplete VDF');
      const value = tokens[i++];
      result[key] = value === '{' ? object(true) : value;
    }
    if (nested) throw Error('Unclosed VDF');
    return result;
  }
  return object(false);
}
const idFor = value => crypto.createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 20);
const inside = (root, file) => {
  const relative = path.win32.relative(root, file);
  return relative !== '' && !relative.startsWith('..\\') && relative !== '..' && !path.win32.isAbsolute(relative);
};
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
async function saveJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + '.tmp', JSON.stringify(data, null, 2));
  await fs.rename(file + '.tmp', file);
}
async function discover(inventory, saved = []) {
  const games = new Map(saved.map(g => [g.id, g]));
  const warnings = [];
  const add = g => games.set(g.id, { ...games.get(g.id), ...g });
  const list = async dir => {
    try { return await fs.readdir(dir, { withFileTypes: true }); }
    catch (e) { if (e.code !== 'ENOENT') warnings.push(`${dir}: ${e.code}`); return []; }
  };
  const steamRoot = inventory.steam;
  if (steamRoot) {
    let libraries = [steamRoot];
    try {
      const data = vdf(await fs.readFile(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), 'utf8'));
      libraries.push(...Object.values(data.libraryfolders || data.LibraryFolders || {}).map(x => typeof x === 'string' ? x : x.path).filter(x => x && path.win32.isAbsolute(x)));
    } catch (e) { if (e.code !== 'ENOENT') warnings.push('Steam libraries: ' + e.message); }
    for (const root of [...new Set(libraries)]) {
      const apps = path.join(root, 'steamapps');
      for (const entry of await list(apps)) {
        if (!/^appmanifest_\d+\.acf$/i.test(entry.name)) continue;
        try {
          const data = vdf(await fs.readFile(path.join(apps, entry.name), 'utf8')).AppState;
      if (!data || !/^\d+$/.test(data.appid) || !data.name || !data.installdir) continue;
          const installDir = path.resolve(apps, 'common', data.installdir);
          if (!inside(path.resolve(apps, 'common'), installDir)) continue;
          if (!await fs.stat(installDir).then(s => s.isDirectory()).catch(() => false)) continue;
          // shortcut: launcher manifests can include tools; exclude known runtimes, expand exclusions if needed.
          if (/redistribut|steamworks|proton|soldier|shader pre.cache/i.test(data.name)) continue;
          add({ id: 'steam-' + data.appid, name: data.name, store: 'Steam', appId: data.appid, installDir, launch: 'steam://rungameid/' + data.appid });
        } catch (e) { warnings.push(entry.name + ': ' + e.message); }
      }
    }
  }
  if (inventory.epic) for (const entry of await list(inventory.epic)) {
    if (!entry.name.endsWith('.item')) continue;
    try {
      const d = await readJson(path.join(inventory.epic, entry.name));
      if (!d.InstallLocation || !d.DisplayName || !d.AppName || d.bIsIncompleteInstall) continue;
      if (!await fs.stat(d.InstallLocation).then(s => s.isDirectory()).catch(() => false)) continue;
      const exe = path.resolve(d.InstallLocation, d.LaunchExecutable || '');
      add({ id: 'epic-' + idFor(d.AppName), name: d.DisplayName, store: 'Epic Games', installDir: d.InstallLocation,
        executable: inside(d.InstallLocation, exe) && /\.exe$/i.test(exe) ? exe : undefined,
        launch: 'com.epicgames.launcher://apps/' + encodeURIComponent(d.AppName) + '?action=launch&silent=true' });
    } catch (e) { warnings.push(entry.name + ': ' + e.message); }
  }
  for (const g of inventory.gog || []) {
    if (!g.name || !g.path || !g.exe || !path.win32.isAbsolute(g.exe) || !/\.exe$/i.test(g.exe)) continue;
    if (!await fs.stat(g.exe).then(s => s.isFile()).catch(() => false)) continue;
    add({ id: 'gog-' + idFor(g.path), name: g.name, store: 'GOG', installDir: g.path, executable: g.exe, launch: g.exe });
  }
  for (const g of inventory.extra || []) {
    if (!g.name || !path.win32.isAbsolute(g.installDir || '') || !['Ubisoft Connect','Battle.net','EA App','Xbox'].includes(g.store)) continue;
    if (!await fs.stat(g.installDir).then(s => s.isDirectory()).catch(() => false)) continue;
    if ([...games.values()].some(existing => existing.installDir?.toLowerCase() === g.installDir.toLowerCase())) continue;
    const executable = g.executable && inside(g.installDir,g.executable) && /\.exe$/i.test(g.executable) ? g.executable : undefined;
    add({id:'extra-'+idFor(g.installDir),name:g.name,store:g.store,installDir:g.installDir,executable,launch:/^uplay:\/\/launch\/\d+\/0$/.test(g.launch || '') ? g.launch : executable});
  }
  // Keep user imports and offline libraries visible; availability is checked before actions.
  return { games: [...games.values()].sort((a, b) => a.name.localeCompare(b.name)), warnings };
}
function parseGpu(text) {
  const fields = text.trim().split(/\r?\n/)[0].split(',').map(x => x.trim());
  const numeric = i => /^\d+(\.\d+)?$/.test(fields[i]) ? Number(fields[i]) : null;
  return { name: fields[0], utilization: numeric(1), temperature: numeric(2), memoryUsed: numeric(3), memoryTotal: numeric(4),
    clock: numeric(5), memoryClock: numeric(6), power: numeric(7), powerLimit: numeric(8), maxClock: numeric(9), thermalSlowdown: fields[10] === 'Active' };
}
async function scanFolder(root) {
  const warnings = []; let inspected = 0;
  const skip = /^(node_modules|windows|windowsapps|wpSystem|programdata|\$.*|system volume information|redist|_redist|__installer|installer|support|directx|vcredist|engine|easyanticheat|battleye)$/i;
  const excludedExe = /(^|[._ -])(unins\d*|uninstall|setup|install|crash\w*|report\w*|dxsetup|vc_redist|unitycrashhandler\w*|ue4prereq\w*|steam|epicgameslauncher|goggalaxy|galaxyclient|eac\w*)([._ -]|$)/i;
  async function walk(dir, depth) {
    if (depth > 5 || inspected >= 5000) return [];
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (e) { warnings.push(path.basename(dir) + ': ' + e.code); return []; }
    const files = [];
    for (const entry of entries) {
      if (++inspected > 5000) break;
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isFile() && /\.exe$/i.test(entry.name) && !excludedExe.test(entry.name)) files.push(file);
      if (entry.isDirectory() && !skip.test(entry.name)) files.push(...await walk(file, depth + 1));
    }
    return files;
  }
  const exes = await walk(root, 0);
  if (inspected >= 5000) warnings.push('Scan limited to 5,000 entries and 5 subfolder levels. Choose a smaller folder for more results.');
  const groups = new Map();
  for (const exe of exes) {
    const parts = path.relative(root, exe).split(path.sep);
    const group = parts.length === 1 || /^(bin|binaries|win64|x64)$/i.test(parts[0]) ? root : path.join(root, parts[0]);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(exe);
  }
  const candidates = [];
  for (const [dir, files] of groups) {
    const name = path.basename(dir);
    const score = file => {
      const base = path.basename(file, '.exe').toLowerCase();
      return (base.replace(/[^a-z0-9]/g, '') === name.toLowerCase().replace(/[^a-z0-9]/g, '') ? 20 : 0)
        + (/shipping/i.test(base) ? 10 : 0) + (/win64|x64/i.test(file) ? 4 : 0) - (/launcher/i.test(base) ? 4 : 0)
        - path.relative(dir, file).split(path.sep).length;
    };
    files.sort((a, b) => score(b) - score(a));
    const executable = files[0];
    candidates.push({ id: 'local-' + idFor(executable), name, store: 'Local', installDir: dir, executable, launch: executable });
  }
  return { candidates, warnings };
}
module.exports = { vdf, idFor, inside, readJson, saveJson, discover, parseGpu, scanFolder };
