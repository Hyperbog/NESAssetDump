'use strict';
(() => {
 const $ = id => document.getElementById(id);
 const ids = ['tileSearch','tileFilter','tileFind','tilePrev','tileNext','tilePage','tileCatalog','tileCatalogStatus','tileSetExport'];
 const ui = Object.fromEntries(ids.map(id => [id,$(id)]));
 if (Object.values(ui).some(v=>!v)) return;
 const encode=new TextEncoder(), pageSize=128, columns=16;
 let catalog=null,matched=[],pageIndex=0;
 const context=()=>window.NES_ASSET_API?.getContext()||null;
 const current=c=>catalog&&c&&catalog.source===c.sourceData&&catalog.kind===c.sourceKind;
 const safe=s=>s.replace(/\.nes$/i,'').replace(/[^a-z0-9_-]+/gi,'_').slice(0,64)||'game';
 const hex=(n,size=2)=>n.toString(16).toUpperCase().padStart(size,'0');
 function reset(){
  catalog=null;matched=[];pageIndex=0;ui.tileSetExport.disabled=true;
  ui.tileCatalog.width=128;ui.tileCatalog.height=8;
  ui.tileCatalog.getContext('2d').clearRect(0,0,128,8);
  ui.tileCatalogStatus.textContent=context()?'Select Search to index all tiles in the loaded source.':'Load an NES ROM to browse its tiles.';
  ui.tilePage.textContent='';ui.tilePrev.disabled=ui.tileNext.disabled=true;
 }
 function index(c){
  const tiles=Math.floor(c.sourceData.length/16),counts=new Map(),first=new Map(),keys=new Array(tiles),blank=new Uint8Array(tiles);
  for(let i=0;i<tiles;i++){
   const off=i*16,key=String.fromCharCode(...c.sourceData.subarray(off,off+16));keys[i]=key;
   counts.set(key,(counts.get(key)||0)+1);
   if(!first.has(key))first.set(key,i);
   let zero=true;for(let j=0;j<16;j++)if(c.sourceData[off+j]!==0){zero=false;break}
   blank[i]=zero?1:0;
  }
  return {source:c.sourceData,kind:c.sourceKind,tiles,counts,first,keys,blank};
 }
 function select(c){
  if(!current(c))catalog=index(c);
  const q=ui.tileSearch.value.trim(),mode=ui.tileFilter.value;
  let single=null,prefix=null;
  if(q){
   if(/^0x[0-9a-f]+$/i.test(q))single=parseInt(q.slice(2),16);
   else if(/^\d+$/.test(q))single=Number(q);
   else if(/^hex:\s*(?:[0-9a-f]{2}\s*)+$/i.test(q)){
    prefix=q.slice(4).replace(/\s/g,'').toUpperCase();
    if(prefix.length>32)throw Error('A tile has only 16 source bytes; hex prefix must be 16 bytes or fewer.');
   }else throw Error('Search by decimal tile index, 0xHEX index, or hex:AA BB byte prefix.');
  }
  matched=[];
  for(let i=0;i<catalog.tiles;i++){
   if(single!==null&&i!==single)continue;
   const key=catalog.keys[i];
   if(mode==='unique'&&catalog.first.get(key)!==i)continue;
   if(mode==='duplicate'&&catalog.counts.get(key)<2)continue;
   if(mode==='blank'&&!catalog.blank[i])continue;
   if(mode==='nonblank'&&catalog.blank[i])continue;
   if(prefix!==null){
    let ok=true;for(let j=0;j<prefix.length/2;j++)if(hex(c.sourceData[i*16+j])!==prefix.slice(j*2,j*2+2)){ok=false;break}
    if(!ok)continue;
   }
   matched.push(i);
  }
  pageIndex=0;render(c);ui.tileSetExport.disabled=!matched.length;
 }
 function colors(c){
  if(!c.variant.data)return [[0,0,0],[85,85,85],[170,170,170],[255,255,255]];
  const shift=c.variant.data.length===32&&c.paletteLayer==='sprite'?16:0;
  return Array.from({length:4},(_,v)=>{
   const pos=c.paletteLayer==='background'&&v===0?0:shift+4*c.paletteGroup+v;
   return c.masterColors[(c.variant.data[pos]??0)&63];
  });
 }
 function draw(c,indices){
  const width=columns*8,height=Math.max(1,Math.ceil(indices.length/columns))*8;
  if(height>16384||width*height>67108864)throw Error('Atlas exceeds canvas limits. Narrow the tile filter.');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas rendering unavailable.');
  const image=ctx.createImageData(width,height),palette=colors(c);
  indices.forEach((tile,n)=>{
   const off=tile*16,dx=n%columns*8,dy=Math.floor(n/columns)*8;
   for(let y=0;y<8;y++){
    const lo=c.sourceData[off+y],hi=c.sourceData[off+8+y];
    for(let x=0;x<8;x++){
     const v=((lo>>(7-x))&1)|(((hi>>(7-x))&1)<<1),p=((dy+y)*width+dx+x)*4;
     image.data[p]=palette[v][0];image.data[p+1]=palette[v][1];image.data[p+2]=palette[v][2];
     image.data[p+3]=c.transparent&&v===0?0:255;
    }
   }
  });
  ctx.putImageData(image,0,0);return canvas;
 }
 function render(c){
  const pages=Math.max(1,Math.ceil(matched.length/pageSize));
  pageIndex=Math.min(Math.max(0,pageIndex),pages-1);
  const visible=matched.slice(pageIndex*pageSize,(pageIndex+1)*pageSize);
  const image=draw(c,visible);
  ui.tileCatalog.width=image.width;ui.tileCatalog.height=image.height;
  ui.tileCatalog.getContext('2d').drawImage(image,0,0);
  ui.tilePage.textContent=`Page ${pageIndex+1} / ${pages}`;
  ui.tilePrev.disabled=pageIndex===0;ui.tileNext.disabled=pageIndex>=pages-1;
  ui.tileCatalogStatus.textContent=`${matched.length.toLocaleString()} matching tiles out of ${catalog.tiles.toLocaleString()} (${catalog.counts.size.toLocaleString()} distinct patterns). Showing ${visible.length} on this page. ${c.sourceKind==='chr'?'Exact CHR-ROM bytes':'EXPERIMENTAL PRG-ROM scan; blocks may not be graphics'}. Click a tile to inspect it in the original atlas.`;
 }
 function metadata(c,indices){
  return {
   schema:'nes-asset-godot-tileset-v1',game:c.name,mapper:c.mapper,sourceKind:c.sourceKind,
   verifiedTileSource:c.sourceKind==='chr',sourceCRC32:c.crc32,tileSize:[8,8],columns,atlasSourceId:0,
   palette:{name:c.variant.name,origin:c.variant.kind,group:c.paletteGroup,layer:c.paletteLayer,verifiedRuntime:false,transparentIndex0:c.transparent,
    warning:'One display palette is used for the entire atlas. Manual palette assignments are not painted into the PNG.'},
   tiles:indices.map((tile,n)=>({tileIndex:tile,bank8KiB:Math.floor(tile/512),
    romFileOffset:c.sourceBase===null?null:c.sourceBase+tile*16,byteOffset:tile*16,
    atlasCoords:[n%columns,Math.floor(n/columns)],atlasSourceId:0,alternativeId:0,
    occurrencesInSource:catalog.counts.get(catalog.keys[tile]),
    manuallyAssignedGroup:c.assignments.get(`${c.sourceKind}:${tile}`)??null})),
   warning:c.sourceKind==='chr'?'Raw CHR tiles do not identify original sprites/backgrounds or their palettes.':
    'PRG scan is not a verified graphics decoder; results may contain non-graphics data.'
  };
 }
 function tileset(indices,prefix){
  const lines=['[gd_resource type="TileSet" load_steps=3 format=3]','',
   `[ext_resource type="Texture2D" path="res://${prefix}tileset_atlas.png" id="1_atlas"]`,'',
   '[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]',
   'texture = ExtResource("1_atlas")','texture_region_size = Vector2i(8, 8)',
   'margins = Vector2i(0, 0)','separation = Vector2i(0, 0)'];
  for(let n=0;n<indices.length;n++)lines.push(`${n%columns}:${Math.floor(n/columns)}/0 = 0`);
  lines.push('','[resource]','tile_size = Vector2i(8, 8)','sources/0 = SubResource("TileSetAtlasSource_1")','');
  return lines.join('\n');
 }
 async function exportZip(){
  const c=context();if(!current(c)||!matched.length){reset();return}
  ui.tileSetExport.disabled=true;
  try{
   const prefix=`nes_assets/${safe(c.name)}_${c.crc32.toLowerCase()}/tile_catalog/`;
   const canvas=draw(c,matched),png=new Uint8Array(await (await c.pngBlob(canvas)).arrayBuffer());
   const files=[
    {name:prefix+'tileset_atlas.png',data:png},
    {name:prefix+'tileset.tres',data:encode.encode(tileset(matched,prefix))},
    {name:prefix+'tileset_metadata.json',data:encode.encode(JSON.stringify(metadata(c,matched),null,2))},
    {name:prefix+'README.txt',data:encode.encode('Extract the nes_assets/ directory into the Godot project root.\n'+
     `Load res://${prefix}tileset.tres in TileMapLayer.tile_set.\n`+
     'TileSet source ID = 0. Atlas coordinates are listed in tileset_metadata.json.\n'+
     '8x8 grid; zero margins/separation; use nearest texture filtering.\n'+
     'Palette colors are previews, not verified game associations.\n')}
   ];
   c.download(c.zipStore(files),`${safe(c.name)}_${c.crc32.toLowerCase()}_${c.sourceKind}_godot_tileset.zip`);
   ui.tileCatalogStatus.textContent=`Exported ${matched.length.toLocaleString()} tiles to Godot TileSet atlas and JSON lookup.`;
  }catch(e){ui.tileCatalogStatus.textContent='TileSet export failed: '+e.message}
  finally{ui.tileSetExport.disabled=false}
 }
 ui.tileFind.addEventListener('click',()=>{try{const c=context();if(!c)return reset();select(c)}catch(e){ui.tileCatalogStatus.textContent=e.message;ui.tileSetExport.disabled=true}});
 ui.tileSearch.addEventListener('keydown',e=>{if(e.key==='Enter')ui.tileFind.click()});
 ui.tileFilter.addEventListener('change',()=>ui.tileFind.click());
 ui.tilePrev.addEventListener('click',()=>{if(pageIndex>0){pageIndex--;render(context())}});
 ui.tileNext.addEventListener('click',()=>{if((pageIndex+1)*pageSize<matched.length){pageIndex++;render(context())}});
 ui.tileCatalog.addEventListener('click',e=>{
  const c=context();if(!current(c))return;
  const box=ui.tileCatalog.getBoundingClientRect();if(!box.width||!box.height)return;
  const x=Math.floor((e.clientX-box.left)*ui.tileCatalog.width/box.width/8);
  const y=Math.floor((e.clientY-box.top)*ui.tileCatalog.height/box.height/8);
  const tile=matched[pageIndex*pageSize+y*columns+x];
  if(tile!==undefined&&x>=0&&x<columns)window.NES_ASSET_API.inspectTile(tile);
 });
 ui.tileSetExport.addEventListener('click',exportZip);
 for(const event of ['nes:game','nes:source'])window.addEventListener(event,reset);
 for(const id of ['paletteVariant','paletteLayer','paletteGroup','transparent'])$(id).addEventListener('change',()=>{
  const c=context();if(current(c))try{render(c)}catch(e){ui.tileCatalogStatus.textContent=e.message}
 });
 reset();
})();
