const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { observeLaunch, explain, gameLogHints, graphicsFeatureFindings, watchSince, unseenCrash } = require('../src/launch-check.cjs');

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
  assert.match(explain({...failed,gpuEvents:[{id:153,provider:'nvlddmkm'}]},['dxgi.dll']),/GPU driver event.*0xc00000fd/i);
  polls = 0; time = 0;
  const absent = await observeLaunch({ launch: async () => {}, running: async () => [], crashes: async () => [], ...clock, startTimeoutMs: 3, stableMs: 2, pollMs: 1 });
  assert.equal(absent.outcome, 'not-started');
});
test('launch diagnosis reads recent graphics errors without loading whole logs', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oplay-launch-log-'));
  try{
    await fs.writeFile(path.join(dir,'OptiScaler.log'),'normal\n'+('normal filler\n'.repeat(6000))+'[E] GPU device suspended\n');
    const hints=await gameLogHints(dir,new Date(Date.now()-1000).toISOString());
    assert.equal(hints.length,1);assert.match(hints[0].text,/GPU device suspended/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('launch report distinguishes a loaded MFG module from a failed neural runtime',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oplay-feature-log-'));
  try{
    await fs.writeFile(path.join(dir,'OptiScaler.log'),'[I] DlssNr.Enabled: true\n[I] AmpereMfgLoader: SM86/SM75 MFG loaded successfully\n[I] nvLoadSignedLibraryW() failed on snippet nvngx_dlssnr.dll missing or corrupted\n');
    const findings=await graphicsFeatureFindings(dir,new Date(Date.now()-1000).toISOString());
    assert.equal(findings.length,3);assert.match(findings[0],/loaded.*not been measured/i);assert.match(findings[2],/did not load/);
    assert.deepEqual(await graphicsFeatureFindings(dir,new Date(Date.now()+120000).toISOString()),[]);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('late crash watcher ignores duplicate and old Windows reports',()=>{
  const prior={outcome:'crashed',baseline:{outcome:'launched',finishedAt:'2026-11-01T15:00:00Z'}};
  const since=watchSince(prior);
  assert.equal(since,'2026-11-01T15:00:00Z');
  const events=[{at:'2026-11-01T15:10:00Z',reportId:'seen'},{at:'2026-11-01T15:05:00Z',reportId:'new'},{at:'2026-11-01T14:59:00Z',reportId:'old'}];
  assert.equal(unseenCrash(events,[{crash:{reportId:'seen'}}],since)?.reportId,'new');
  assert.equal(watchSince({outcome:'crashed',finishedAt:'2026-11-01T15:20:00Z'}),null);
});
