const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const path=require('node:path');
const fs=require('node:fs/promises');
const readline=require('node:readline');
const assert=require('node:assert/strict');
const {Journal}=require('../src/journal.cjs');
const exec=promisify(execFile),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const oldPid=Number(process.argv[2]);assert.ok(Number.isInteger(oldPid)&&oldPid>0);
  const outputs=path.resolve(__dirname,'../../../outputs'),file=path.join(outputs,'Aether-calibration-verification.json');
  const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const report=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(report.passed,false);assert.ok(report.startedAt);
  const worker=spawn(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve(__dirname,'../src/worker.ps1'),'-SkipNvml','-StayAwake'],{windowsHide:true});
  let sequence=0,pending=new Map(),active=false,handedOff=false;
  const ask=q=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Observer timeout'));},20000);pending.set(id,{resolve,reject,timer});worker.stdin.write(JSON.stringify({...q,id})+'\n');});
  readline.createInterface({input:worker.stdout}).on('line',line=>{const r=JSON.parse(line),p=pending.get(r.id);if(!p)return;clearTimeout(p.timer);pending.delete(r.id);r.ok?p.resolve(r.data):p.reject(Error(r.error));});
  worker.stderr.on('data',b=>process.stderr.write(b));
  const journal=new Journal(path.join(outputs,'calibration-power-recovery.json'),ask);await journal.load();assert.ok(journal.entries.length);
  const save=async()=>{await fs.writeFile(file+'.tmp',JSON.stringify(report,null,2));await fs.rename(file+'.tmp',file);};
  try{
    const initial=await ask({action:'vendorScan',mode:'Read'});assert.equal(initial.running,true,'No existing scan to adopt');
    const power=await ask({action:'power'});assert.equal(power.boost,0,'Cooling policy must remain active');
    await fs.writeFile(path.join(outputs,'calibration-observer-ready.json'),JSON.stringify({oldPid,observerPid:process.pid,initial,power}));
    console.log('Observer ready; waiting to adopt the existing scan without restarting NVIDIA.');
    let alive=true;
    for(let i=0;i<90;i++){try{process.kill(oldPid,0);}catch{alive=false;break;}await delay(1000);}
    if(alive)throw Error('Old observer was not released; no handoff made');
    handedOff=true;active=true;report.monitorHandoff={from:oldPid,to:process.pid,at:new Date().toISOString()};
    let progress=initial.percent||0,lastAdvance=Date.now();
    for(let i=0;i<1440;i++){
      const state=await ask({action:'vendorScan',mode:'Read'});report.samples.push({at:new Date().toISOString(),phase:'scan',...state});await save();
      if(i%3===0)console.log('Calibration',state.percent==null?'progress unavailable':state.percent+'%',state.cpuTemperature+'C CPU',state.gpuTemperature+'C GPU',state.running?'running':state.message);
      if(state.gpuTemperature>=85||state.cpuTemperature>=95)throw Error('Thermal safety limit reached');
      if(state.percent>progress){progress=state.percent;lastAdvance=Date.now();}
      if(!state.running&&state.available){
        active=false;report.finish=state;report.finishedAt=new Date().toISOString();
        if(/interrupt|fail|error|cancel/i.test(state.message)||/(?:days?|weeks?|months?|years?) ago/i.test(state.message)||!state.message.includes('Updated'))throw Error('NVIDIA did not report a successful new calibration: '+state.message);
        report.passed=true;break;
      }
      if(Date.now()-lastAdvance>1800000)throw Error('NVIDIA calibration made no progress for 30 minutes');
      await delay(5000);
    }
    if(!report.passed)throw Error('NVIDIA calibration exceeded the two-hour observation limit');
    report.scope='NVIDIA-reported scanner completion; not a game FPS comparison or a CPU/system-RAM overclock.';
    console.log('PASS: NVIDIA scanner finished:',report.finish.message);
  }catch(e){if(handedOff){report.error=e.message;report.passed=false;}console.error(e.message);process.exitCode=1;}
  finally{
    if(handedOff){
      if(active)try{report.stop=await ask({action:'vendorScan',mode:'Stop'});for(let i=0;i<10&&report.stop.running;i++){await delay(500);report.stop=await ask({action:'vendorScan',mode:'Read'});}}catch(e){report.stopError=e.message;}
      report.powerRestore=await journal.restore(null);report.restoredPower=await ask({action:'power'});await save();
      await exec(ps,['-NoProfile','-File',path.join(__dirname,'idle-windows.ps1'),'Restore',path.join(outputs,'calibration-window-recovery.json')],{windowsHide:true});
      console.log('Original CPU policy and window states restored.');
    }
    worker.stdin.end();
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
