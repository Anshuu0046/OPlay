const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ErrorLog}=require('../src/error-log.cjs');
test('error logs preserve diagnostics, redact credentials, deduplicate and rotate',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aether-log-'));let time=Date.now();
  try{
    const log=new ErrorLog(dir,{maxBytes:900,backups:2,now:()=>time});
    const error=Error('token=private password: hidden -EncodedCommand U2VjcmV0');
    assert.equal(log.write('test',error),true);assert.equal(log.write('test',error),false);
    const first=fs.readFileSync(log.file,'utf8');assert.ok(first.includes('stack'));assert.ok(!/private|hidden|U2VjcmV0/.test(first));
    time+=61000;assert.equal(log.write('test',error),true);
    for(let i=0;i<30;i++)assert.equal(log.write('failure-'+i,'x'.repeat(200)),true);
    assert.deepEqual(fs.readdirSync(dir).sort(),['errors.jsonl','errors.jsonl.1','errors.jsonl.2']);
    for(const name of fs.readdirSync(dir))for(const line of fs.readFileSync(path.join(dir,name),'utf8').trim().split('\n'))assert.ok(JSON.parse(line).at);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('log storage failure never throws or breaks recovery',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aether-log-'));
  try{const file=path.join(dir,'file');fs.writeFileSync(file,'occupied');assert.equal(new ErrorLog(file).write('test',Error('failed')),false);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
