const {_electron:electron}=require('playwright');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
  const target=process.argv[2],environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;
  const results=[];
  for(let run=0;run<3;run++){
    const app=await electron.launch({...(target?{executablePath:path.resolve(target),args:['--aether-test']}:{args:[path.resolve(__dirname,'..'),'--aether-test']}),env:environment,timeout:60000});
    let profile;
    try{
      const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.waitForFunction(()=>document.querySelector('#library-metrics').children.length===4,{timeout:60000});
      const state=await page.evaluate(()=>window.aether.snapshot());profile=state.dataPath;assert.equal(state.test,true);
      for(let i=0;i<40;i++){
        const tab=['library','optimize','tuning','activity'][i%4];await page.locator('.rail-item[data-page="'+tab+'"]').click();
        assert.equal(await page.locator('#page-'+tab).isVisible(),true);
        assert.equal((await page.evaluate(()=>window.aether.snapshot())).games.length,state.games.length);
      }
      // Validate the worker identity against this isolated app before terminating only that helper.
      const mainPid=await app.evaluate(() => process.pid);
      const script=`$ProgressPreference='SilentlyContinue'; $items=@(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${mainPid}" | Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'worker\\.ps1' }); if($items.Count -ne 1){throw 'Expected exactly one owned helper'}; $item=$items[0]; Stop-Process -Id $item.ProcessId -ErrorAction Stop; $item.ProcessId`;
      const workerPid=Number(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8'}).trim());assert.ok(workerPid>0);
      await page.waitForFunction(()=>/helper stopped/.test(document.querySelector('#footer-detail').textContent),{timeout:30000});
      assert.equal((await page.evaluate(()=>window.aether.snapshot())).games.length,state.games.length);
      const logs=(await fs.readFile(path.join(state.logPath,'errors.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
      assert.ok(logs.some(e=>e.source==='helper-stopped'));assert.deepEqual(errors,[]);
      if(run===0){
        await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
        let crashed=false;
        for(let i=0;i<50;i++){
          const content=await fs.readFile(path.join(state.logPath,'errors.jsonl'),'utf8');
          if(content.includes('renderer-crash')){crashed=true;break;}
          await new Promise(r=>setTimeout(r,100));
        }
        assert.equal(crashed,true,'Renderer process crash must be logged by the main process');
        const saved=JSON.parse(await fs.readFile(path.join(profile,'library.json'),'utf8'));
        assert.equal(saved.games.length,state.games.length);
      }
      results.push({run:run+1,tabChanges:40,snapshots:41,helperFailureLogged:true,libraryRemainedReadable:true,unexpectedRendererErrors:errors});
      if(run===0)results.at(-1).rendererCrashLoggedAndLibraryPersisted=true;
      console.log('PASS: resilience run',run+1,'navigation, snapshots, forced helper failure, persistent logging, responsive library.');
    }finally{
      await app.close();
      if(profile&&path.basename(profile).startsWith('aether-test-'))await fs.rm(profile,{recursive:true,force:true});
    }
  }
  await fs.writeFile(path.resolve(__dirname,'../../../outputs/Aether-resilience-verification.json'),JSON.stringify({at:new Date().toISOString(),passed:true,results,scope:'Three fresh isolated app sessions; deliberate helper termination and a renderer process crash followed by fresh successful app launches. No user games closed or hardware offsets changed.'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
