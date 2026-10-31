const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const path = require('node:path');
const fs = require('node:fs/promises');
const readline = require('node:readline');
const { Journal } = require('../src/journal.cjs');
const delay = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
  const outputs=path.resolve(__dirname,'../../../outputs');
  const idleDesktop=process.argv.includes('--idle-desktop'), windowState=path.join(outputs,'calibration-window-recovery.json');
  const idleWindows=action=>exec(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-File',path.join(__dirname,'idle-windows.ps1'),action,windowState],{windowsHide:true});
  const worker=spawn(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve(__dirname,'../src/worker.ps1')],{windowsHide:true});
  let sequence=0,pending=new Map(),started=false;
  const ask=q=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Windows helper timeout'));},20000);pending.set(id,{resolve,reject,timer});worker.stdin.write(JSON.stringify({...q,id})+'\n');});
  readline.createInterface({input:worker.stdout}).on('line',line=>{const r=JSON.parse(line),p=pending.get(r.id);if(!p)return;clearTimeout(p.timer);pending.delete(r.id);r.ok?p.resolve(r.data):p.reject(Error(r.error));});
  worker.stderr.on('data',b=>process.stderr.write(b));
  const journal=new Journal(path.join(outputs,'calibration-power-recovery.json'),ask);await journal.load();
  const report={at:new Date().toISOString(),samples:[],passed:false};
  const save=()=>fs.writeFile(path.join(outputs,'Aether-calibration-verification.json'),JSON.stringify(report,null,2));
  try{
    if(idleDesktop){await idleWindows('Minimize');console.log('Codex/browser windows minimized to avoid GPU-busy cancellation.');}
    if(journal.entries.length){const r=await journal.restore(null);if(r.skipped.length)throw Error('Previous CPU policy recovery needs review: '+r.skipped.join('; '));}
    report.beforeGpu=await ask({action:'gpu'});report.beforePower=await ask({action:'power'});
    report.initialVendor=await ask({action:'vendorScan',mode:'Navigate'});
    if(!report.initialVendor.available)throw Error('NVIDIA Performance panel is unavailable');
    if(report.initialVendor.running)throw Error('A vendor scan is already running; no new scan was started');
    const p='POWER:'+report.beforePower.scheme;
    await journal.apply('calibration',p,'BoostMode',0,'PowerAC');
    await journal.apply('calibration',p,'MaximumProcessorState',99,'PowerAC');
    await journal.apply('calibration',p,'EnergyPreference',60,'PowerAC');
    console.log('Temporary efficient AC policy applied for an idle calibration; original policy backed up.');
    let ready;
    for(let i=0;i<18;i++){
      ready=await ask({action:'vendorScan',mode:'Read'});report.samples.push({at:new Date().toISOString(),phase:'cooling',...ready});await save();
      console.log('Cooling:',ready.cpuTemperature,'C CPU;',ready.gpuTemperature,'C GPU');
      if(ready.cpuTemperature!=null && ready.cpuTemperature<85 && ready.gpuTemperature<80)break;
      await delay(5000);
    }
    if(ready.cpuTemperature==null || ready.cpuTemperature>=85 || ready.gpuTemperature>=80)throw Error('Thermal prerequisites not met; calibration was not started');
    // Let OEM power-plan callbacks settle before NVIDIA takes control of calibration.
    console.log('Waiting 30 seconds for the OEM power profile to settle.');
    for(let i=0;i<6;i++){
      await delay(5000);const state=await ask({action:'vendorScan',mode:'Read'});
      report.samples.push({at:new Date().toISOString(),phase:'settling',...state});await save();
      if(state.cpuTemperature>=90 || state.gpuTemperature>=80)throw Error('Thermal headroom was not stable before calibration');
    }
    report.start=await ask({action:'vendorScan',mode:'Start'});started=report.start.running;
    for(let i=0;!started&&i<6;i++){await delay(1000);report.start=await ask({action:'vendorScan',mode:'Read'});started=report.start.running;}
    if(!started)throw Error('NVIDIA did not start a scan. Check its confirmation/status: '+report.start.message);
    report.startedAt=new Date().toISOString();await save();console.log('NVIDIA automatic scan started.');
    const beginning=Date.now();let last;
    for(let i=0;i<1440;i++){
      await delay(5000);last=await ask({action:'vendorScan',mode:'Read'});report.samples.push({at:new Date().toISOString(),phase:'scan',...last});
      if(i%3===0)console.log('Scan:',Math.round((Date.now()-beginning)/1000),'seconds;',last.percent==null?'progress unavailable':last.percent+'%;',last.cpuTemperature,'C CPU;',last.gpuTemperature,'C GPU;',last.running?'running':last.message);
      if(last.gpuTemperature>=85 || last.cpuTemperature>=95)throw Error('Thermal safety limit reached; scan stop requested');
      await save();
      if(!last.running){
        started=false;report.finish=last;report.finishedAt=new Date().toISOString();
        if(Date.now()-beginning<60000 || /interrupt|fail|error|cancel/i.test(last.message) || /(?:days?|weeks?|months?|years?) ago/i.test(last.message))throw Error('Vendor scan ended without a verified successful new result: '+last.message);
        report.passed=true;break;
      }
    }
    if(!report.passed)throw Error('Vendor scan did not complete within two hours');
    report.afterGpu=await ask({action:'gpu'});
    report.scope='NVIDIA scanner completion only; not a before/after FPS comparison or CPU/system-RAM overclock.';
    console.log('PASS: NVIDIA calibration finished:',report.finish.message);
  }catch(e){report.error=e.message;console.error(e.message);process.exitCode=1;}
  finally{
    if(started)try{
      report.stop=await ask({action:'vendorScan',mode:'Stop'});
      for(let i=0;i<10&&report.stop.running;i++){await delay(500);report.stop=await ask({action:'vendorScan',mode:'Read'});}
    }catch(e){report.stopError=e.message;}
    report.powerRestore=await journal.restore(null);report.restoredPower=await ask({action:'power'});await save();worker.stdin.end();
    if(idleDesktop)await idleWindows('Restore');
    console.log('Original AC processor policy recovery:',JSON.stringify(report.powerRestore));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
