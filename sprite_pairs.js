'use strict';
// Static candidate pairs from contiguous 8 KiB CHR-ROM. No mapper state inferred.
(() => {
 const $=id=>document.getElementById(id);
 const ui={bank:$('pairBank'),group:$('pairGroup'),preview:$('pairPreview'),info:$('pairInfo'),status:$('pairStatus'),export:$('pairExport')};
 const encoder=new TextEncoder(),cols=16,bankBytes=8192;
 const context=()=>window.NES_ASSET_API?.getContext()||null;
 const active=c=>c?.sourceKind==='chr'&&c.sourceData.length>=bankBytes;
 const safe=s=>(s||'game').replace(/\.nes$/i,'').replace(/[^a-z0-9_-]+/gi,'_').slice(0,64)||'game';
 function pair(oam,bank){
  const first=bank*512+(oam&254)+((oam&1)?256:0);
  return {top:first,bottom:first+1,ppuTable:(oam&1)?4096:0};
 }
 function colors(c){
  if(!c.variant.data)return [[0,0,0],[85,85,85],[170,170,170],[255,255,255]];
  const data=c.variant.data,shift=data.length===32?16:0,group=Number(ui.group.value);
  return Array.from({length:4},(_,v)=>c.masterColors[data[shift+group*4+v]&63]);
 }
 function draw(c,bank,flipH=false,flipV=false){
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=256;
  const ctx=canvas.getContext('2d'),img=ctx.createImageData(128,256);
  const pal=colors(c),bytes=c.sourceData;
  for(let oam=0;oam<256;oam++){
   const p=pair(oam,bank),x0=oam%16*8,y0=Math.floor(oam/16)*16;
   for(let y=0;y<16;y++)for(let x=0;x<8;x++){
    const sx=flipH?7-x:x,sy=flipV?15-y:y,top=sy<8;
    const off=(top?p.top:p.bottom)*16+(sy&7);
    const v=((bytes[off]>>(7-sx))&1)|(((bytes[off+8]>>(7-sx))&1)<<1);
    const index=((y0+y)*128+x0+x)*4;
    img.data[index]=pal[v][0];img.data[index+1]=pal[v][1];
    img.data[index+2]=pal[v][2];img.data[index+3]=v===0?0:255;
   }
  }
  ctx.putImageData(img,0,0);return canvas;
 }
 function reset(){
  const c=context(),ok=active(c),previous=ui.bank.value;
  ui.bank.replaceChildren();
  if(ok){
   for(let b=0;b<Math.floor(c.sourceData.length/bankBytes);b++){
    const opt=document.createElement('option');opt.value=String(b);
    opt.textContent='8 KiB bank '+b+' — CHR offset 0x'+(b*bankBytes).toString(16).toUpperCase();
    ui.bank.append(opt);
   }
   if([...ui.bank.options].some(o=>o.value===previous))ui.bank.value=previous;
  }
  ui.bank.disabled=ui.export.disabled=!ok;
  if(ok){render();return}
  ui.preview.width=128;ui.preview.height=16;ui.preview.getContext('2d').clearRect(0,0,128,16);
  ui.info.textContent='No sprite candidate selected.';
  ui.status.textContent=c?.sourceKind==='prg'?
   'Select CHR-ROM to view 8×16 hardware pair candidates. This does not decode CHR-RAM graphics.':
   'Load a ROM containing at least 8 KiB CHR-ROM.';
 }
 function render(){
  const c=context();if(!active(c)){reset();return}
  const bank=Number(ui.bank.value)||0,image=draw(c,bank);
  ui.preview.width=image.width;ui.preview.height=image.height;
  ui.preview.getContext('2d').drawImage(image,0,0);
  ui.status.textContent='256 8×16 candidate sprites from bank '+bank+
   '. OAM tile-byte bit 0 chooses the pattern table; bits 1–7 choose the even/odd pair. Original gameplay usage is unknown.';
 }
 function metadata(c,bank){
  return {
   schema:'nes-asset-sprite-pairs-v1',game:c.name,mapper:c.mapper,sourceKind:'chr',
   sourceCRC32:c.crc32,bank8KiB:bank,bankByteOffset:bank*bankBytes,
   romBankFileOffset:c.sourceBase+bank*bankBytes,imageSize:[128,256],
   spriteSize:[8,16],columns:cols,pairCount:256,verifiedCHRBytes:true,
   verifiedRuntimeBankMapping:false,hardwareMode:'NES PPUCTRL sprite size 8x16',
   pairingAssumption:'One contiguous 8 KiB ROM bank mapped to PPU $0000-$1FFF (not verified).',
   palette:{variant:c.variant.name,origin:c.variant.kind,
    rawIndices:c.variant.data?Array.from(c.variant.data):null,
    spriteGroup:Number(ui.group.value),verifiedRuntime:false,transparentPixel0:true,
    warning:'A single sprite sub-palette applies to both halves; colors are previews, not verified game colors.'},
   spriteCandidates:Array.from({length:256},(_,oam)=>{
    const p=pair(oam,bank);
    return {oamTileByte:oam,patternTablePPUAddress:p.ppuTable,
     topTileIndex:p.top,bottomTileIndex:p.bottom,
     romTopFileOffset:c.sourceBase+p.top*16,
     romBottomFileOffset:c.sourceBase+p.bottom*16,
     atlasCoords:[oam%cols,Math.floor(oam/cols)],
     defaultOAMAttributes:0,horizontalFlipOAMBit:64,verticalFlipOAMBit:128};
   }),
   warning:'Candidate pairings only. Runtime sprite size and mapper-dependent CHR bank mapping are not known.'
  };
 }
 function godotResource(prefix){
  const lines=['[gd_resource type="TileSet" load_steps=3 format=3]','',
   '[ext_resource type="Texture2D" path="res://'+prefix+'sprite_pairs.png" id="1_atlas"]','',
   '[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]',
   'texture = ExtResource("1_atlas")','texture_region_size = Vector2i(8, 16)',
   'margins = Vector2i(0, 0)','separation = Vector2i(0, 0)'];
  for(let n=0;n<256;n++)lines.push((n%16)+':'+Math.floor(n/16)+'/0 = 0');
  lines.push('','[resource]','tile_size = Vector2i(8, 16)',
   'sources/0 = SubResource("TileSetAtlasSource_1")','');
  return lines.join('\n');
 }
 async function exportPack(){
  const c=context();if(!active(c)){reset();return}
  const bank=Number(ui.bank.value)||0;ui.export.disabled=true;
  ui.status.textContent='Encoding 8×16 candidate sprite atlas...';
  try{
   const prefix='nes_assets/'+safe(c.name)+'_'+c.crc32.toLowerCase()+
    '/sprites_8x16/bank_'+String(bank).padStart(3,'0')+'/';
   const png=async(h,v)=>new Uint8Array(await (await c.pngBlob(draw(c,bank,h,v))).arrayBuffer());
   const files=[
    {name:prefix+'sprite_pairs.png',data:await png(false,false)},
    {name:prefix+'flip_horizontal.png',data:await png(true,false)},
    {name:prefix+'flip_vertical.png',data:await png(false,true)},
    {name:prefix+'flip_both.png',data:await png(true,true)},
    {name:prefix+'original_8kb_chr.chr',data:c.sourceData.slice(bank*bankBytes,(bank+1)*bankBytes)},
    {name:prefix+'sprite_pairs.json',data:encoder.encode(JSON.stringify(metadata(c,bank),null,2))},
    {name:prefix+'sprite_pairs.tres',data:encoder.encode(godotResource(prefix))},
    {name:prefix+'README.txt',data:encoder.encode(
     '8x16 NES hardware candidate sprite pairs, not identified in-game characters.\n'+
     'A contiguous 8 KiB CHR-ROM bank is assumed to be mapped into both PPU pattern tables.\n'+
     'OAM tile bytes 0-255 index the 16-column atlas from left to right.\n'+
     'Index 0 is transparent; one sprite palette applies to both halves.\n'+
     'Extract the nes_assets/ folder into the Godot project root.\n')}
   ];
   c.download(c.zipStore(files),safe(c.name)+'_'+c.crc32.toLowerCase()+'_8x16_bank'+bank+'.zip');
   ui.status.textContent='Exported 256 candidate 8×16 pairs, four flip atlases, raw CHR and Godot TileSet for bank '+bank+'.';
  }catch(error){ui.status.textContent='Export failed: '+error.message}
  finally{ui.export.disabled=false}
 }
 ui.preview.addEventListener('click',event=>{
  const c=context();if(!active(c))return;
  const box=ui.preview.getBoundingClientRect();if(!box.width||!box.height)return;
  const x=Math.floor((event.clientX-box.left)*ui.preview.width/box.width/8);
  const y=Math.floor((event.clientY-box.top)*ui.preview.height/box.height/16);
  if(x<0||x>=16||y<0||y>=16)return;
  const oam=y*16+x,p=pair(oam,Number(ui.bank.value)||0);
  ui.info.textContent='OAM tile byte 0x'+oam.toString(16).toUpperCase().padStart(2,'0')+
   ' | PPU table $'+p.ppuTable.toString(16).padStart(4,'0')+
   ' | ROM tiles '+p.top+' + '+p.bottom+
   ' | offsets 0x'+(c.sourceBase+p.top*16).toString(16).toUpperCase()+
   ', 0x'+(c.sourceBase+p.bottom*16).toString(16).toUpperCase();
 });
 ui.bank.addEventListener('change',()=>{ui.info.textContent='Click a sprite candidate to inspect tile offsets.';render()});
 ui.group.addEventListener('change',render);
 ui.export.addEventListener('click',exportPack);
 window.addEventListener('nes:game',reset);
 window.addEventListener('nes:workspace',reset);
 for(const id of ['source','paletteVariant','paletteGroup','paletteLayer']){
  $(id)?.addEventListener('change',()=>{if(id==='source')reset();else if(active(context()))render()});
 }
 reset();
})();