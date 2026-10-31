const {spawn,execFileSync}=require('node:child_process');
const readline=require('node:readline');
const fs=require('node:fs');
const path=require('node:path');
const {Journal}=require('../src/journal.cjs');
(async()=>{
  const out=path.resolve(__dirname,'../../../outputs');
  const worker=spawn('powershell.exe',['-NoProfile','-File',path.resolve(__dirname,'../src/worker.ps1'),'-SkipNvml'],{windowsHide:true});
  let id=0;const pending=new Map();
  readline.createInterface({input:worker.stdout}).on('line',line=>{const r=JSON.parse(line),p=pending.get(r.id);if(p){clearTimeout(p.timer);pending.delete(r.id);r.ok?p.resolve(r.data):p.reject(Error(r.error));}});
  const ask=q=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(Error('Recovery timeout')),30000);pending.set(n,{resolve,reject,timer});worker.stdin.write(JSON.stringify({...q,id:n})+'\n');});
  try{
    const state=await ask({action:'vendorScan',mode:'Read'});if(state.running)throw Error('Scanner is active; recovery deferred');
    const journal=new Journal(path.join(out,'calibration-power-recovery.json'),ask);await journal.load();
    const recovery=await journal.restore(null),power=await ask({action:'power'});
    const report=JSON.parse(fs.readFileSync(path.join(out,'Aether-calibration-verification.json'),'utf8'));
    report.passed=false;report.error='Observer and NVIDIA window closed before completion could be verified.';
    report.powerRestore=recovery;report.restoredPower=power;report.recoveredAt=new Date().toISOString();
    fs.writeFileSync(path.join(out,'Aether-calibration-verification.json'),JSON.stringify(report,null,2));
    execFileSync('powershell.exe',['-NoProfile','-File',path.join(__dirname,'idle-windows.ps1'),'Restore',path.join(out,'calibration-window-recovery.json')],{windowsHide:true});
    console.log({recovery,power});if(recovery.skipped.length)throw Error('Recovery incomplete');
  }finally{worker.stdin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
