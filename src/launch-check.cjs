const fs = require('node:fs/promises');
const path = require('node:path');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const PROXIES = new Set(['dxgi.dll', 'dinput8.dll', 'version.dll', 'winmm.dll', 'nvapi64.dll', 'd3d12.dll']);

async function proxyFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter(entry => entry.isFile() && PROXIES.has(entry.name.toLowerCase())).map(entry => entry.name).sort();
}
async function gameLogHints(root, since) {
  const hints=[];
  for(const name of ['OptiScaler.log','dlss-enabler.log','fakenvapi.log']){
    const file=path.join(root,name);
    try{
      const info=await fs.stat(file);
      if(!info.isFile()||info.mtimeMs<Date.parse(since)-60000)continue;
      const handle=await fs.open(file,'r');
      let content;
      try{const size=Math.min(info.size,65536),buffer=Buffer.alloc(size);await handle.read(buffer,0,size,info.size-size);content=buffer.toString('utf8');}finally{await handle.close();}
      for(const line of content.split(/\r?\n/).filter(line=>/\b(error|failed|device.*suspend|gpu fence|bad000)/i.test(line)).slice(-3))hints.push({source:name,text:line.slice(0,400)});
    }catch(error){if(error.code!=='ENOENT')hints.push({source:name,text:'Log could not be read: '+error.message});}
  }
  return hints.slice(-6);
}
function watchSince(item){return item?.baseline?.outcome==='launched'?item.baseline.finishedAt:item?.outcome==='launched'?item.finishedAt:null;}
function unseenCrash(events,history,since){return events.find(event=>Date.parse(event.at)>Date.parse(since)&&!history.some(item=>item.crash?.reportId===event.reportId));}

function explain(result, proxies) {
  const crash = result.crash;
  if (crash) {
    const code = String(crash.code || '').toLowerCase().replace(/^0x/, '');
    if (result.gpuEvents?.length) return `Windows recorded a GPU driver event during this session, followed by exception 0x${code || 'unknown'} in ${crash.module || 'an unknown module'}. The game's graphics logs and GPU tuning should be checked; the driver event does not identify one mod or clock as the cause.`;
    if (code === 'c00000fd') return proxies.length > 1
      ? 'Windows reported a stack overflow. Multiple graphics proxy DLLs are present; a recursive hook conflict is a likely cause. Restore the new OPlay package and test the original game files.'
      : 'Windows reported a stack overflow. A graphics hook or game code may be recursing. Test without the newly installed package.';
    if (code === 'c0000005') return 'Windows reported an access violation. A game or injected DLL accessed invalid memory; test without the newly installed package.';
    return `Windows reported exception 0x${code || 'unknown'} in ${crash.module || 'an unknown module'}. Test without the newly installed package.`;
  }
  if (result.outcome === 'launched') return 'The game process remained open through the startup check. OPlay watches Windows crash events for up to 90 minutes while open. This does not verify menus, gameplay or frame generation.';
  if (result.outcome === 'not-started') return 'No process appeared before the launch timeout. Check the launcher, sign-in prompts and game executable.';
  return 'The process ended during startup, but Windows did not record an application crash. Check the game and launcher logs.';
}

async function observeLaunch({ launch, running, crashes, onUpdate = () => {}, wait = sleep, now = Date.now, startTimeoutMs = 75000, stableMs = 25000, pollMs = 1000 }) {
  const startedAt = new Date(now()).toISOString();
  const start = now();
  let firstSeen = null, lastNames = [];
  onUpdate('launching');
  await launch();
  while (now() - start < startTimeoutMs + stableMs) {
    await wait(pollMs);
    const names = await running();
    if (names.length) {
      lastNames = names;
      if (firstSeen === null) { firstSeen = now(); onUpdate('observing'); }
      if (now() - firstSeen >= stableMs) break;
    } else if (firstSeen !== null) break;
    else if (now() - start >= startTimeoutMs) break;
  }
  // Windows Error Reporting may write Event 1000 shortly after process exit.
  if (firstSeen !== null && !(await running()).length) await wait(2500);
  const events = await crashes(startedAt);
  const crash = events[0] || null;
  const outcome = crash ? 'crashed' : firstSeen === null ? 'not-started' : (await running()).length ? 'launched' : 'early-exit';
  return { startedAt, finishedAt: new Date(now()).toISOString(), outcome, firstSeenAt: firstSeen === null ? null : new Date(firstSeen).toISOString(), processNames: lastNames, crash };
}

module.exports = { observeLaunch, explain, proxyFiles, gameLogHints, watchSince, unseenCrash };
