'use strict';
// Searchable ROM-offset catalog and native Godot TileSet exporter.
(() => {
 const $ = id => document.getElementById(id);
 const ui = Object.fromEntries(['tileSearch','tileFilter','tileFind','tilePrev','tileNext',
  'tilePage','tileCatalog','tileCatalogStatus','tileSetExport','tilePaletteMode'].map(id=>[id,$(id)]));
 if (Object.values(ui).some(v=>!v)) return;
 const encode = new TextEncoder();
 const pageSize = 128, columns = 16;
 let catalog = null, matched = [], pageIndex = 0;
 const context = () => window.NES_ASSET_API?.getContext() || null;
 const sourceIsCurrent = c => catalog && c && catalog.source === c.sourceData && catalog.kind === c.sourceKind;
 const safeName = s => s.replace(/\.nes$/i,'').replace(/[^a-z0-9_-]+/gi,'_').slice(0,64) || 'game';
 const hex = (n,size=2) => n.toString(16).toUpperCase().padStart(size,'0');
 const byteKey = (bytes,off) => String.fromCharCode(...bytes.subarray(off,off+16));
 const isBlank = (bytes,off) => {
  for (let j=0;j<16;j++) if(bytes[off+j]!==0)return false;
  return true;
 };
 function reset() {
  catalog=null; matched=[]; pageIndex=0; ui.tileSetExport.disabled=true;
  ui.tileCatalog.width=128;ui.tileCatalog.height=8;
  ui.tileCatalog.getContext('2d').clearRect(0,0,128,8);
  ui.tileCatalogStatus.textContent=context()?'Select Search to index all tiles in the loaded source.':'Load an NES ROM to browse its tiles.';
  ui.tilePage.textContent='';ui.tilePrev.disabled=ui.tileNext.disabled=true;
 }
 function indexSource(c) {
  const tiles = Math.floor(c.sourceData.length / 16), counts = new Map(), first = new Map();
  const keys = new Array(tiles), blank = new Uint8Array(tiles);
  for(let i=0;i<tiles;i++){
   const key=byteKey(c.sourceData,i*16);keys[i]=key;
   counts.set(key,(counts.get(key)||0)+1);
   if(!first.has(key))first.set(key,i);
   blank[i]=isBlank(c.sourceData,i*16)?1:0;
  }
  return {source:c.sourceData,kind:c.sourceKind,tiles,keys,counts,first,blank};
 }
 function filterTiles(c) {
  if(!sourceIsCurrent(c))catalog=indexSource(c);
  const query=ui.tileSearch.value.trim(), mode=ui.tileFilter.value;
  let single=null, prefix=null, librarySearch=null;
  if(query){
   if(/^0x[0-9a-f]+$/i.test(query))single=parseInt(query.slice(2),16);
   else if(/^\d+$/.test(query))single=Number(query);
   else if(/^hex:\s*(?:[0-9a-f]{2}\s*)+$/i.test(query)){
    prefix=query.slice(4).replace(/\s/g,'').toUpperCase();
    if(prefix.length>32)throw Error('A tile has only 16 source bytes; hex prefix must be 16 bytes or fewer.');
   }
   else if(/^(tag|label|collection):\s*.+$/i.test(query)){const match=/^(tag|label|collection):\s*(.+)$/i.exec(query);
    librarySearch={mode:match[1].toLowerCase(),value:match[2].trim()};}
   else throw Error('Search by tile index, hex:AA BB prefix, tag:name, label:name, or collection:name.');
  }
  matched=[];
  for(let i=0;i<catalog.tiles;i++){
   if(single!==null&&i!==single)continue;
   if(mode==='unique'&&catalog.first.get(catalog.keys[i])!==i)continue;
   if(mode==='duplicate'&&catalog.counts.get(catalog.keys[i])<2)continue;
   if(mode==='blank'&&!catalog.blank[i])continue;
   if(mode==='nonblank'&&catalog.blank[i])continue;
   if(librarySearch&&!window.NES_TILE_LIBRARY?.matches(c.sourceKind,i,librarySearch.mode,librarySearch.value))continue;
   if(prefix!==null){
    let ok=true;
    for(let j=0;j<prefix.length/2;j++)if(hex(c.sourceData[i*16+j])!==prefix.slice(j*2,j*2+2)){ok=false;break}
    if(!ok)continue;
   }
   matched.push(i);
  }
  pageIndex=0;
  renderPage(c);
  ui.tileSetExport.disabled=!matched.length;
 }
 function colors(c,group=c.paletteGroup){
  if(!c.variant.data) return [[0,0,0],[85,85,85],[170,170,170],[255,255,255]];
  const shift=c.variant.data.length===32&&c.paletteLayer==='sprite'?16:0;
  return Array.from({length:4},(_,v)=>{
   const off=c.paletteLayer==='background'&&v===0?0:shift+4*group+v;
   return c.masterColors[(c.variant.data[off]??0)&63];
  });
 }
 function selectedGroup(c,tile,perTile){
  const assigned=c.assignments.get(`${c.sourceKind}:${tile}`);
  return perTile && Number.isInteger(assigned) && assigned>=0 && assigned<=3 ? assigned : c.paletteGroup;
 }
 function draw(c,indices,perTile=false){
  const width=columns*8,height=Math.max(1,Math.ceil(indices.length/columns))*8;
  if(height>16384||width*height>67108864)throw Error('Atlas exceeds canvas limits. Narrow the tile filter.');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas rendering unavailable.');
  const image=ctx.createImageData(width,height);
  indices.forEach((tile,n)=>{
   const palette=colors(c,selectedGroup(c,tile,perTile));
   const off=tile*16,dx=(n%columns)*8,dy=Math.floor(n/columns)*8;
   for(let y=0;y<8;y++){
    const lo=c.sourceData[off+y],hi=c.sourceData[off+8+y];
    for(let x=0;x<8;x++){
     const v=((lo>>(7-x))&1)|(((hi>>(7-x))&1)<<1),p=((dy+y)*width+dx+x)*4;
     image.data[p]=palette[v][0];image.data[p+1]=palette[v][1];image.data[p+2]=palette[v][2];
     image.data[p+3]=(c.transparent&&v===0)?0:255;
    }
   }
  });ctx.putImageData(image,0,0);return canvas;
 }
 function renderPage(c){
  const pages=Math.max(1,Math.ceil(matched.length/pageSize));pageIndex=Math.min(Math.max(pageIndex,0),pages-1);
  const current=matched.slice(pageIndex*pageSize,(pageIndex+1)*pageSize);
  const canvas=draw(c,current,ui.tilePaletteMode.value==='manual');
  ui.tileCatalog.width=canvas.width;ui.tileCatalog.height=canvas.height;
  ui.tileCatalog.getContext('2d').drawImage(canvas,0,0);
  ui.tilePage.textContent=`Page ${pageIndex+1} / ${pages}`;
  ui.tilePrev.disabled=pageIndex===0;ui.tileNext.disabled=pageIndex>=pages-1;
  ui.tileCatalogStatus.textContent=`${matched.length.toLocaleString()} matching tiles out of ${catalog.tiles.toLocaleString()} `+
   `(${catalog.counts.size.toLocaleString()} distinct patterns). Showing ${current.length} on this page. `+
   `${c.sourceKind==='chr'?'Exact CHR-ROM bytes':'EXPERIMENTAL PRG-ROM scan; blocks may not be graphics'}. `+
   `Click a tile to inspect it in the original atlas.`;
 }
 function metadata(c,indices,perTile){
  const hasIndices=Boolean(c.variant.data);
  const assignedCount=indices.filter(t=>c.assignments.has(`${c.sourceKind}:${t}`)).length;
  return {schema:'nes-asset-godot-tileset-v1',game:c.name,mapper:c.mapper,sourceKind:c.sourceKind,
   verifiedTileSource:c.sourceKind==='chr',sourceCRC32:c.crc32,tileSize:[8,8],columns,atlasSourceId:0,
   palette:{name:c.variant.name,origin:c.variant.kind,layer:c.paletteLayer,
    group:c.paletteGroup,exportMode:perTile?'manual-per-tile':'uniform-preview',
    rawNESIndices:hasIndices?Array.from(c.variant.data):null,assignedTileCount:assignedCount,
    verifiedRuntime:false,transparentIndex0:c.transparent,
    warning:perTile?'The atlas uses user-assigned sub-palettes when present, otherwise the selected default group. Assignments are not verified game palette usage.':
     'The atlas uses one selected sub-palette for every tile; manual assignments remain recorded but do not affect the PNG.'},
   tiles:indices.map((tile,n)=>{
    const manual=c.assignments.get(`${c.sourceKind}:${tile}`);
    return {tileIndex:tile,bank8KiB:Math.floor(tile/512),romFileOffset:c.sourceBase===null?null:c.sourceBase+tile*16,
     byteOffset:tile*16,atlasCoords:[n%columns,Math.floor(n/columns)],atlasSourceId:0,alternativeId:0,
     occurrencesInSource:catalog.counts.get(catalog.keys[tile]),manuallyAssignedGroup:manual??null,
     effectivePaletteGroup:selectedGroup(c,tile,perTile),paletteGroupSource:perTile&&manual!==undefined?'manual':'default',
     annotation:window.NES_TILE_LIBRARY?.annotationFor(c.sourceKind,tile)||null,
     collections:window.NES_TILE_LIBRARY?.collectionNames(c.sourceKind,tile)||[]};
   }),
   warning:c.sourceKind==='chr'?'Raw CHR graphics do not identify original sprites, backgrounds, or authentic palette associations.':
    'PRG scans are experimental and may include arbitrary non-graphics data.'};
 }
 function tilesetText(indices,resourceDirectory){
  const lines=['[gd_resource type="TileSet" load_steps=3 format=3]',
   '', `[ext_resource type="Texture2D" path="res://${resourceDirectory}tileset_atlas.png" id="1_atlas"]`,
   '', '[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]',
   'texture = ExtResource("1_atlas")','texture_region_size = Vector2i(8, 8)',
   'margins = Vector2i(0, 0)','separation = Vector2i(0, 0)'];
  for(let i=0;i<indices.length;i++)lines.push(`${i%columns}:${Math.floor(i/columns)}/0 = 0`);
  lines.push('','[resource]','tile_size = Vector2i(8, 8)',
   'sources/0 = SubResource("TileSetAtlasSource_1")','');
  return lines.join('\n');
 }
 async function exportTileset(){
  const c=context();if(!sourceIsCurrent(c)||!matched.length){reset();return;}
  ui.tileSetExport.disabled=true;
  try{
   // Prevent different curated collections and searches from overwriting each other in Godot.
   const identity=`${ui.tileFilter.value}|${ui.tileSearch.value.trim()}`;
   const custom=identity!=='all|'&&identity!=='all|0';
   const hash=window.NES_ASSET_API.crc32(encode.encode(identity)).toString(16).padStart(8,'0');
   const folder=custom?`filtered_${safeName(ui.tileSearch.value||ui.tileFilter.value)}_${hash}`:'tile_catalog';
   const prefix=`nes_assets/${safeName(c.name)}_${c.crc32.toLowerCase()}/${folder}/`;
   const image=draw(c,matched,ui.tilePaletteMode.value==='manual'),png=new Uint8Array(await (await c.pngBlob(image)).arrayBuffer());
   const data=metadata(c,matched,ui.tilePaletteMode.value==='manual');
   const files=[{name:prefix+'tileset_atlas.png',data:png},
    {name:prefix+'tileset.tres',data:encode.encode(tilesetText(matched,prefix))},
    {name:prefix+'tileset_metadata.json',data:encode.encode(JSON.stringify(data,null,2))},
    {name:prefix+'README.txt',data:encode.encode('Extract the nes_assets/ directory into your Godot project root.\n'+
      `Load res://${prefix}tileset.tres in TileMapLayer.tile_set.\n`+
      'TileSet source ID = 0, tile coordinates = atlasCoords in tileset_metadata.json.\n'+
      '8x8 grid; no margins or separation. Set nearest filtering in Godot.\n'+
      'User-assigned sub-palettes can color individual tiles; palette associations remain unverified.\n')}];
   c.download(c.zipStore(files),`${safeName(c.name)}_${c.crc32.toLowerCase()}_${c.sourceKind}_${folder}_godot_tileset.zip`);
   ui.tileCatalogStatus.textContent=`Exported ${matched.length.toLocaleString()} tiles to Godot TileSet atlas and JSON lookup.`;
  }catch(e){ui.tileCatalogStatus.textContent='TileSet export failed: '+e.message;}
  finally{ui.tileSetExport.disabled=false;}
 }
 ui.tileFind.addEventListener('click',()=>{try{const c=context();if(!c)return reset();filterTiles(c);}catch(e){ui.tileCatalogStatus.textContent=e.message;ui.tileSetExport.disabled=true;}});
 ui.tileSearch.addEventListener('keydown',e=>{if(e.key==='Enter')ui.tileFind.click();});
 ui.tileFilter.addEventListener('change',()=>ui.tileFind.click());
 ui.tilePrev.addEventListener('click',()=>{if(pageIndex>0){pageIndex--;renderPage(context());}});
 ui.tileNext.addEventListener('click',()=>{if((pageIndex+1)*pageSize<matched.length){pageIndex++;renderPage(context());}});
 ui.tileCatalog.addEventListener('click',e=>{
  const c=context();if(!sourceIsCurrent(c))return;
  const rect=ui.tileCatalog.getBoundingClientRect();if(!rect.width||!rect.height)return;
  const x=Math.floor((e.clientX-rect.left)*ui.tileCatalog.width/rect.width/8);
  const y=Math.floor((e.clientY-rect.top)*ui.tileCatalog.height/rect.height/8);
  const tile=matched[pageIndex*pageSize+y*columns+x];
  if(tile!==undefined&&x>=0&&x<columns)window.NES_ASSET_API.inspectTile(tile);
 });
 ui.tilePaletteMode.addEventListener('change',()=>{const c=context();if(sourceIsCurrent(c))renderPage(c);});
 window.addEventListener('nes:annotations',()=>{const c=context();if(sourceIsCurrent(c)&&matched.length)ui.tileFind.click();});
 ui.tileSetExport.addEventListener('click',exportTileset);
 for(const event of ['nes:game','nes:source'])window.addEventListener(event,reset);
 for(const id of ['paletteVariant','paletteLayer','paletteGroup','transparent'])$(id).addEventListener('change',()=>{
  const c=context();if(sourceIsCurrent(c))try{renderPage(c);}catch(e){ui.tileCatalogStatus.textContent=e.message;}
 });
 reset();
})();