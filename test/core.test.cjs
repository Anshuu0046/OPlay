const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { vdf, inside, discover, parseGpu, scanFolder } = require('../src/core.cjs');
const { Journal } = require('../src/journal.cjs');
test('Steam VDF parses nested objects, escaped Windows paths, comments and malformed input', () => {
  assert.deepEqual(vdf('// comment\n"libraryfolders" { "0" { "path" "C:\\\\Games" } }'), { libraryfolders: { 0: { path: 'C:\\Games' } } });
  assert.throws(() => vdf('"a" { "b" "c"'), /Unclosed/);
  assert.throws(() => vdf('"a"'), /Incomplete/);
});
test('Windows containment rejects path traversal and different drives', () => {
  assert.equal(inside('C:\\Games', 'C:\\Games\\A\\game.exe'), true);
  assert.equal(inside('C:\\Games', 'C:\\Games2\\game.exe'), false);
  assert.equal(inside('C:\\Games', 'D:\\game.exe'), false);
  assert.equal(inside('C:\\Games', 'C:\\Games\\..\\Windows\\a.exe'), false);
});
test('NVIDIA unsupported fields stay unavailable; thermal state is explicit', () => {
  const gpu = parseGpu('RTX 3050, 42, 63.5, 250, 4096, 1500, 6151, 18.2, [N/A], 2100, Active\n');
  assert.equal(gpu.powerLimit, null); assert.equal(gpu.temperature, 63.5); assert.equal(gpu.thermalSlowdown, true);
});
test('Folder scan groups separate games, prefers shipping binaries, excludes uninstallers', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-folder-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const file of ['Game One/launch.exe', 'Game One/Binaries/Win64/One-Win64-Shipping.exe', 'Game Two/Two.exe', 'Game Two/unins000.exe', 'Redist/setup.exe']) {
    const target = path.join(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, '');
  }
  const result = await scanFolder(root);
  assert.equal(result.candidates.length, 2);
  assert.match(result.candidates.find(g => g.name === 'Game One').executable, /Shipping\.exe$/);
  assert.match(result.candidates.find(g => g.name === 'Game Two').executable, /Two\.exe$/);
});
test('Discovery merges Steam and Epic manifests and preserves manual/offline entries', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-scan-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const steam = path.join(root, 'Steam'), epic = path.join(root, 'Epic');
  await fs.mkdir(path.join(steam, 'steamapps', 'common', 'Example'), { recursive: true });
  await fs.mkdir(epic);
  await fs.writeFile(path.join(steam, 'steamapps', 'appmanifest_100.acf'), '"AppState" { "appid" "100" "name" "Example" "installdir" "Example" }');
  await fs.writeFile(path.join(steam, 'steamapps', 'appmanifest_101.acf'), '"AppState" { "appid" "101" "name" "Traversal" "installdir" "..\\.." }');
  await fs.writeFile(path.join(epic, 'good.item'), JSON.stringify({ AppName: 'epic-test', DisplayName: 'Epic Test', InstallLocation: root, LaunchExecutable: 'play.exe' }));
  await fs.writeFile(path.join(epic, 'bad.item'), 'bad JSON');
  const old = { id: 'steam-100', optimized: true, executable: 'C:\\Games\\Example.exe' };
  const result = await discover({ steam, epic }, [old, { id: 'local-x', name: 'Custom', store: 'Local' }]);
  assert.equal(result.games.length, 3);
  assert.equal(result.games.find(g => g.id === 'steam-100').optimized, true);
  assert.equal(result.games.find(g => g.name === 'Traversal'), undefined);
  assert.equal(result.warnings.length, 1);
});
async function fakeJournal(t, initial) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-journal-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let current = initial || { exists: false, kind: null, value: null };
  const file = path.join(dir, 'backup.json');
  const j = new Journal(file, async q => {
    if (q.action === 'read') return structuredClone(current);
    assert.deepEqual(current, q.expected);
    // The pre-change backup must already be durable when the write begins.
    const backup = JSON.parse(await fs.readFile(file)); assert.equal(backup.length, 1);
    current = q.remove ? { exists: false, kind: null, value: null } : { exists: true, kind: q.kind, value: q.value };
    return structuredClone(current);
  });
  await j.load(); return { j, file, get: () => current, set: value => { current = value; } };
}
test('Write-ahead backup, read-back verification, idempotent apply and undo', async t => {
  const f = await fakeJournal(t);
  assert.equal(await f.j.apply('global', 'P', 'N', 1, 'DWord'), true);
  assert.equal(await f.j.apply('global', 'P', 'N', 1, 'DWord'), false);
  assert.equal(f.j.entries.length, 1);
  assert.deepEqual(await f.j.restore(null), { restored: 1, skipped: [] });
  assert.equal(f.get().exists, false);
  assert.deepEqual(JSON.parse(await fs.readFile(f.file)), []);
});
test('Undo preserves later external changes and retains the backup', async t => {
  const f = await fakeJournal(t, { exists: true, kind: 'DWord', value: 0 });
  await f.j.apply('global', 'P', 'N', 1, 'DWord');
  f.set({ exists: true, kind: 'DWord', value: 2 });
  const result = await f.j.restore(null);
  assert.equal(result.restored, 0); assert.equal(result.skipped.length, 1);
  assert.equal(f.get().value, 2); assert.equal(f.j.entries.length, 1);
  await assert.rejects(f.j.apply('global', 'P', 'N', 3, 'DWord'), /outside Aether/);
});
test('Failed system writes leave recovery records without inventing success', async t => {
  const f = await fakeJournal(t);
  f.j.adapter = async q => { if (q.action === 'read') return { exists: false, kind: null, value: null }; throw Error('Access denied'); };
  await assert.rejects(f.j.apply('global', 'P', 'N', 1, 'DWord'), /Access denied/);
  const recovery = new Journal(f.file, f.j.adapter); await recovery.load(); assert.equal(recovery.entries.length, 1);
  assert.equal((await recovery.restore(null)).restored, 1);
});
test('Undo restores original value and type, and can limit its scope', async t => {
  const original = { exists: true, kind: 'String', value: 'original' };
  const f = await fakeJournal(t, original);
  await f.j.apply('game', 'P', 'N', 'GpuPreference=2;', 'String');
  assert.equal((await f.j.restore('global')).restored, 0);
  assert.equal((await f.j.restore('game')).restored, 1);
  assert.deepEqual(f.get(), original);
});
test('Changing a profile repeatedly retains the original backup and latest applied value', async t => {
  const f = await fakeJournal(t, { exists: true, kind: 'PowerAC', value: 100 });
  await f.j.apply('cpu', 'POWER:plan', 'MaximumProcessorState', 99, 'PowerAC');
  await f.j.apply('cpu', 'POWER:plan', 'MaximumProcessorState', 95, 'PowerAC');
  assert.equal(f.j.entries[0].before.value, 100);
  assert.equal(f.j.entries[0].after.value, 95);
  assert.equal((await f.j.restore('cpu')).restored, 1);
  assert.equal(f.get().value, 100);
});
test('A failed second profile write can still restore the previously applied profile', async t => {
  const f = await fakeJournal(t, { exists: true, kind: 'PowerAC', value: 100 });
  await f.j.apply('cpu', 'POWER:plan', 'MaximumProcessorState', 99, 'PowerAC');
  const adapter = f.j.adapter;
  f.j.adapter = async q => { if(q.action === 'write' && q.value === 95) throw Error('Denied'); return adapter(q); };
  await assert.rejects(f.j.apply('cpu', 'POWER:plan', 'MaximumProcessorState', 95, 'PowerAC'), /Denied/);
  assert.equal(f.get().value, 99);
  assert.equal((await f.j.restore('cpu')).restored, 1);
  assert.equal(f.get().value, 100);
});
