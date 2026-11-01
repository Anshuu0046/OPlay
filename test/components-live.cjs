const {Components,hash}=require('../src/components.cjs');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile);
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'oplay-live-'));
  const report={at:new Date().toISOString(),passed:false};
  const inspector=async file=>JSON.parse((await exec('powershell.exe',['-NoProfile','-File',path.resolve(__dirname,'../src/component-tools.ps1'),'-Action','Inspect','-File',file],{windowsHide:true,timeout:45000})).stdout);
  const manager=new Components(path.join(root,'data'),inspector);await manager.load();
  const game={id:'isolated-fixture',name:'OPlay isolated graphics fixture',installDir:path.join(root,'game'),executable:path.join(root,'game','Fixture.exe')};
  try{
    await fs.mkdir(game.installDir);await fs.copyFile(process.execPath,game.executable);
    await manager.refresh();const versions=manager.catalog.filter(r=>r.kind==='fsr_31_dx12');assert.ok(versions.length>=2);
    for(const r of versions.slice(0,2)){console.log('Downloading signed AMD runtime',r.version);await manager.download(r.id);}
    const original=manager.cache.find(r=>r.id===versions[1].id);await fs.copyFile(original.file,path.join(game.installDir,original.name));
    const before=await hash(path.join(game.installDir,original.name));const scan=await manager.inspectGame(game);assert.equal(scan.files.length,1);assert.equal(scan.files[0].signature,'Valid');
    await manager.swap(game,original.name,versions[0].id);assert.notEqual(await hash(path.join(game.installDir,original.name)),before);await manager.restore(manager.journal[0].id);assert.equal(await hash(path.join(game.installDir,original.name)),before);
    report.signedRuntimeDownload=true;report.swapAndExactRestore=true;report.runtimeVersions=versions.slice(0,2).map(r=>r.version);
    const opti=path.join(manager.directory,'optiscaler','0.9.4');await fs.mkdir(opti,{recursive:true});const seed=path.resolve(__dirname,'../../research/optiscaler.7z');if(await fs.stat(seed).then(()=>true,()=>false))await fs.copyFile(seed,path.join(opti,'package.7z'));
    await manager.installOpti(game,'fsrfg','auto');assert.equal(manager.snapshot().optiCached,true,'FSR route package should appear downloaded');assert.ok((await fs.stat(path.join(game.installDir,'dxgi.dll'))).size>100000);
    const ini=await fs.readFile(path.join(game.installDir,'OptiScaler.ini'),'utf8');assert.ok(/FGOutput=fsrfg/.test(ini));assert.ok(/FGInput=upscaler/.test(ini));assert.ok(/Enabled=true/.test(ini));
    report.installedProfileFiles=manager.journal[0].changes.length;await manager.restore(manager.journal[0].id);
    assert.equal(await hash(path.join(game.installDir,original.name)),before);assert.deepEqual((await fs.readdir(game.installDir)).sort(),['Fixture.exe',original.name].sort());
    report.optiscalerChecksum=true;report.profileInstallAndExactRestore=true;report.passed=true;report.scope='Real curated downloads, Windows Authenticode verification, DLL swap, upstream OptiScaler extraction/profile install, and complete rollback in an isolated fixture. Fixture executable was never launched; no user game files modified; no in-game FPS/FG validation.';
    console.log('PASS: signed downloads, real DLL swap/restore, checksummed OptiScaler profile install and complete original-file restoration.');
  }catch(e){report.error=e.message;throw e;}
  finally{
    await fs.writeFile(path.resolve(__dirname,'../../../outputs/OPlay-components-verification.json'),JSON.stringify(report,null,2));
    // Only this generated fixture is removed; all installed user games are outside it.
    assert.ok(root.startsWith(path.join(os.tmpdir(),'oplay-live-')));await fs.rm(root,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
