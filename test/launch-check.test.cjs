const test = require('node:test');
const assert = require('node:assert/strict');
const { observeLaunch, explain } = require('../src/launch-check.cjs');

test('launch check distinguishes a stable process from a crash and an absent launch', async () => {
  let time = 0, polls = 0;
  const clock = { now: () => time, wait: async ms => { time += ms; } };
  const stable = await observeLaunch({ launch: async () => {}, running: async () => ++polls > 1 ? ['Game'] : [], crashes: async () => [], ...clock, startTimeoutMs: 5, stableMs: 3, pollMs: 1 });
  assert.equal(stable.outcome, 'launched');
  polls = 0; time = 0;
  const crash = { at: '2026-11-01T12:00:00Z', app: 'Game.exe', module: 'KERNELBASE.dll', code: 'c00000fd' };
  const failed = await observeLaunch({ launch: async () => {}, running: async () => ++polls < 4 ? ['Game'] : [], crashes: async () => [crash], ...clock, startTimeoutMs: 5, stableMs: 4, pollMs: 1 });
  assert.equal(failed.outcome, 'crashed');
  assert.match(explain(failed, ['dxgi.dll', 'winmm.dll']), /stack overflow.*proxy DLLs/i);
  polls = 0; time = 0;
  const absent = await observeLaunch({ launch: async () => {}, running: async () => [], crashes: async () => [], ...clock, startTimeoutMs: 3, stableMs: 2, pollMs: 1 });
  assert.equal(absent.outcome, 'not-started');
});
