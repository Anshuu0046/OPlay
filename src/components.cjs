const fs = require('node:fs/promises');
const {createReadStream} = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {saveJson, readJson} = require('./core.cjs');
const exec = promisify(execFile);
const TYPES = {
  dlss: ['DLSS Super Resolution', 'nvngx_dlss.dll'], dlss_d: ['DLSS Ray Reconstruction', 'nvngx_dlssd.dll'],
  dlss_g: ['DLSS Frame Generation', 'nvngx_dlssg.dll'], fsr_31_dx12: ['FSR DX12 runtime', 'amd_fidelityfx_dx12.dll'],
  fsr_31_vk: ['FSR Vulkan runtime', 'amd_fidelityfx_vk.dll'], xess: ['XeSS Super Resolution', 'libxess.dll'],
  xell: ['Xe Low Latency', 'libxell.dll'], xess_fg: ['XeSS Frame Generation', 'libxess_fg.dll'], xess_dx11: ['XeSS DX11', 'libxess_dx11.dll']
};
const CATALOG = 'https://beeradmoore.github.io/dlss-swapper/manifest.json';
const OPTI = {version:'0.9.4',url:'https://github.com/optiscaler/OptiScaler/releases/download/v0.9.4/Optiscaler_0.9.4-final.20260718._MM.7z',sha256:'575cb4df866116093df75af607e37fd70e10f5163e0f23fd5c804142e80ef0ad'};
const under = (root,file) => {const r=path.relative(root,file);return !!r && !r.startsWith('..'+path.sep) && r!=='..' && !path.isAbsolute(r);};
async function hash(file,algorithm='sha256') {const h=crypto.createHash(algorithm);for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
async function replaceFile(source,target,expectedHash) {
  const stage=path.join(path.dirname(target),'.oplay-'+crypto.randomUUID()+'.tmp');
  const handle=await fs.open(stage,'wx');await handle.close();
  try{await fs.copyFile(source,stage);if(await hash(stage)!==expectedHash)throw Error('Staged component hash differs');await fs.rename(stage,target);}
  finally{await fs.rm(stage,{force:true});}
}
async function regular(file,maxBytes=268435456) {const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>maxBytes)throw Error('Expected a regular file below 256 MiB');return s;}
async function pe64(file,executable=false) {await regular(file,executable?2147483648:268435456);const f=await fs.open(file,'r');try{const b=Buffer.alloc(64);await f.read(b,0,64,0);if(b.toString('ascii',0,2)!=='MZ')throw Error('Not a Windows PE file');const off=b.readUInt32LE(60);if(off>1048576)throw Error('Invalid PE header');const pe=Buffer.alloc(6);await f.read(pe,0,6,off);if(pe.readUInt32LE(0)!==0x4550||pe.readUInt16LE(4)!==0x8664)throw Error('Only Windows x64 components are supported');}finally{await f.close();}}
async function safeTarget(root,relative) {
  if(typeof relative!=='string'||path.isAbsolute(relative)||relative.includes(':')||!under(root,path.resolve(root,relative)))throw Error('Invalid component path');
  const file=path.resolve(root,relative);let current=root;
  for(const segment of path.relative(root,path.dirname(file)).split(path.sep).filter(Boolean)){current=path.join(current,segment);const s=await fs.lstat(current);if(s.isSymbolicLink()||!s.isDirectory())throw Error('Linked component directories are not supported');}
  try{await regular(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!under(await fs.realpath(root),path.join(await fs.realpath(path.dirname(file)),path.basename(file))))throw Error('Component path escaped its game folder');
  return file;
}
async function fetchBytes(url,max,hosts) {
  for(let redirects=0;redirects<6;redirects++){
    const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.has(u.hostname))throw Error('Download host is not trusted');
    const response=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(180000),headers:{'User-Agent':'OPlay/2.0'}});
    if(response.status>=300&&response.status<400){url=new URL(response.headers.get('location'),u).href;continue;}
    if(!response.ok)throw Error('Download failed: HTTP '+response.status);
    if(Number(response.headers.get('content-length'))>max)throw Error('Download exceeds size limit');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>max)throw Error('Download exceeds size limit');chunks.push(Buffer.from(chunk));}
    return Buffer.concat(chunks);
  }throw Error('Too many download redirects');
}
function normalizeCatalog(manifest) {
  const records=[];
  for(const [kind,[label,name]] of Object.entries(TYPES)){
    const items=(Array.isArray(manifest[kind])?manifest[kind]:[]).filter(r=>r.is_signature_valid===true&&!r.is_dev_file&&/^\d+(\.\d+){1,3}$/.test(r.version)&&/^[a-f0-9]{32}$/i.test(r.md5_hash)&&r.file_size>0&&r.file_size<=268435456);
    items.sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}));
    for(const r of items.slice(0,24)){
      let u;try{u=new URL(r.download_url);}catch{continue;}if(u.protocol!=='https:'||u.hostname!=='dlss-swapper-downloads.beeradmoore.com'||u.port||u.username||u.password)continue;
      records.push({id:kind+':'+r.md5_hash.toLowerCase(),kind,label,name,version:r.version,size:r.file_size,url:u.href,md5:r.md5_hash.toLowerCase()});
    }
  }return records;
}
async function gameRoot(root) {
  root=await fs.realpath(root);
  const system=process.env.SystemRoot;
  if(root===path.parse(root).root || [os.homedir(),process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.ProgramData].filter(Boolean).some(p=>path.relative(p,root)==='') || (system && (path.relative(system,root)==='' || under(system,root)))) throw Error('Choose a specific game folder, not a system or drive root');
  return root;
}
async function scanComponents(root) {
  root=await gameRoot(root);let inspected=0;const files=[],risks=[],warnings=[];
  async function walk(dir,depth){
    if(depth>8||inspected>=20000)return;
    let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch(e){warnings.push(path.relative(root,dir)+': '+e.code);return;}
    for(const e of entries){if(++inspected>20000)break;if(e.isSymbolicLink())continue;const file=path.join(dir,e.name);
      if(/easyanticheat|battleye|ricochet|anti.?cheat|vgk\.sys/i.test(e.name))risks.push(path.relative(root,file));
      if(e.isDirectory()&&!/^(\.git|node_modules|\.oplay|_oplay|redist|__installer|backup|backups)$/i.test(e.name))await walk(file,depth+1);
      if(e.isFile()){const type=Object.entries(TYPES).find(([,v])=>v[1]===e.name.toLowerCase());if(type)files.push({relative:path.relative(root,file),kind:type[0],label:type[1][0],name:type[1][1],size:(await fs.stat(file)).size});}
    }
  }
  await walk(root,0);if(inspected>=20000)warnings.push('Scan limited to 20,000 entries. Choose a smaller game folder.');
  return {root,files,risks,warnings,inspected};
}
class Components {
  constructor(directory,inspect) {this.directory=directory;this.inspect=inspect;this.catalog=[];this.cache=[];this.journal=[];this.file=path.join(directory,'transactions.json');}
  async load(){await fs.mkdir(this.directory,{recursive:true});this.catalog=await readJson(path.join(this.directory,'catalog.json'),[]);this.cache=await readJson(path.join(this.directory,'cache.json'),[]);this.journal=await readJson(this.file,[]);}
  snapshot(){return {catalog:this.catalog,cache:this.cache.map(({file,...record})=>record),transactions:this.journal.map(({changes,...record})=>({...record,files:changes.map(({relative})=>relative)})),optiscaler:OPTI};}
  async refresh(){const bytes=await fetchBytes(CATALOG,8000000,new Set(['beeradmoore.github.io']));this.catalog=normalizeCatalog(JSON.parse(bytes.toString('utf8')));await saveJson(path.join(this.directory,'catalog.json'),this.catalog);return this.snapshot();}
  async download(id){
    const record=this.catalog.find(r=>r.id===id);if(!record)throw Error('Refresh the catalog and choose a listed component');
    const cached=this.cache.find(r=>r.id===id);if(cached&&await hash(cached.file).catch(()=>null)===cached.sha256)return this.snapshot();
    const dir=path.join(this.directory,'downloads',crypto.createHash('sha256').update(id).digest('hex'));await fs.mkdir(dir,{recursive:true});
    const archive=path.join(dir,'package.zip'),file=path.join(dir,record.name);await fs.rm(file,{force:true});
    await fs.writeFile(archive,await fetchBytes(record.url,134217728,new Set(['dlss-swapper-downloads.beeradmoore.com'])));
    const script=path.join(__dirname,'component-tools.ps1').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
    await exec(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-File',script,'-Action','ExtractZip','-File',archive,'-Destination',file,'-Name',record.name],{windowsHide:true,timeout:30000});
    await pe64(file);if(await hash(file,'md5')!==record.md5)throw Error('Runtime does not match the upstream catalog hash');
    const info=await this.inspect(file);if(info.signature!=='Valid'||!/NVIDIA|Intel|Advanced Micro Devices/i.test(info.signer||''))throw Error('Runtime publisher signature could not be verified');
    const entry={...record,file,sha256:await hash(file),...info};this.cache=this.cache.filter(r=>r.id!==id).concat(entry);await saveJson(path.join(this.directory,'cache.json'),this.cache);await fs.rm(archive,{force:true});return this.snapshot();
  }
  async inspectGame(game){
    if(!game.installDir)throw Error('Choose the game installation folder first');
    const result=await scanComponents(game.installDir);
    if(/call.of.duty|\bcod\b|sp\d+-cod|valorant|fortnite|counter.strike/i.test(game.name+' '+game.installDir))result.risks.push('Known online/anti-cheat title family');
    for(const f of result.files){try{const file=await safeTarget(result.root,f.relative);Object.assign(f,await this.inspect(file),{sha256:await hash(file)});}catch(e){f.error=e.message;}}
    return result;
  }
  async transact(game,changes,label){
    const root=await gameRoot(game.installDir);
    if(/(?:^|[\\/])WindowsApps(?:[\\/]|$)/i.test(root))throw Error('Protected WindowsApps packages cannot be modified; OPlay does not change their permissions');
    if(this.journal.some(t=>t.gameId===game.id))throw Error('Restore the current component profile before applying another');
    const id=crypto.randomUUID(),backup=path.join(this.directory,'backups',id);await fs.mkdir(backup,{recursive:true});
    const transaction={id,gameId:game.id,gameName:game.name,root,label,at:new Date().toISOString(),status:'pending',changes:[]};
    for(const change of changes){
      const target=await safeTarget(root,change.relative);const exists=await fs.stat(target).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
      const original=path.join(backup,String(transaction.changes.length));if(exists)await fs.copyFile(target,original);
      transaction.changes.push({relative:change.relative,before:exists?await hash(target):null,after:await hash(change.source),backup:exists?original:null,source:change.source});
    }
    this.journal.push(transaction);await saveJson(this.file,this.journal);
    try{
      for(const c of transaction.changes){const target=await safeTarget(root,c.relative);const current=await hash(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(current!==c.before)throw Error('Game file changed after backup; refresh and retry');await replaceFile(c.source,target,c.after);if(await hash(target)!==c.after)throw Error('Component read-back failed');}
      transaction.status='installed';await saveJson(this.file,this.journal);return this.snapshot();
    }catch(error){try{await this.restore(id);}catch(recovery){error.message+='; restore pending: '+recovery.message;}throw error;}
  }
  async swap(game,relative,cacheId){
    const scan=await this.inspectGame(game);if(scan.risks.length)throw Error('Component changes are blocked for detected online/anti-cheat games');
    const found=scan.files.find(f=>f.relative===relative),entry=this.cache.find(r=>r.id===cacheId);
    if(!found||!entry||found.kind!==entry.kind)throw Error('Choose a matching installed component and downloaded version');
    if(await hash(entry.file)!==entry.sha256)throw Error('Cached component changed; download it again');
    return this.transact(game,[{relative,source:entry.file}],entry.label+' '+entry.version);
  }
  async restore(id){
    const t=this.journal.find(t=>t.id===id);if(!t)throw Error('Component backup was not found');
    const failures=[];
    for(const c of [...t.changes].reverse())try{
      const target=await safeTarget(t.root,c.relative);const current=await hash(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
      if(current===c.before)continue;if(current!==c.after)throw Error('Changed outside OPlay; original backup retained');
      if(c.backup){if(await hash(c.backup)!==c.before)throw Error('Original backup hash differs');await replaceFile(c.backup,target,c.before);}else await fs.unlink(target);
      if(await hash(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;})!==c.before)throw Error('Restore read-back failed');
    }catch(e){failures.push(c.relative+': '+e.message);}
    if(failures.length){t.status='restore pending';await saveJson(this.file,this.journal);throw Error(failures.join('; '));}
    this.journal=this.journal.filter(x=>x!==t);await saveJson(this.file,this.journal);return this.snapshot();
  }
  async installOpti(game,output,upscaler='auto'){
    if(!['auto','dlss','fsr31','xess'].includes(upscaler))throw Error('Unknown upscaler profile');
    if(!['off','fsrfg','xefg'].includes(output))throw Error('Choose a supported frame-generation profile');
    const scan=await this.inspectGame(game);if(scan.risks.length)throw Error('OptiScaler is blocked for detected online/anti-cheat games');
    if(!scan.files.some(f=>['dlss','xess','fsr_31_dx12'].includes(f.kind)))throw Error('No supported upscaler input found; OptiScaler cannot add missing engine motion vectors');
    if(!game.executable)throw Error('Choose the actual game executable before installing OptiScaler');await pe64(game.executable,true);
    const root=scan.root,dir=path.dirname(await fs.realpath(game.executable));if(dir!==root&&!under(root,dir))throw Error('Executable is outside the game folder');
    const cache=path.join(this.directory,'optiscaler',OPTI.version);await fs.mkdir(cache,{recursive:true});const archive=path.join(cache,'package.7z');
    if(await hash(archive).catch(()=>null)!==OPTI.sha256)await fs.writeFile(archive,await fetchBytes(OPTI.url,134217728,new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'])));
    if(await hash(archive)!==OPTI.sha256)throw Error('OptiScaler release checksum differs');
    const tar=path.join(process.env.SystemRoot,'System32/tar.exe'),options={windowsHide:true,timeout:60000,maxBuffer:2000000};
    const names=(await exec(tar,['-tf',archive],options)).stdout.trim().split(/\r?\n/);
    const selected=names.filter(n=>/^(OptiScaler\.dll|OptiScaler\.ini|fakenvapi\.(dll|ini)|libxe(ss|ll|ss_fg|ss_dx11)\.dll|amd_fidelityfx(_[a-z0-9]+)?\.dll|dlssg_to_fsr3_amd_is_better\.dll|Licenses\/[A-Za-z0-9_. -]+)$/.test(n));
    if(!selected.includes('OptiScaler.dll')||!selected.includes('OptiScaler.ini'))throw Error('Unknown OptiScaler package layout');
    const extracted=await fs.mkdtemp(path.join(cache,'extract-'));await exec(tar,['-xf',archive,'-C',extracted,'--',...selected],options);
    for(const name of selected)await regular(path.join(extracted,name));
    let ini=await fs.readFile(path.join(extracted,'OptiScaler.ini'),'utf8');
    const set=(section,key,value)=>{const re=new RegExp('(\\['+section+'\\][\\s\\S]*?^'+key+'=)[^\\r\\n]*','m');if(!re.test(ini))throw Error('Unknown OptiScaler profile layout: '+key);ini=ini.replace(re,'$1'+value);};
    set('Upscalers','Dx12Upscaler',upscaler);set('FrameGen','Enabled',output==='off'?'false':'true');set('FrameGen','FGInput',output==='off'?'nofg':scan.files.some(f=>f.kind==='dlss_g')?'dlssg':'upscaler');set('FrameGen','FGOutput',output==='off'?'nofg':output);
    await fs.writeFile(path.join(extracted,'OptiScaler.ini'),ini);
    const changes=[];for(const name of selected){const source=path.join(extracted,name);await regular(source);const targetName=name.startsWith('Licenses/')?'OPlay-OptiScaler-'+path.basename(name):name==='OptiScaler.dll'?'dxgi.dll':name;changes.push({relative:path.relative(root,path.join(dir,targetName)),source});}
    if(await fs.stat(path.join(dir,'dxgi.dll')).then(()=>true,()=>false))throw Error('An existing dxgi.dll proxy was found; restore or remove that mod first');
    return this.transact(game,changes,'OptiScaler '+OPTI.version+' · '+(output==='off'?'upscaling':output==='xefg'?'XeSS frame generation':'FSR frame generation'));
  }
}
module.exports={Components,TYPES,normalizeCatalog,scanComponents,safeTarget,fetchBytes,hash,pe64};
