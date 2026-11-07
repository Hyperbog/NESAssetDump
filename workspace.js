'use strict';
// User-editable workspaces are separate from the copyrighted ROM bytes.
(() => {
 const save=document.getElementById('workspaceSave');
 const load=document.getElementById('workspaceLoad');
 const status=document.getElementById('workspaceStatus');
 const api=()=>window.NES_ASSET_API;
 const sprites=()=>window.NES_SPRITE_API;
 const tiles=()=>window.NES_TILE_LIBRARY;
 const tell=(text)=>{status.textContent=text};
 function getWorkspace(){
  const rom=api()?.getROMIdentity();
  if(!rom)throw Error('Load the matching NES ROM before saving.');
  return {schema:'nes-asset-workspace-v1',rom,
   graphics:api().workspaceSnapshotGraphics(),sprite:sprites().snapshot(),tileLibrary:tiles().snapshot(),
   spriteSelection:{animation:Number(document.getElementById('spriteAnimation').value)||0,frame:Number(document.getElementById('spriteFrame').value)||0},
   note:'User-created tile assignments and animation frames; no original ROM data is embedded.'};
 }
 function validate(p){
  if(!p||p.schema!=='nes-asset-workspace-v1'||!p.rom||!p.graphics||!p.sprite)
   throw Error('Unsupported or incomplete workspace file.');
  const current=api()?.getROMIdentity();if(!current)throw Error('Load the matching NES ROM first.');
  if(p.rom.romCRC32!==current.romCRC32||p.rom.mapper!==current.mapper)
   throw Error('Workspace ROM identity mismatch. Load the matching .nes file.');
  // Confirm sprite payload belongs to the workspace source before any changes are made.
  if(p.sprite.sourceKind!==p.graphics.sourceKind||p.sprite.sourceCRC32!==p.graphics.sourceCRC32||p.sprite.mapper!==current.mapper)
   throw Error('Graphics and sprite source checksums do not match.');
  if(!['chr','prg'].includes(p.graphics.sourceKind))throw Error('Unsupported workspace source.');
  // Validate every animation and tile against the intended graphics source before edits.
  const target=api().getSourceValidationContext(p.graphics.sourceKind);
  if(!target||p.graphics.sourceCRC32!==target.crc32)throw Error('Workspace graphics source CRC32 mismatch.');
  sprites().validate(p.sprite,target);
  tiles().validate(p.tileLibrary??tiles().empty());
  if(p.spriteSelection){
   const x=p.spriteSelection;
   if(!Number.isInteger(x.animation)||x.animation<0||x.animation>=p.sprite.animations.length||
      !Number.isInteger(x.frame)||x.frame<0||x.frame>=p.sprite.animations[x.animation].frames.length)
    throw Error('Invalid saved sprite selection.');
  }
  return p;
 }
 async function restoreFile(file){
  if(file.size>16_000_000)throw Error('Workspace exceeds 16 MB.');
  let parsed;try{parsed=JSON.parse(await file.text())}catch{throw Error('Workspace must be valid JSON.')}
  const p=validate(parsed);
  api().restoreWorkspaceGraphics(p.graphics);
  sprites().restore(p.sprite,{restorePaletteData:false});
  tiles().restore(p.tileLibrary??tiles().empty());
  if(p.spriteSelection){
   const anim=document.getElementById('spriteAnimation');anim.value=String(p.spriteSelection.animation);anim.dispatchEvent(new Event('change'));
   const frame=document.getElementById('spriteFrame');frame.value=String(p.spriteSelection.frame);frame.dispatchEvent(new Event('change'));
  }
  tell(`Restored workspace for ${p.rom.name}: palette choices, tile assignments, labels, collections and sprite animations.`);
 }
 save.addEventListener('click',()=>{
  try{
   const p=getWorkspace();
   const clean=p.rom.name.replace(/\.nes$/i,'').replace(/[^a-z0-9._-]/gi,'_').slice(0,90);
   api().download(new Blob([JSON.stringify(p,null,2)],{type:'application/json'}),
    `${clean}_${p.rom.romCRC32.toLowerCase()}_workspace.json`);
   tell('Workspace saved. Keep this JSON with the matching NES ROM.');
  }catch(e){tell('Save failed: '+e.message)}
 });
 load.addEventListener('change',async()=>{
  const file=load.files?.[0];load.value='';if(!file)return;
  try{await restoreFile(file)}catch(e){tell('Load failed: '+e.message)}
 });
 function refresh(){save.disabled=!api()?.getROMIdentity();if(save.disabled)tell('Load an NES ROM to save a workspace.')}
 window.addEventListener('nes:game',refresh);
 window.NES_WORKSPACE_API={getWorkspace,restoreFile,validate};
 refresh();
})();