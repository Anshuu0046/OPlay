const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {Components,hash}=require('../src/components.cjs');
const exec=promisify(execFile);

async function main(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'oplay-unlocked-fixture-'));
  const gameDir=path.join(root,'game'),dataDir=path.join(root,'data');
  const report={passed:false,scope:'generated closed-game fixture only',installedFiles:0,release:null,originalsRestored:false};
  try{
    await fs.mkdir(gameDir);
    const executable=path.join(gameDir,'FixtureGame.exe');await fs.copyFile(process.execPath,executable);
    const game={id:'isolated-fixture',name:'Isolated fixture',installDir:gameDir,executable};
    const inspector=async file=>{const result=await exec(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-File',path.resolve(__dirname,'../src/component-tools.ps1'),'-Action','Inspect','-File',file],{windowsHide:true,timeout:30000});return JSON.parse(result.stdout);};
    const components=new Components(dataDir,inspector);await components.load();await components.refresh();
    const release=components.community;assert.ok(release,'Latest community release was not found');report.release=release.tag;
    const cache=path.join(dataDir,'unlocked',release.sha256);await fs.mkdir(cache,{recursive:true});
    const archive=path.join(cache,release.name),seed=process.argv[2];
    if(seed){assert.equal(await hash(seed),release.sha256,'Provided archive does not match the current upstream release');await fs.link(path.resolve(seed),archive);}
    await fs.writeFile(path.join(gameDir,'winmm.dll'),'existing graphics proxy');
    await components.installUnlocked(game);
    assert.equal(components.snapshot().communityCached,true,'Community download should be visible in Runtime library');
    const transaction=components.journal[0];assert.equal(transaction.status,'installed');report.installedFiles=transaction.changes.length;
    for(const name of ['dxgi.dll','OptiScaler.ini','nvngx_dlssnr.dll',path.join('OptiScaler','dlssg_sm86','dlssg_sm86.dll')])assert.ok((await fs.stat(path.join(gameDir,name))).size>0,name+' missing');
    assert.ok((await fs.stat(path.join(gameDir,'nvngx_dlssg.dll'))).size>0,'Signed DLSS-G 310.x runtime missing');
    await assert.rejects(fs.stat(path.join(gameDir,'winmm.dll')),/ENOENT/,'Existing proxy should be staged during the install');
    assert.ok(transaction.changes.length>=40,'Expected bundled modules, not only a proxy');
    const restart=new Components(dataDir,inspector);await restart.load();assert.equal(restart.snapshot().communityCached,true,'Downloaded package should remain visible after restart');await restart.restore(transaction.id);
    assert.deepEqual(await fs.readdir(gameDir),['FixtureGame.exe','winmm.dll']);assert.equal(await fs.readFile(path.join(gameDir,'winmm.dll'),'utf8'),'existing graphics proxy');report.originalsRestored=true;report.passed=true;
    console.log('PASS: verified '+release.tag+', installed '+report.installedFiles+' community files into a generated fixture, reopened journal and restored the initial folder exactly.');
  }finally{
    const output=path.resolve(__dirname,'../../../outputs/OPlay-unlocked-verification.json');await fs.writeFile(output,JSON.stringify(report,null,2));
    if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('oplay-unlocked-fixture-'))await fs.rm(root,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
