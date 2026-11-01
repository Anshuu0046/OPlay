const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Components,normalizeCatalog,normalizeUnlocked,normalizeFsr,scanComponents,safeTarget,hash}=require('../src/components.cjs');
async function fixture(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oplay-components-'));try{const game={id:'fixture',name:'Fixture',installDir:path.join(dir,'game')};await fs.mkdir(game.installDir);const c=new Components(path.join(dir,'data'),async()=>({version:'1.0'}));await c.load();await fn(c,game,dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
test('catalog rejects unsigned/development files, non-HTTPS hosts and path-shaped versions',()=>{
  const good={version:'3.10.0.0',md5_hash:'a'.repeat(32),is_signature_valid:true,file_size:100,download_url:'https://dlss-swapper-downloads.beeradmoore.com/dlss/test.zip'};
  const rows=normalizeCatalog({dlss:[good,{...good,is_dev_file:true},{...good,is_signature_valid:false},{...good,download_url:'https://evil.example/dll.zip'},{...good,version:'../../escape'},{...good,download_url:'invalid'}]});assert.equal(rows.length,1);assert.equal(rows[0].name,'nvngx_dlss.dll');
});
test('community release requires a bounded GitHub package and SHA-256',()=>{
  const release={tag_name:'NR-v0.9.81',assets:[{name:'dlss-unlocked-standalone-NR-v0.9.81.zip',size:629523845,digest:'sha256:'+'a'.repeat(64),browser_download_url:'https://github.com/ShyVortex/dlss-unlocked/releases/download/NR-v0.9.81/package.zip'}]};
  assert.equal(normalizeUnlocked(release).sha256,'a'.repeat(64));
  assert.throws(()=>normalizeUnlocked({...release,tag_name:'../bad'}),/Unknown/);
  assert.throws(()=>normalizeUnlocked({...release,assets:[{...release.assets[0],digest:null}]}),/verified/);
  assert.throws(()=>normalizeUnlocked({...release,assets:[{...release.assets[0],browser_download_url:'https://evil.example/mod.zip'}]}),/host/);
  assert.equal(normalizeFsr({tag_name:'v2.4.0',body:'FSR Upscaling 4.1.2 and FSR Frame Generation 4.0.2',assets:[]}).upscaler,'4.1.2');
});
test('release feed checks on startup and after one day, not on each snapshot',()=>fixture(async(c)=>{
  let checks=0;c.refresh=async()=>{checks++;c.checkedAt=new Date().toISOString();return c.snapshot();};
  await c.refreshIfDue();await c.refreshIfDue();assert.equal(checks,1);
  c.checkedAt=new Date(Date.now()-25*60*60*1000).toISOString();await c.refreshIfDue();assert.equal(checks,2);
}));
test('game scan finds nested runtimes and anti-cheat indicators without following links',()=>fixture(async(c,game,dir)=>{
  await fs.mkdir(path.join(game.installDir,'bin'));await fs.writeFile(path.join(game.installDir,'bin','nvngx_dlss.dll'),'original');await fs.mkdir(path.join(game.installDir,'EasyAntiCheat'));
  const found=await scanComponents(game.installDir);assert.equal(found.files.length,1);assert.equal(found.files[0].kind,'dlss');assert.equal(found.risks.length,1);
  await assert.rejects(safeTarget(game.installDir,'../escape.dll'),/Invalid/);await assert.rejects(safeTarget(game.installDir,'C:\\Windows\\file.dll'),/Invalid/);
}));
test('runtime transaction backs up, verifies, survives restart and restores exact originals',()=>fixture(async(c,game,dir)=>{
  const target=path.join(game.installDir,'nvngx_dlss.dll'),source=path.join(dir,'new.dll');await fs.writeFile(target,'original bytes');await fs.writeFile(source,'replacement bytes');
  await c.transact(game,[{relative:'nvngx_dlss.dll',source}],'runtime');assert.equal(await fs.readFile(target,'utf8'),'replacement bytes');
  const fresh=new Components(c.directory,()=>{});await fresh.load();assert.equal(fresh.journal.length,1);await fresh.restore(fresh.journal[0].id);assert.equal(await fs.readFile(target,'utf8'),'original bytes');assert.equal(fresh.journal.length,0);
}));
test('restore preserves externally updated files and keeps the original backup',()=>fixture(async(c,game,dir)=>{
  const target=path.join(game.installDir,'nvngx_dlss.dll'),source=path.join(dir,'new.dll');await fs.writeFile(target,'original');await fs.writeFile(source,'replacement');await c.transact(game,[{relative:'nvngx_dlss.dll',source}],'runtime');await fs.writeFile(target,'game update');
  await assert.rejects(c.restore(c.journal[0].id),/Changed outside/);assert.equal(await fs.readFile(target,'utf8'),'game update');assert.equal(await fs.readFile(c.journal[0].changes[0].backup,'utf8'),'original');
}));
test('a staged write failure rolls back earlier writes and leaves no partial profile',()=>fixture(async(c,game,dir)=>{
  const a=path.join(game.installDir,'a.dll'),b=path.join(game.installDir,'b.dll'),source=path.join(dir,'new.dll');await fs.writeFile(a,'original-a');await fs.writeFile(b,'original-b');await fs.writeFile(source,'replacement');
  const rename=fs.rename;fs.rename=async(from,to)=>{if(path.basename(to)==='b.dll'&&path.basename(from).startsWith('.oplay-'))throw Error('injected locked game file');return rename(from,to);};
  try{await assert.rejects(c.transact(game,[{relative:'a.dll',source},{relative:'b.dll',source}],'profile'),/injected locked/);}finally{fs.rename=rename;}
  assert.equal(await fs.readFile(a,'utf8'),'original-a');assert.equal(await fs.readFile(b,'utf8'),'original-b');assert.equal(c.journal.length,0);assert.ok(!(await fs.readdir(game.installDir)).some(n=>n.startsWith('.oplay-')));
}));
test('profile uninstall removes only unchanged added files',()=>fixture(async(c,game,dir)=>{
  const source=path.join(dir,'proxy.dll');await fs.writeFile(source,'proxy');await c.transact(game,[{relative:'dxgi.dll',source}],'mod');await c.restore(c.journal[0].id);await assert.rejects(fs.stat(path.join(game.installDir,'dxgi.dll')),/ENOENT/);
}));
test('nested community files are restored with directories removed',()=>fixture(async(c,game,dir)=>{
  const source=path.join(dir,'module.dll');await fs.writeFile(source,'mod bytes');
  await c.transact(game,[{relative:path.join('OptiScaler','dlssg_sm86','module.dll'),source}],'community');
  assert.equal(await fs.readFile(path.join(game.installDir,'OptiScaler','dlssg_sm86','module.dll'),'utf8'),'mod bytes');
  await c.restore(c.journal[0].id);
  assert.deepEqual(await fs.readdir(game.installDir),[]);
}));
test('runtime swap remains reversible when a title has anti-cheat indicators',()=>fixture(async(c,game,dir)=>{
  game.name='Call of Duty fixture';await fs.mkdir(path.join(game.installDir,'EasyAntiCheat'));
  const target=path.join(game.installDir,'nvngx_dlss.dll'),source=path.join(dir,'source.dll');await fs.writeFile(target,'original');await fs.writeFile(source,'replacement');
  c.cache=[{id:'dlss:test',kind:'dlss',file:source,sha256:await hash(source),version:'1.0',label:'DLSS'}];
  await c.swap(game,'nvngx_dlss.dll','dlss:test');assert.equal(await fs.readFile(target,'utf8'),'replacement');
  await c.restore(c.journal[0].id);assert.equal(await fs.readFile(target,'utf8'),'original');
}));
test('direct runtime install adds a missing DLL beside an executable and restores it',()=>fixture(async(c,game,dir)=>{
  game.executable=path.join(game.installDir,'Game.exe');await fs.copyFile(process.execPath,game.executable);
  const source=path.join(dir,'source.dll');await fs.writeFile(source,'catalog runtime fixture');
  c.cache=[{id:'dlss:test',kind:'dlss',name:'nvngx_dlss.dll',file:source,sha256:await hash(source),version:'1.0',label:'DLSS'}];
  await c.installRuntime(game,'dlss:test');assert.equal(await fs.readFile(path.join(game.installDir,'nvngx_dlss.dll'),'utf8'),'catalog runtime fixture');
  await c.restore(c.journal[0].id);assert.deepEqual(await fs.readdir(game.installDir),['Game.exe']);
}));

test('linked folders and system roots cannot be used as component write targets',()=>fixture(async(c,game,dir)=>{
  const outside=path.join(dir,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'nvngx_dlss.dll'),'outside');
  await fs.symlink(outside,path.join(game.installDir,'linked'),'junction');
  await assert.rejects(safeTarget(game.installDir,path.join('linked','nvngx_dlss.dll')),/Linked/);
  assert.equal((await scanComponents(game.installDir)).files.length,0);
  await assert.rejects(scanComponents(process.env.SystemRoot),/system or drive root/);
}));
