'use strict';
// Manual 8x8 CHR tile composition. This module never infers original game sprite assemblies.
(() => {
 const $ = id => document.getElementById(id);
 const ui = Object.fromEntries(['spriteName','spriteWidth','spriteHeight','spriteFrame','spriteAdd','spriteDelete','spriteClear','spriteCanvas','spriteTile','spriteChoice','spriteStatus','spritePlay','spriteFps','spriteLoop','spriteSave','spriteLoad','spriteExport'].map(id=>[id,$(id)]));
 let width=4,height=4,frames=[Array(16).fill(null)],active=0,selectedTile=0,playing=null;
 const MAX_FRAMES=64;
 const ctx = () => window.NES_ASSET_API?.getContext() ?? null;
 const setStatus = text => {ui.spriteStatus.textContent=text};
 const validTile = (t,c) => Number.isSafeInteger(t)&&t>=0&&t<c.sourceData.length/16;
 const title = () => (ui.spriteName.value.trim().replace(/[^a-z0-9_-]+/gi,'_').slice(0,48)||'animation');
 const projectFolder = () => `nes_assets/${ctx().name.replace(/\.nes$/i,'').replace(/[^a-z0-9_-]/gi,'_').slice(0,45)}_${title()}`;
 function stop(){if(playing!==null){clearInterval(playing);playing=null}ui.spritePlay.textContent='Play'}
 function refreshFrameList(){ui.spriteFrame.replaceChildren();frames.forEach((_,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=`Frame ${i+1} / ${frames.length}`;ui.spriteFrame.append(o)});ui.spriteFrame.value=String(active)}
 function reset(reason){stop();width=Math.max(1,Math.min(16,Number(ui.spriteWidth.value)||4));height=Math.max(1,Math.min(16,Number(ui.spriteHeight.value)||4));ui.spriteWidth.value=String(width);ui.spriteHeight.value=String(height);frames=[Array(width*height).fill(null)];active=0;refreshFrameList();draw();setStatus(reason||'Select an atlas tile, then click a cell to place it.')}
 function drawFrame(context,frameIndex,dx=0,dy=0){
  const c=ctx();if(!c)return;
  for(let i=0;i<width*height;i++){
   const cell=frames[frameIndex][i];if(!cell||!validTile(cell.tile,c))continue;
   const tile=c.tileCanvas(cell.tile,cell.group);
   context.drawImage(tile,dx+(i%width)*8,dy+Math.floor(i/width)*8);
  }
 }
 function draw(){
  const c=ctx();ui.spriteExport.disabled=!c;ui.spriteSave.disabled=!c;
  const canvas=ui.spriteCanvas;canvas.width=width*8;canvas.height=height*8;
  const g=canvas.getContext('2d');g.clearRect(0,0,canvas.width,canvas.height);
  if(c)drawFrame(g,active);
  g.strokeStyle='rgba(135,170,220,0.35)';g.lineWidth=0.5;
  for(let x=1;x<width;x++){g.beginPath();g.moveTo(x*8,0);g.lineTo(x*8,canvas.height);g.stroke()}
  for(let y=1;y<height;y++){g.beginPath();g.moveTo(0,y*8);g.lineTo(canvas.width,y*8);g.stroke()}
  const mini=ui.spriteTile;mini.width=8;mini.height=8;const m=mini.getContext('2d');m.clearRect(0,0,8,8);
  if(c&&validTile(selectedTile,c))m.drawImage(c.tileCanvas(selectedTile,Number(c.paletteGroup)),0,0);
  ui.spriteChoice.textContent=c?`Selected tile #${selectedTile} · ${c.sourceKind.toUpperCase()} · palette ${c.paletteGroup}`:'Load a ROM first.';
 }
 function editCell(event,erase=false){
  const c=ctx();if(!c)return;
  const box=ui.spriteCanvas.getBoundingClientRect();if(!box.width||!box.height)return;
  const x=Math.floor((event.clientX-box.left)*width/box.width),y=Math.floor((event.clientY-box.top)*height/box.height);
  if(x<0||x>=width||y<0||y>=height)return;
  frames[active][y*width+x]=erase?null:{tile:selectedTile,group:Number(c.paletteGroup)};
  draw();setStatus(erase?`Erased cell (${x}, ${y}).`:`Placed tile #${selectedTile} at (${x}, ${y}).`);
 }
 function snapshot(){
  const c=ctx();if(!c)throw Error('Load a ROM first.');
  return {schema:'nes-asset-sprite-project-v1',game:c.name,mapper:c.mapper,sourceKind:c.sourceKind,sourceCRC32:c.crc32,
   verifiedTileSource:c.sourceKind==='chr',widthTiles:width,heightTiles:height,frames:frames.map(f=>f.map(v=>v?{...v}:null)),
   animation:{name:title(),fps:Number(ui.spriteFps.value),loop:ui.spriteLoop.checked},
   palette:{name:c.variant.name,kind:c.variant.kind,rawIndices:c.variant.data?Array.from(c.variant.data):null,
    masterRGB:c.masterColors.map(v=>[...v]),verifiedRuntime:false},
   provenance:'Manual assembly: tile placements and palette choices were selected by the user; they are not recovered ROM animation metadata.'};
 }
 function checkProject(p,c){
  if(!p||p.schema!=='nes-asset-sprite-project-v1')throw Error('Unsupported sprite project format.');
  if(p.mapper!==c.mapper||p.sourceKind!==c.sourceKind||p.sourceCRC32!==c.crc32)throw Error('This project belongs to different ROM data or graphics source.');
  if(!Number.isInteger(p.widthTiles)||!Number.isInteger(p.heightTiles)||p.widthTiles<1||p.heightTiles<1||p.widthTiles>16||p.heightTiles>16)throw Error('Invalid sprite grid.');
  if(!Array.isArray(p.frames)||p.frames.length<1||p.frames.length>MAX_FRAMES)throw Error('Invalid frame count.');
  const size=p.widthTiles*p.heightTiles;
  for(const f of p.frames){
   if(!Array.isArray(f)||f.length!==size)throw Error('Invalid frame dimensions.');
   for(const cell of f)if(cell!==null&&(!cell||!validTile(cell.tile,c)||!Number.isInteger(cell.group)||cell.group<0||cell.group>3))throw Error('Invalid tile or palette selection.');
  }
  if(!p.animation||!Number.isFinite(p.animation.fps)||p.animation.fps<1||p.animation.fps>60)throw Error('Invalid animation speed.');
  if(p.palette?.rawIndices&&(![16,32].includes(p.palette.rawIndices.length)||p.palette.rawIndices.some(n=>!Number.isInteger(n)||n<0||n>63)))throw Error('Invalid saved palette.');
 }
 function restorePalette(p){
  const saved=p.palette;if(!saved)return;
  if(saved.masterRGB?.length===64&&saved.masterRGB.every(rgb=>Array.isArray(rgb)&&rgb.length===3&&rgb.every(v=>Number.isInteger(v)&&v>=0&&v<256))){window.NES_ASSET_API.setMasterColors(saved.masterRGB)}
  if(saved.rawIndices){window.NES_ASSET_API.importPalette(saved.rawIndices,`Project: ${saved.name||'palette'}`)}
  else window.NES_ASSET_API.selectPreview();
 }
 function spriteSheet(){
  const sheet=document.createElement('canvas');sheet.width=width*8*frames.length;sheet.height=height*8;
  if(sheet.width>16384||sheet.width*sheet.height>67108864)throw Error('Animation exceeds image size limits.');
  const g=sheet.getContext('2d');for(let n=0;n<frames.length;n++)drawFrame(g,n,n*width*8,0);return sheet;
 }
 function godotResource(folder){
  const w=width*8,h=height*8,lines=[`[gd_resource type="SpriteFrames" load_steps=${frames.length+2} format=3]`,
   '',`[ext_resource type="Texture2D" path="res://${folder}/sprite_sheet.png" id="1_sheet"]`,''];
  for(let n=0;n<frames.length;n++)lines.push(`[sub_resource type="AtlasTexture" id="AtlasTexture_${n}"]`,
   'atlas = ExtResource("1_sheet")',`region = Rect2(${n*w}, 0, ${w}, ${h})`,'filter_clip = true','');
  const entries=frames.map((_,n)=>`{ "duration": 1.0, "texture": SubResource("AtlasTexture_${n}") }`);
  const anim=JSON.stringify(title());
  lines.push('[resource]','animations = [{',`"frames": [${entries.join(', ')}],`,
   `"loop": ${ui.spriteLoop.checked?'true':'false'},`,`"name": &${anim},`,`"speed": ${Number(ui.spriteFps.value).toFixed(1)}`,'}]','');
  return lines.join('\n');
 }
 function godotScene(folder){return `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="SpriteFrames" path="res://${folder}/sprite_frames.tres" id="1_frames"]\n\n[node name="AnimatedSprite2D" type="AnimatedSprite2D"]\nsprite_frames = ExtResource("1_frames")\nanimation = &${JSON.stringify(title())}\ntexture_filter = 1\n`}
 async function exportAnimation(){
  const c=ctx();if(!c)return;
  const fps=Number(ui.spriteFps.value);if(!Number.isFinite(fps)||fps<1||fps>60)return setStatus('FPS must be between 1 and 60.');
  ui.spriteExport.disabled=true;
  try{
   const folder=projectFolder(),sheet=spriteSheet(),blob=await c.pngBlob(sheet),meta=snapshot(),enc=new TextEncoder();
   const files=[{name:`${folder}/sprite_sheet.png`,data:new Uint8Array(await blob.arrayBuffer())},
    {name:`${folder}/sprite_frames.tres`,data:enc.encode(godotResource(folder))},
    {name:`${folder}/sprite_scene.tscn`,data:enc.encode(godotScene(folder))},
    {name:`${folder}/sprite_project.json`,data:enc.encode(JSON.stringify(meta,null,2))},
    {name:`${folder}/README.txt`,data:enc.encode('Extract the nes_assets folder into the ROOT of your Godot 4 project. Open sprite_scene.tscn or set AnimatedSprite2D.sprite_frames to sprite_frames.tres. Use Nearest filtering. These are manually assembled tiles; original game sprite identity, palette associations, and timing are NOT verified.\n')}];
   c.download(c.zipStore(files),`${title()}_godot4_spriteframes.zip`);
   setStatus(`Exported ${frames.length} frame(s), ${width*8}×${height*8} pixels per frame, at ${ui.spriteFps.value} FPS.`);
  }catch(e){setStatus('Export error: '+e.message)}finally{ui.spriteExport.disabled=false}
 }
 ui.spriteCanvas.addEventListener('click',e=>editCell(e));
 ui.spriteCanvas.addEventListener('contextmenu',e=>{e.preventDefault();editCell(e,true)});
 ui.spriteWidth.addEventListener('change',()=>reset('Grid changed; frames reset.'));
 ui.spriteHeight.addEventListener('change',()=>reset('Grid changed; frames reset.'));
 ui.spriteFrame.addEventListener('change',()=>{stop();active=Number(ui.spriteFrame.value);draw()});
 ui.spriteAdd.addEventListener('click',()=>{if(frames.length>=MAX_FRAMES)return setStatus('Maximum 64 frames.');stop();frames.splice(active+1,0,frames[active].map(v=>v?{...v}:null));active++;refreshFrameList();draw();setStatus('Duplicated current frame. Edit its tiles to create a new animation frame.')});
 ui.spriteDelete.addEventListener('click',()=>{stop();if(frames.length===1)frames[0]=Array(width*height).fill(null);else frames.splice(active,1);active=Math.min(active,frames.length-1);refreshFrameList();draw()});
 ui.spriteClear.addEventListener('click',()=>{frames[active]=Array(width*height).fill(null);draw()});
 ui.spritePlay.addEventListener('click',()=>{if(playing!==null)return stop();if(frames.length<2)return setStatus('Add another frame to preview animation.');const fps=Number(ui.spriteFps.value);if(!Number.isFinite(fps)||fps<1||fps>60)return setStatus('FPS must be 1–60.');
  playing=setInterval(()=>{if(active===frames.length-1&&!ui.spriteLoop.checked){stop();return}active=(active+1)%frames.length;ui.spriteFrame.value=String(active);draw()},1000/fps);ui.spritePlay.textContent='Stop'});
 ui.spriteSave.addEventListener('click',()=>{try{const c=ctx();c.download(new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'}),`${title()}_sprite_project.json`);setStatus('Saved sprite project JSON.')}catch(e){setStatus(e.message)}});
 ui.spriteLoad.addEventListener('change',async()=>{const file=ui.spriteLoad.files?.[0];ui.spriteLoad.value='';if(!file)return;try{
  if(file.size>2_000_000)throw Error('Sprite project exceeds 2 MB.');const p=JSON.parse(await file.text()),c=ctx();if(!c)throw Error('Load its ROM first.');checkProject(p,c);stop();width=p.widthTiles;height=p.heightTiles;frames=p.frames;active=0;
  ui.spriteWidth.value=String(width);ui.spriteHeight.value=String(height);ui.spriteName.value=p.animation.name||'animation';ui.spriteFps.value=String(p.animation.fps);ui.spriteLoop.checked=!!p.animation.loop;
  restorePalette(p);refreshFrameList();draw();setStatus(`Restored ${frames.length} frames from ${file.name}.`);
 }catch(e){setStatus('Import failed: '+e.message)}});
 ui.spriteExport.addEventListener('click',exportAnimation);
 window.addEventListener('nes:game',()=>reset('Game changed. Start a new sprite project or import a saved project.'));
 window.addEventListener('nes:source',()=>reset('Graphics source changed. Sprite frames cleared to avoid mismatched tile indices.'));
 window.addEventListener('nes:tile',e=>{selectedTile=e.detail.tile;draw()});
 for(const id of ['paletteVariant','paletteGroup','paletteLayer'])document.getElementById(id).addEventListener('change',draw);
 reset();
})();