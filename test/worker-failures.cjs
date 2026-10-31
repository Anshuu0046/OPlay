const {spawn}=require('node:child_process');
const readline=require('node:readline');
const path=require('node:path');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
(async()=>{
  const worker=spawn('powershell.exe',['-NoProfile','-File',path.resolve(__dirname,'../src/worker.ps1'),'-SkipNvml'],{windowsHide:true});
  let waiting,id=0;
  const ask=value=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker response timeout')),15000);waiting=r=>{clearTimeout(timer);resolve(r);};worker.stdin.write(typeof value==='string'?value+'\n':JSON.stringify({...value,id:++id})+'\n');});
  readline.createInterface({input:worker.stdout}).on('line',line=>{assert.ok(waiting);const reply=waiting;waiting=null;reply(JSON.parse(line));});
  try{
    const before=await ask({action:'power'});assert.equal(before.ok,true);
    const bad=[
      {action:'unsupported'},
      {action:'read',path:'HKLM:\\SOFTWARE',name:'Test'},
      {action:'write',path:'HKCU:\\Software\\AetherUnapproved',name:'Test',kind:'DWord',value:1},
      {action:'vendorScan',mode:'unsupported'},
      {action:'write',path:'POWER:'+before.data.scheme,name:'BoostMode',kind:'PowerAC',value:101,expected:{exists:true,kind:'PowerAC',value:before.data.boost}},
      {action:'write',path:'POWER:'+before.data.scheme,name:'MaximumProcessorState',kind:'PowerAC',value:99,expected:{exists:true,kind:'PowerAC',value:-123}}
    ];
    for(let round=0;round<20;round++)for(const request of bad){const response=await ask(request);assert.equal(response.ok,false,JSON.stringify(request));assert.ok(response.error);}
    const malformed=await ask('{malformed-json');assert.equal(malformed.ok,false);assert.equal(malformed.id,null,'Malformed requests must not reuse an earlier operation id');
    const after=await ask({action:'power'});assert.equal(after.ok,true);assert.deepEqual(after.data,before.data);
    const report={at:new Date().toISOString(),passed:true,rejectedRequests:121,powerUnchanged:true,scope:'Repeated unsupported operations, registry allowlist, invalid power value, stale ownership, malformed JSON, and recovery to a valid request. No GPU writes.'};
    await fs.writeFile(path.resolve(__dirname,'../../../outputs/Aether-failure-verification.json'),JSON.stringify(report,null,2));
    console.log('PASS: 121 invalid helper requests rejected, original power policy unchanged, subsequent valid request succeeds.');
  }finally{worker.stdin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
