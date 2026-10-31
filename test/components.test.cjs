const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Components,normalizeCatalog,scanComponents,safeTarget,hash}=require('../src/components.cjs');
async function fixture(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oplay-components-'));try{const game={id:'fixture',name:'Fixture',installDir:path.join(dir,'game')};await fs.mkdir(game.installDir);const c=new Components(path.join(dir,'data'),async()=>({version:'1.0'}));await c.load();await fn(c,game,dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
test('catalog rejects unsigned/development files, non-HTTPS hosts and path-shaped versions',()=>{
  const good={version:'3.10.0.0',md5_hash:'a'.repeat(32),is_signature_valid:true,file_size:100,download_url:'https://dlss-swapper-downloads.beeradmoore.com/dlss/test.zip'};
  const rows=normalizeCatalog({dlss:[good,{...good,is_dev_file:true},{...good,is_signature_valid:false},{...good,download_url:'https://evil.example/dll.zip'},{...good,version:'../../escape'},{...good,download_url:'invalid'}]});assert.equal(rows.length,1);assert.equal(rows[0].name,'nvngx_dlss.dll');
});
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

test('linked folders and system roots cannot be used as component write targets',()=>fixture(async(c,game,dir)=>{
  const outside=path.join(dir,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'nvngx_dlss.dll'),'outside');
  await fs.symlink(outside,path.join(game.installDir,'linked'),'junction');
  await assert.rejects(safeTarget(game.installDir,path.join('linked','nvngx_dlss.dll')),/Linked/);
  assert.equal((await scanComponents(game.installDir)).files.length,0);
  await assert.rejects(scanComponents(process.env.SystemRoot),/system or drive root/);
}));
