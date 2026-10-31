const { readJson, saveJson } = require('./core.cjs');
const same = (a, b) => a.exists === b.exists && a.kind === b.kind && JSON.stringify(a.value) === JSON.stringify(b.value);
class Journal {
  constructor(file, adapter) { this.file = file; this.adapter = adapter; this.entries = []; }
  async load() { this.entries = await readJson(this.file, []); }
  async apply(scope, path, name, value, kind) {
    const before = await this.adapter({ action: 'read', path, name });
    const after = { exists: true, value, kind };
    if (same(before, after)) return false;
    let entry = this.entries.find(e => e.path === path && e.name === name);
    if (entry && !same(before, entry.after) && !(entry.pendingBefore && same(before, entry.pendingBefore))) throw Error('This setting changed outside Aether. Undo or review the existing backup first.');
    if (!entry) {
      entry = { scope, path, name, before, after, time: new Date().toISOString() };
      this.entries.push(entry);
    }
    entry.pendingBefore = before;
    entry.after = after;
    await saveJson(this.file, this.entries);
    const result = await this.adapter({ action: 'write', path, name, value, kind, expected: before });
    if (!same(result, after)) throw Error('Windows did not retain the requested setting. Backup kept.');
    delete entry.pendingBefore;
    await saveJson(this.file, this.entries);
    return true;
  }
  async restore(scope) {
    let restored = 0; const skipped = [];
    for (const e of [...this.entries].reverse()) {
      if (scope && e.scope !== scope) continue;
      try {
        const current = await this.adapter({ action: 'read', path: e.path, name: e.name });
        if (!same(current, e.before)) {
          if (!same(current, e.after) && !(e.pendingBefore && same(current, e.pendingBefore))) { skipped.push(e.name + ': changed outside Aether'); continue; }
          const result = await this.adapter({ action: 'write', path: e.path, name: e.name, value: e.before.value,
            kind: e.before.kind || e.after.kind, remove: !e.before.exists, expected: current });
          if (!same(result, e.before)) throw Error('restore verification failed');
        }
        this.entries = this.entries.filter(x => x !== e);
        await saveJson(this.file, this.entries);
        restored++;
      } catch (err) { skipped.push(e.name + ': ' + err.message); }
    }
    return { restored, skipped };
  }
}
module.exports = { Journal };
