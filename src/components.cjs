const fs = require('node:fs/promises');
const {createReadStream,createWriteStream} = require('node:fs');
const {Readable,Transform} = require('node:stream');
const {pipeline} = require('node:stream/promises');
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
const UNLOCKED_API='https://api.github.com/repos/ShyVortex/dlss-unlocked/releases/latest';
const FSR_API='https://api.github.com/repos/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK/releases/latest';
const DAY=24*60*60*1000;
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
  try{await regular(file,536870912);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!under(await fs.realpath(root),path.join(await fs.realpath(path.dirname(file)),path.basename(file))))throw Error('Component path escaped its game folder');
  return file;
}
async function ensureParents(root,relative,created){
  if(typeof relative!=='string'||path.isAbsolute(relative)||relative.includes(':')||!under(root,path.resolve(root,relative)))throw Error('Invalid component path');
  let current=root;
  for(const part of path.relative(root,path.dirname(path.resolve(root,relative))).split(path.sep).filter(Boolean)){
    current=path.join(current,part);
    try{const s=await fs.lstat(current);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Linked component directories are not supported');}
    catch(e){if(e.code!=='ENOENT')throw e;await fs.mkdir(current);created.push(current);}
  }
}
function transferReporter(callback,total){
  let lastTime=0,lastBytes=-1;
  return (bytes,force=false)=>{
    if(typeof callback!=='function')return;
    const now=Date.now();
    if(!force&&now-lastTime<120&&bytes-lastBytes<1048576)return;
    lastTime=now;lastBytes=bytes;callback(bytes,total);
  };
}
async function fetchBytes(url,max,hosts,onProgress) {
  for(let redirects=0;redirects<6;redirects++){
    const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.has(u.hostname))throw Error('Download host is not trusted');
    const response=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(180000),headers:{'User-Agent':'OPlay/2.5.1'}});
    if(response.status>=300&&response.status<400){url=new URL(response.headers.get('location'),u).href;continue;}
    if(!response.ok)throw Error('Download failed: HTTP '+response.status);
    if(Number(response.headers.get('content-length'))>max)throw Error('Download exceeds size limit');
    const total=Number(response.headers.get('content-length'))||null;const report=transferReporter(onProgress,total);report(0,true);
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>max)throw Error('Download exceeds size limit');chunks.push(Buffer.from(chunk));report(size);}
    report(size,true);
    return Buffer.concat(chunks);
  }throw Error('Too many download redirects');
}
async function fetchFile(url,destination,max,hosts,onProgress){
  const partial=destination+'.partial';await fs.rm(partial,{force:true});
  try{
    for(let redirects=0;redirects<6;redirects++){
      const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.has(u.hostname))throw Error('Download host is not trusted');
      const response=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(15*60*1000),headers:{'User-Agent':'OPlay/2.5.1'}});
      if(response.status>=300&&response.status<400){url=new URL(response.headers.get('location'),u).href;continue;}
      if(!response.ok)throw Error('Download failed: HTTP '+response.status);
      if(Number(response.headers.get('content-length'))>max)throw Error('Download exceeds size limit');
      const total=Number(response.headers.get('content-length'))||null;const report=transferReporter(onProgress,total);report(0,true);
      let size=0;
      await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,encoding,callback){size+=chunk.length;report(size);callback(size>max?Error('Download exceeds size limit'):null,chunk);}}),createWriteStream(partial,{flags:'wx'}));
      report(size,true);
      await fs.rename(partial,destination);return size;
    }
    throw Error('Too many download redirects');
  }finally{await fs.rm(partial,{force:true});}
}
function normalizeUnlocked(release){
  if(!release||typeof release.tag_name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{1,59}$/.test(release.tag_name))throw Error('Unknown DLSS Unlocked release');
  const asset=release.assets?.find(a=>typeof a.name==='string'&&/^dlss-unlocked-standalone-[A-Za-z0-9._-]+\.zip$/.test(a.name));
  if(!asset||!Number.isSafeInteger(asset.size)||asset.size<1000000||asset.size>1073741824||!/^sha256:[a-f0-9]{64}$/i.test(asset.digest||''))throw Error('DLSS Unlocked release has no verified standalone package');
  const url=new URL(asset.browser_download_url);
  if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.port||!url.pathname.startsWith('/ShyVortex/dlss-unlocked/releases/download/'))throw Error('Unknown DLSS Unlocked download host');
  return {tag:release.tag_name,publishedAt:release.published_at||null,name:asset.name,size:asset.size,sha256:asset.digest.slice(7).toLowerCase(),url:url.href,releaseUrl:'https://github.com/ShyVortex/dlss-unlocked/releases/tag/'+encodeURIComponent(release.tag_name)};
}
function normalizeFsr(release){
  if(!release||!/^v\d+\.\d+\.\d+$/.test(release.tag_name||''))throw Error('Unknown FSR SDK release');
  const upscaler=(release.body||'').match(/FSR[^\r\n<]{0,40}Upscaling\s*(\d+\.\d+\.\d+)/i)?.[1]||null;
  const generation=(release.body||'').match(/FSR[^\r\n<]{0,40}Frame Generation[^\r\n<]{0,30}(\d+\.\d+\.\d+)/i)?.[1]||null;
  return {tag:release.tag_name,publishedAt:release.published_at||null,upscaler,frameGeneration:generation,url:'https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK/releases/tag/'+encodeURIComponent(release.tag_name),binaryAssets:(release.assets||[]).filter(a=>/\.dll$/i.test(a.name||'')).length};
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
  constructor(directory,inspect,onProgress=()=>{}) {this.directory=directory;this.inspect=inspect;this.onProgress=onProgress;this.catalog=[];this.cache=[];this.journal=[];this.launchTests=[];this.community=null;this.fsr=null;this.checkedAt=null;this.refreshError=null;this.file=path.join(directory,'transactions.json');}
  progress(label,phase,received=0,total=null){this.onProgress({label,phase,received,total});}
  async load(){await fs.mkdir(this.directory,{recursive:true});this.catalog=await readJson(path.join(this.directory,'catalog.json'),[]);this.cache=await readJson(path.join(this.directory,'cache.json'),[]);this.journal=await readJson(this.file,[]);this.launchTests=await readJson(path.join(this.directory,'launch-tests.json'),[]);const feed=await readJson(path.join(this.directory,'community.json'),{});this.community=feed.unlocked||null;this.fsr=feed.fsr||null;this.checkedAt=feed.checkedAt||null;await this.checkPackageCache();}
  async checkPackageCache(){this.communityCached=!!this.community&&await fs.access(path.join(this.directory,'unlocked',this.community.sha256,this.community.name)).then(()=>true,()=>false);this.optiCached=await fs.access(path.join(this.directory,'optiscaler',OPTI.version,'package.7z')).then(()=>true,()=>false);}
  snapshot(){return {catalog:this.catalog,cache:this.cache.map(({file,...record})=>record),transactions:this.journal.map(({changes,...record})=>({...record,files:changes.map(({relative})=>relative)})),launchTests:this.launchTests,optiscaler:OPTI,community:this.community,communityCached:!!this.communityCached,optiCached:!!this.optiCached,fsr:this.fsr,checkedAt:this.checkedAt,refreshError:this.refreshError};}
  async recordLaunchTest(result){this.launchTests=[result,...this.launchTests].slice(0,40);await saveJson(path.join(this.directory,'launch-tests.json'),this.launchTests);return this.snapshot();}
  async refresh(){
    const results=await Promise.allSettled([fetchBytes(CATALOG,8000000,new Set(['beeradmoore.github.io'])),fetchBytes(UNLOCKED_API,3000000,new Set(['api.github.com'])),fetchBytes(FSR_API,3000000,new Set(['api.github.com']))]);
    const errors=[];
    if(results[0].status==='fulfilled'){try{this.catalog=normalizeCatalog(JSON.parse(results[0].value.toString('utf8')));await saveJson(path.join(this.directory,'catalog.json'),this.catalog);}catch(e){errors.push('Runtime catalog: '+e.message);}}else errors.push('Runtime catalog: '+results[0].reason.message);
    if(results[1].status==='fulfilled'){try{this.community=normalizeUnlocked(JSON.parse(results[1].value.toString('utf8')));}catch(e){errors.push('Community release: '+e.message);}}else errors.push('Community release: '+results[1].reason.message);
    if(results[2].status==='fulfilled'){try{this.fsr=normalizeFsr(JSON.parse(results[2].value.toString('utf8')));}catch(e){errors.push('FSR SDK: '+e.message);}}else errors.push('FSR SDK: '+results[2].reason.message);
    if(errors.length===3)throw Error(errors.join('; '));
    this.checkedAt=new Date().toISOString();this.refreshError=errors.join('; ')||null;await saveJson(path.join(this.directory,'community.json'),{unlocked:this.community,fsr:this.fsr,checkedAt:this.checkedAt});await this.checkPackageCache();return this.snapshot();
  }
  async refreshIfDue(){if(!this.checkedAt||!Number.isFinite(Date.parse(this.checkedAt))||Date.now()-Date.parse(this.checkedAt)>=DAY)return this.refresh();return this.snapshot();}
  async download(id){
    const record=this.catalog.find(r=>r.id===id);if(!record)throw Error('Refresh the catalog and choose a listed component');
    const cached=this.cache.find(r=>r.id===id);if(cached&&await hash(cached.file).catch(()=>null)===cached.sha256)return this.snapshot();
    const label=record.label+' '+record.version;this.progress(label,'connecting');
    const dir=path.join(this.directory,'downloads',crypto.createHash('sha256').update(id).digest('hex'));await fs.mkdir(dir,{recursive:true});
    const archive=path.join(dir,'package.zip'),file=path.join(dir,record.name);await fs.rm(file,{force:true});
    await fs.writeFile(archive,await fetchBytes(record.url,134217728,new Set(['dlss-swapper-downloads.beeradmoore.com']),(received,total)=>this.progress(label,'downloading',received,total)));
    this.progress(label,'verifying');
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
  async statusGame(game){
    const installations=[];
    for(const transaction of this.journal.filter(t=>t.gameId===game.id)){
      let state=transaction.status==='installed'?'installed':'restore pending',checked=0;
      if(state==='installed')for(const change of transaction.changes){
        try{const target=await safeTarget(transaction.root,change.relative);const actual=await hash(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(actual!==change.after){state=actual===null?'missing':'modified';break;}checked++;}
        catch(error){state=error.code==='ENOENT'?'missing':'modified';break;}
      }
      installations.push({id:transaction.id,label:transaction.label,state,files:transaction.changes.length,checked,at:transaction.at});
    }
    return {gameId:game.id,installations};
  }
  async transact(game,changes,label){
    const root=await gameRoot(game.installDir);
    if(/(?:^|[\\/])WindowsApps(?:[\\/]|$)/i.test(root))throw Error('Protected WindowsApps packages cannot be modified; OPlay does not change their permissions');
    if(this.journal.some(t=>t.gameId===game.id))throw Error('Restore the current component profile before applying another');
    const id=crypto.randomUUID(),backup=path.join(this.directory,'backups',id);await fs.mkdir(backup,{recursive:true});
    const madeDirs=[];
    try{for(const change of changes)await ensureParents(root,change.relative,madeDirs);}catch(e){for(const dir of madeDirs.reverse())await fs.rmdir(dir).catch(()=>{});throw e;}
    const transaction={id,gameId:game.id,gameName:game.name,root,label,at:new Date().toISOString(),status:'pending',changes:[],madeDirs};
    try{for(const change of changes){
      const target=await safeTarget(root,change.relative);const exists=await fs.stat(target).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
      if(change.source===null&&!exists)continue;
      const original=path.join(backup,String(transaction.changes.length));if(exists)await fs.copyFile(target,original);
      transaction.changes.push({relative:change.relative,before:exists?await hash(target):null,after:change.source===null?null:await hash(change.source),backup:exists?original:null,source:change.source});
    }}catch(e){for(const dir of madeDirs.reverse())await fs.rmdir(dir).catch(()=>{});await fs.rm(backup,{recursive:true,force:true});throw e;}
    this.journal.push(transaction);await saveJson(this.file,this.journal);
    try{
      for(const c of transaction.changes){const target=await safeTarget(root,c.relative);const current=await hash(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(current!==c.before)throw Error('Game file changed after backup; refresh and retry');if(c.source===null)await fs.unlink(target);else await replaceFile(c.source,target,c.after);if(await hash(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;})!==c.after)throw Error('Component read-back failed');}
      transaction.status='installed';await saveJson(this.file,this.journal);return this.snapshot();
    }catch(error){try{await this.restore(id);}catch(recovery){error.message+='; restore pending: '+recovery.message;}throw error;}
  }
  async swap(game,relative,cacheId){
    const scan=await this.inspectGame(game);
    const found=scan.files.find(f=>f.relative===relative),entry=this.cache.find(r=>r.id===cacheId);
    if(!found||!entry||found.kind!==entry.kind)throw Error('Choose a matching installed component and downloaded version');
    if(await hash(entry.file)!==entry.sha256)throw Error('Cached component changed; download it again');
    return this.transact(game,[{relative,source:entry.file}],entry.label+' '+entry.version);
  }
  async installRuntime(game,cacheId){
    const entry=this.cache.find(r=>r.id===cacheId);
    if(!entry||TYPES[entry.kind]?.[1]!==entry.name)throw Error('Choose a downloaded runtime file');
    if(await hash(entry.file)!==entry.sha256)throw Error('Cached runtime changed; download it again');
    if(!game.executable)throw Error('Choose the actual game executable first');await pe64(game.executable,true);
    const root=await gameRoot(game.installDir),dir=path.dirname(await fs.realpath(game.executable));
    if(dir!==root&&!under(root,dir))throw Error('Executable is outside the game folder');
    return this.transact(game,[{relative:path.relative(root,path.join(dir,entry.name)),source:entry.file}],entry.label+' '+entry.version+' · direct file install');
  }
  async restore(id){
    const t=this.journal.find(t=>t.id===id);if(!t)throw Error('Component backup was not found');
    // Check the entire transaction before touching any file. A later game update
    // or another mod must not leave a half-restored profile.
    const conflicts=[];
    for(const c of t.changes){
      try{const target=await safeTarget(t.root,c.relative);const current=await hash(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
        if(current!==c.before&&current!==c.after)conflicts.push(c.relative+': Changed outside OPlay');
        else if(current===c.after&&c.backup&&await hash(c.backup)!==c.before)conflicts.push(c.relative+': original backup hash differs');
      }catch(e){conflicts.push(c.relative+': '+e.message);}
    }
    if(conflicts.length)throw Error('Restore stopped before changing game files: '+conflicts.join('; '));
    const failures=[];
    for(const c of [...t.changes].reverse())try{
      const target=await safeTarget(t.root,c.relative);const current=await hash(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
      if(current===c.before)continue;if(current!==c.after)throw Error('Changed outside OPlay; original backup retained');
      if(c.backup){if(await hash(c.backup)!==c.before)throw Error('Original backup hash differs');await replaceFile(c.backup,target,c.before);}else await fs.unlink(target);
      if(await hash(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;})!==c.before)throw Error('Restore read-back failed');
    }catch(e){failures.push(c.relative+': '+e.message);}
    if(failures.length){t.status='restore pending';await saveJson(this.file,this.journal);throw Error(failures.join('; '));}
    this.journal=this.journal.filter(x=>x!==t);await saveJson(this.file,this.journal);
    for(const dir of [...(t.madeDirs||[])].reverse())if(under(t.root,dir))await fs.rmdir(dir).catch(()=>{});
    return this.snapshot();
  }
  async installOpti(game,output,upscaler='auto'){
    if(!['auto','dlss','fsr31','xess'].includes(upscaler))throw Error('Unknown upscaler profile');
    if(!['off','fsrfg','xefg'].includes(output))throw Error('Choose a supported frame-generation profile');
    const scan=await this.inspectGame(game);
    if(!game.executable)throw Error('Choose the actual game executable before installing OptiScaler');await pe64(game.executable,true);
    const root=scan.root,dir=path.dirname(await fs.realpath(game.executable));if(dir!==root&&!under(root,dir))throw Error('Executable is outside the game folder');
    const archive=await this.downloadOpti();const cache=path.dirname(archive);
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
    for(const name of ['dinput8.dll','version.dll','winmm.dll'])if(!changes.some(change=>path.resolve(root,change.relative).toLowerCase()===path.join(dir,name).toLowerCase()))changes.push({relative:path.relative(root,path.join(dir,name)),source:null});
    return this.transact(game,changes,'OptiScaler '+OPTI.version+' · '+(output==='off'?'upscaling':output==='xefg'?'XeSS frame generation':'FSR frame generation'));
  }
  async downloadOpti(){
    const cache=path.join(this.directory,'optiscaler',OPTI.version);await fs.mkdir(cache,{recursive:true});const archive=path.join(cache,'package.7z');
    const label='OptiScaler '+OPTI.version;
    if(await hash(archive).catch(()=>null)!==OPTI.sha256){this.progress(label,'connecting');await fs.rm(archive,{force:true});await fetchFile(OPTI.url,archive,134217728,new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']),(received,total)=>this.progress(label,'downloading',received,total));}
    this.progress(label,'verifying');
    if(await hash(archive)!==OPTI.sha256)throw Error('OptiScaler release checksum differs');this.optiCached=true;return archive;
  }
  async downloadUnlocked(){
    const release=this.community;if(!release)throw Error('Refresh the community release feed first');
    const cache=path.join(this.directory,'unlocked',release.sha256);await fs.mkdir(cache,{recursive:true});const archive=path.join(cache,release.name);
    const label='DLSS Unlocked '+release.tag;
    if(await hash(archive).catch(()=>null)!==release.sha256){this.progress(label,'connecting',0,release.size);await fs.rm(archive,{force:true});await fetchFile(release.url,archive,1073741824,new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']),(received,total)=>this.progress(label,'downloading',received,total||release.size));}
    this.progress(label,'verifying');
    if(await hash(archive)!==release.sha256)throw Error('Community release checksum differs');this.communityCached=true;return archive;
  }
  async installUnlocked(game){
    const release=this.community;if(!release)throw Error('Refresh the community release feed first');
    if(!game.executable)throw Error('Choose the actual game executable first');await pe64(game.executable,true);
    const root=await gameRoot(game.installDir),dir=path.dirname(await fs.realpath(game.executable));
    if(dir!==root&&!under(root,dir))throw Error('Executable is outside the game folder');
    const archive=await this.downloadUnlocked();const cache=path.dirname(archive);
    const extracted=await fs.mkdtemp(path.join(cache,'extract-'));
    try{
      const script=path.join(__dirname,'component-tools.ps1').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
      const result=await exec(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-File',script,'-Action','ExtractBundle','-File',archive,'-Destination',extracted],{windowsHide:true,timeout:240000,maxBuffer:200000});
      const names=JSON.parse(result.stdout);
      if(!Array.isArray(names)||!names.length)throw Error('Community archive contains no installable files');
      const changes=[];
      for(const name of names){const source=path.join(extracted,...name.split('/'));await regular(source,536870912);if(name.toLowerCase().endsWith('.dll'))await pe64(source,true);changes.push({relative:path.relative(root,path.join(dir,...name.split('/'))),source});}
      for(const name of ['dinput8.dll','version.dll','winmm.dll'])if(!changes.some(change=>path.resolve(root,change.relative).toLowerCase()===path.join(dir,name).toLowerCase()))changes.push({relative:path.relative(root,path.join(dir,name)),source:null});
      return await this.transact(game,changes,'DLSS Unlocked '+release.tag+' · experimental MFG / neural route');
    }finally{await fs.rm(extracted,{recursive:true,force:true});}
  }
}
module.exports={Components,TYPES,normalizeCatalog,normalizeUnlocked,normalizeFsr,scanComponents,safeTarget,fetchBytes,fetchFile,hash,pe64};
