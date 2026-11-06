'use strict';
// Exact 16-byte CHR-pattern deduplication. No flipped/rotated/palette equivalence is implied.
(() => {
 const $ = id => document.getElementById(id);
 const analyzeButton = $('uniqueAnalyze'), exportButton = $('uniqueExport');
 const status = $('uniqueStatus'), preview = $('uniquePreview');
 if (!analyzeButton || !exportButton || !preview) return;
 let result = null;
 const encoder = new TextEncoder();
 const rgbPreview = [[0,0,0],[85,85,85],[170,170,170],[255,255,255]];
 const hex = n => n.toString(16).toUpperCase().padStart(2, '0');

 function context() { return window.NES_ASSET_API?.getContext() || null; }
 function forget() {
  result = null; exportButton.disabled = true;
  preview.width = 128; preview.height = 8;
  preview.getContext('2d').clearRect(0,0,128,8);
  const c = context(); analyzeButton.disabled = !c;
  status.textContent = c ? 'Choose a bank or all tiles, then analyze exact 8×8 patterns.' : 'Load an NES ROM to analyze duplicate tiles.';
 }

 function scan(c) {
  const {start, count, columns} = c.view;
  if (!Number.isInteger(start) || !Number.isInteger(count) || count < 1 || start < 0 || start + count > Math.floor(c.sourceData.length / 16))
   throw Error('Invalid source tile range.');
  const patterns = new Map(), firstTiles = [], firstIndices = [], occurrences = [];
  const originalToAtlasIndex = new Array(count);
  for (let i=0; i<count; i++) {
   const off = (start + i) * 16;
   const key = String.fromCharCode(...c.sourceData.subarray(off, off+16));
   let at = patterns.get(key);
   if (at === undefined) {
    at = firstTiles.length;
    patterns.set(key, at);
    firstTiles.push(start+i);
    firstIndices.push(i);
    occurrences.push(0);
   }
   originalToAtlasIndex[i] = at;
   occurrences[at]++;
  }
  return {source:c.sourceData, start, count, columns, firstTiles, firstIndices, occurrences, originalToAtlasIndex, sourceKind:c.sourceKind};
 }

 function upToDate(c) {
  return result && c && result.source === c.sourceData && result.start === c.view.start &&
   result.count === c.view.count && result.columns === c.view.columns && result.sourceKind === c.sourceKind;
 }

 function selectedPalette(c) {
  const v = c.variant;
  if (!v?.data) return rgbPreview;
  const shift = v.data.length === 32 && c.paletteLayer === 'sprite' ? 16 : 0;
  return Array.from({length:4}, (_, pixel) => {
   const pos = (pixel === 0 && c.paletteLayer === 'background') ? 0 : shift + 4*c.paletteGroup + pixel;
   return c.masterColors[(v.data[pos] ?? 0) & 63];
  });
 }

 function drawAtlas(c, catalog) {
  const count = catalog.firstTiles.length, cols = catalog.columns;
  const width = cols*8, height = Math.ceil(count/cols)*8;
  if (width > 16384 || height > 16384 || width*height > 67108864)
   throw Error('Unique atlas exceeds canvas limits. Select a smaller bank or more columns.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('Canvas rendering unavailable.');
  const image = ctx.createImageData(width, height);
  const pal = selectedPalette(c);
  for (let i=0; i<count; i++) {
   const off = catalog.firstTiles[i]*16, x0 = (i%cols)*8, y0 = Math.floor(i/cols)*8;
   for (let y=0; y<8; y++) {
    const lo = c.sourceData[off+y], hi = c.sourceData[off+y+8];
    for (let x=0; x<8; x++) {
     const value = ((lo >>> (7-x)) & 1) | (((hi >>> (7-x)) & 1) << 1);
     const p = ((y0+y)*width + x0+x)*4;
     image.data[p] = pal[value][0]; image.data[p+1] = pal[value][1];
     image.data[p+2] = pal[value][2]; image.data[p+3] = c.transparent && value === 0 ? 0 : 255;
    }
   }
  }
  ctx.putImageData(image,0,0);
  return canvas;
 }

 function catalogMetadata(c, catalog) {
  const uniqueTiles = catalog.firstTiles.map((tile, atlasIndex) => ({
   atlasIndex, originalTileIndex:tile, sourceByteOffset:tile*16,
   romFileOffset:c.sourceBase === null ? null : c.sourceBase + tile*16,
   occurrences:catalog.occurrences[atlasIndex],
   x: (atlasIndex%catalog.columns)*8, y:Math.floor(atlasIndex/catalog.columns)*8
  }));
  const manual = Object.fromEntries([...c.assignments]
   .filter(([key]) => {
    const [kind, index] = key.split(':');
    return kind === c.sourceKind && Number(index) >= catalog.start && Number(index) < catalog.start + catalog.count;
   }).map(([key, group]) => [Number(key.split(':')[1]), group]));
  return {
   schema:'nes-asset-unique-tiles-v1', game:c.name, mapper:c.mapper, sourceKind:c.sourceKind,
   verifiedTileSource:c.sourceKind === 'chr', sourceCRC32:c.crc32,
   identity:'Exact 16 source bytes per 8x8 2bpp tile; no flip, rotation or palette equivalence',
   firstOriginalTile:catalog.start, originalTileCount:catalog.count,
   uniqueTileCount:uniqueTiles.length, duplicateTileCount:catalog.count - uniqueTiles.length,
   tileWidth:8, tileHeight:8, columns:catalog.columns,
   imageWidth:catalog.columns*8, imageHeight:Math.ceil(uniqueTiles.length/catalog.columns)*8,
   // The Nth entry is the unique-atlas index for original tile (firstOriginalTile+N).
   originalToAtlasIndex:catalog.originalToAtlasIndex,
   uniqueTiles,
   imagePalette:{name:c.variant.name, origin:c.variant.kind, layer:c.paletteLayer,
    group:c.paletteGroup, transparentIndex0:c.transparent, rawIndices:c.variant.data?Array.from(c.variant.data):null, verifiedRuntime:false,
    note:'Atlas uses one selected preview palette. It does not apply each original tile manual palette assignment.'},
   manualPaletteAssignmentsByOriginalTile:manual,
   warning:c.sourceKind === 'chr' ?
    'Tile patterns are exact CHR-ROM bytes; their in-game assembly and palette identity are not known.' :
    'PRG-ROM scanning is experimental and can include non-graphics data; identical 16-byte blocks are not necessarily tiles.'
  };
 }

 function uniqueBytes(c, catalog) {
  const bytes = new Uint8Array(catalog.firstTiles.length*16);
  for (let i=0; i<catalog.firstTiles.length; i++)
   bytes.set(c.sourceData.subarray(catalog.firstTiles[i]*16, catalog.firstTiles[i]*16+16), i*16);
  return bytes;
 }

 analyzeButton.addEventListener('click', () => {
  try {
   const c=context(); if (!c) return forget();
   result=scan(c); const canvas=drawAtlas(c,result);
   preview.width=canvas.width; preview.height=canvas.height;
   preview.getContext('2d').drawImage(canvas,0,0);
   exportButton.disabled=false;
   status.textContent=`${result.count.toLocaleString()} original tiles → ${result.firstTiles.length.toLocaleString()} unique tile patterns; ${(result.count-result.firstTiles.length).toLocaleString()} duplicates (${((result.count-result.firstTiles.length)/result.count*100).toFixed(1)}%).\n`+
    `${c.sourceKind === 'chr'?'Verified CHR-ROM tile bytes':'EXPERIMENTAL PRG-ROM byte scan'}; exact byte equality only. Click a unique tile to select its first source occurrence.`;
  } catch (e) { forget(); status.textContent='Unique tile analysis failed: '+e.message; }
 });
 preview.addEventListener('click', e => {
  const c=context(); if (!upToDate(c)) return;
  const bounds=preview.getBoundingClientRect(); if (!bounds.width || !bounds.height) return;
  const x=Math.floor((e.clientX-bounds.left)*preview.width/bounds.width/8);
  const y=Math.floor((e.clientY-bounds.top)*preview.height/bounds.height/8);
  const idx=y*result.columns+x;
  if (x>=0 && x<result.columns && idx>=0 && idx<result.firstTiles.length)
   window.NES_ASSET_API.inspectTile(result.firstTiles[idx]);
 });
 exportButton.addEventListener('click', async () => {
  const c=context();
  if (!upToDate(c)) { forget(); status.textContent='Source or bank changed. Analyze again before exporting.'; return; }
  exportButton.disabled=true;
  try {
   const image=drawAtlas(c,result);
   const png=new Uint8Array(await (await c.pngBlob(image)).arrayBuffer());
   const metadata=catalogMetadata(c,result);
   const entries=[
    {name:'unique_tiles.png',data:png},
    {name:'unique_tiles.json',data:encoder.encode(JSON.stringify(metadata,null,2))},
    {name:'unique_tiles.'+(c.sourceKind==='chr'?'chr':'bin'),data:uniqueBytes(c,result)},
    {name:'README.txt',data:encoder.encode('Lossless exact 16-byte NES 2bpp tile deduplication. PNG has an 8x8 grid.\nRead originalToAtlasIndex[N] to locate original tile firstOriginalTile+N in the unique atlas.\nManual palette assignments are retained by original tile in JSON, NOT painted individually into the PNG.\nFor PRG-ROM scans, blocks are NOT proven to be graphics.\n')}
   ];
   const safe=c.name.replace(/\.nes$/i,'').replace(/[^a-z0-9._-]+/gi,'_').slice(0,96);
   c.download(c.zipStore(entries),`${safe}_${c.sourceKind}_unique_tiles.zip`);
   status.textContent=`Exported ${result.firstTiles.length} unique tiles and complete ${result.count}-tile lookup table.`;
  } catch (e) {status.textContent='Export failed: '+e.message;}
  finally {exportButton.disabled=false;}
 });
 for (const event of ['nes:game','nes:source']) window.addEventListener(event, forget);
 for (const id of ['scope','bankSize','bank','cols']) $(id).addEventListener('change', forget);
 // Re-draw the small unique preview when the user changes palette settings, preserving the scan.
 for (const id of ['paletteVariant','paletteLayer','paletteGroup','transparent']) $(id).addEventListener('change', () => {
  const c=context(); if (!upToDate(c)) return;
  try {const canvas=drawAtlas(c,result);preview.width=canvas.width;preview.height=canvas.height;preview.getContext('2d').drawImage(canvas,0,0)}
  catch (e) {status.textContent=e.message;}
 });
 forget();
})();
