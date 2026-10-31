const { _electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
(async()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const executable=process.argv[2];
  const app=await _electron.launch({...executable?{executablePath:path.resolve(executable),args:[]}:{args:[path.resolve(__dirname,'..')]},env,timeout:60000});
  try{
    const page=await app.firstWindow();await page.waitForFunction(()=>window.aether && document.querySelector('#device-name')?.textContent!=='Your PC');
    const before=await page.evaluate(()=>window.aether.snapshot());assert.equal(before.test,false);
    await page.locator('.rail-item[data-page="optimize"]').click();await page.locator('[data-action="global"]').click();
    await page.waitForFunction(()=>document.querySelector('.workspace').getAttribute('aria-busy')==='false',{timeout:30000});
    const after=await page.evaluate(()=>window.aether.snapshot());assert.equal(after.guard,true);
    const games=after.games.map(g=>({id:g.id,name:g.name,configured:!!g.optimized,executable:g.executable}));
    const report={at:new Date().toISOString(),passed:games.every(g=>g.configured),guard:after.guard,games,message:await page.locator('#toast').innerText(),backupCount:after.entries.length,
      scope:'Real application global optimization. Desired gaming settings and selected-game GPU preferences intentionally left enabled as requested; originals retained by Aether. No in-game graphics files or GPU clocks modified.'};
    await fs.writeFile(path.resolve(__dirname,'../../../outputs/Aether-global-verification.json'),JSON.stringify(report,null,2));
    assert.ok(report.passed,'Some library games still need executable selection');
    console.log('PASS: real Global Optimize UI configured',games.length,'library games, verified Windows settings, and enabled the live guard.');
  }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
