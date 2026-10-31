const {GpuControl}=require('../src/gpu-control.cjs');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const {execFileSync}=require('node:child_process');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const deltas=curve=>curve.points.map(p=>p.deltaKHz);
(async()=>{
  const gpu=new GpuControl(path.resolve(__dirname,'../src'));let heartbeat;
  const report={at:new Date().toISOString(),passed:false};
  try{
    console.log('Waiting for Windows administrator approval for a reversible V/F curve test.');
    const before=await gpu.enable();heartbeat=setInterval(()=>gpu.request('state').catch(()=>{}),5000);
    assert.equal(before.curve.available,true);assert.ok(before.temperature<80);report.before=before;
    const anchor=before.curve.points.find(p=>p.voltageUV===850000);assert.ok(anchor);
    const megahertz=Math.ceil(anchor.frequencyKHz/15000)*15+15;
    await assert.rejects(gpu.request('curve',{millivolts:100,megahertz}),/650|1000|curve|voltage/i);
    let applied=await gpu.request('curve',{millivolts:850,megahertz});report.applied=applied;report.target={millivolts:850,megahertz};
    assert.notDeepEqual(deltas(applied.curve),deltas(before.curve));
    await delay(2000);applied=await gpu.request('state');
    for(const p of applied.curve.points.filter(p=>p.voltageUV>=850000))assert.ok(Math.abs(p.frequencyKHz-megahertz*1000)<=15000,'Effective curve must flatten near the target');
    assert.equal(applied.curve.controlled,true);
    const restored=await gpu.request('restore');assert.deepEqual(deltas(restored.curve),deltas(before.curve));assert.deepEqual(restored.offsets,before.offsets);report.explicitRestore=true;
    await gpu.request('curve',{millivolts:850,megahertz});clearInterval(heartbeat);heartbeat=null;
    console.log('Curve read-back and explicit restore passed. Testing 23-second watchdog lease expiry.');
    await delay(23000);
    const output=execFileSync('powershell.exe',['-NoProfile','-File',path.resolve(__dirname,'../src/worker.ps1')],{input:'{"id":1,"action":"gpu"}\n',windowsHide:true,encoding:'utf8'});
    const after=JSON.parse(output.trim());assert.equal(after.ok,true);assert.deepEqual(deltas(after.data.curve),deltas(before.curve));assert.deepEqual(after.data.offsets,before.offsets);
    assert.equal(await fs.stat(path.join(process.env.LOCALAPPDATA,'Aether/gpu-curve-recovery.json')).then(()=>true,()=>false),false);
    report.watchdogRestore=true;report.passed=true;
    report.scope='Real NVAPI Ampere V/F curve write, effective flattening read-back, invalid voltage rejection, exact original delta/offset restore and heartbeat-expiry recovery. No game stability/FPS or hard voltage-limit guarantee.';
    console.log('PASS: real GPU curve apply, effective read-back, explicit restore, invalid voltage rejection and watchdog recovery.');
  }catch(e){report.error=e.message;throw e;}
  finally{clearInterval(heartbeat);await gpu.close();await fs.writeFile(path.resolve(__dirname,'../../../outputs/Aether-curve-verification.json'),JSON.stringify(report,null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
