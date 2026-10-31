const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { GpuControl } = require('../src/gpu-control.cjs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
(async () => {
  const gpu = new GpuControl(path.resolve(__dirname, '../src'));
  let heartbeat;
  try {
    console.log('Waiting for Windows administrator approval for the GPU helper.');
    const before = await gpu.enable();
    heartbeat = setInterval(() => gpu.request('state').catch(() => {}), 5000);
    const core = before.offsets.find(v => v.type === 0 && v.pstate === 0);
    const memory = before.offsets.find(v => v.type === 2 && v.pstate === 0);
    assert.ok(core && memory); assert.ok(before.temperature < 80);
    const changed = await gpu.request('apply', { core: Math.max(core.min, core.value - 15), memory: Math.max(memory.min, memory.value - 50) });
    assert.equal(changed.offsets.find(v => v.type === 0 && v.pstate === 0).value, Math.max(core.min, core.value - 15));
    assert.equal(changed.offsets.find(v => v.type === 2 && v.pstate === 0).value, Math.max(memory.min, memory.value - 50));
    const restored = await gpu.request('restore');
    for (const v of before.offsets) assert.equal(restored.offsets.find(a => a.type === v.type && a.pstate === v.pstate).value, v.value);
    const positive = await gpu.request('apply', { core: Math.min(core.max, core.value + 15), memory: Math.min(memory.max, memory.value + 25) });
    assert.equal(positive.offsets.find(v => v.type === 0 && v.pstate === 0).value, Math.min(core.max, core.value + 15));
    assert.ok(Math.abs(positive.offsets.find(v => v.type === 2 && v.pstate === 0).value - Math.min(memory.max, memory.value + 25)) <= 1);
    await gpu.request('restore');
    await gpu.request('apply', { core: core.value - 15, memory: memory.value - 50 });
    clearInterval(heartbeat);
    console.log('Testing watchdog lease expiry; no clock-helper heartbeat for 23 seconds.');
    await new Promise(r => setTimeout(r, 23000));
    const source = path.resolve(__dirname, '../src/Nvml.cs').replaceAll("'", "''");
    const script = `Add-Type -Path '${source}'; [void][AetherNvml]::Initialize(); @([AetherNvml]::Read(0,0),[AetherNvml]::Read(0,2),[AetherNvml]::Read(2,0),[AetherNvml]::Read(2,2)) | ConvertTo-Json -Compress`;
    const read = await exec(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script,'utf16le').toString('base64')], { windowsHide: true });
    const recovered = JSON.parse(read.stdout);
    for (const v of before.offsets) assert.equal(recovered.find(a => a.type === v.type && a.pstate === v.pstate).clockOffsetMHz, v.value);
    const result = { at: new Date().toISOString(), passed: true, before, temporary: changed, positiveOffsetWrite: positive, restored, watchdogRecovered: recovered,
      scope: 'Small positive and negative offset writes, driver read-back, exact baseline restore, and heartbeat-expiry watchdog recovery; not a stability or FPS benchmark.' };
    await fs.writeFile(path.resolve(__dirname, '../../../outputs/Aether-GPU-verification.json'), JSON.stringify(result, null, 2));
    console.log('PASS: real graphics/VRAM positive and negative writes, read-back, original restore, and watchdog lease recovery.');
  } finally { clearInterval(heartbeat); await gpu.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
