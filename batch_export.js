'use strict';
// Batch CHR-ROM export: exact 8x8 tile decoding, no emulator or speculative PRG decoding.
(() => {
 const api=window.NES_ASSET_API;
 const button=document.getElementById('batchExport');
 const note=document.getElementById('batchStatus');
 const transparent=document.getElementById('batchTransparent');
 const encode=new TextEncoder();
 const MAX_OUTPUT_BYTES=256*1024*1024;
 const BANK_BYTES=8192, COLS=16;
 if(!api||!button||!note||!transparent)throw Error('Batch export UI or renderer missing.');
 const safeName=name=>(name.replace(/\.nes$/i,'').replace(/[^a-z0-9._-]/gi,'_').replace(/^\.+/,'').slice(0,64)||'rom');
 const hex=n=>n.toString(16).toUpperCase().padStart(8,'0');
 const toBytes=value=>encode.encode(JSON.stringify(value,null,2)+'\n');
 const csvCell=s=>'"'+String(s??'').replace(/"/g,'""')+'"';
 function atlas(chr,first,count,seeThrough){
  const canvas=document.createElement('canvas');
  canvas.width=COLS*8;canvas.height=Math.max(1,Math.ceil(count/COLS))*8;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Canvas 2D context unavailable.');
  const image=ctx.createImageData(canvas.width,canvas.height),out=image.data;
  for(let t=0;t<count;t++){
   const offset=(first+t)*16,tx=t%COLS*8,ty=Math.floor(t/COLS)*8;
   for(let y=0;y<8;y++){
    const low=chr[offset+y],high=chr[offset+y+8];
    for(let x=0;x<8;x++){
     const bit=7-x,v=((low>>bit)&1)|(((high>>bit)&1)<<1);
     const pixel=((ty+y)*canvas.width+tx+x)*4,shade=v*85;
     out[pixel]=out[pixel+1]=out[pixel+2]=shade;
     out[pixel+3]=seeThrough&&v===0?0:255;
    }
   }
  }
  ctx.putImageData(image,0,0);return canvas;
 }
 function reportCSV(games){
  const lines=[['game','status','mapper','prg_bytes','chr_bytes','tiles','chr_crc32','note']];
  for(const g of games)lines.push([g.name,g.status,g.mapper,g.prgBytes,g.chrBytes,g.tileCount,g.chrCRC32,g.note]);
  return lines.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
 }
 function headerSummary(rom){
  return {name:rom.name,mapper:rom.mapper,headerFormat:rom.nes2?'NES 2.0':'iNES',
   prgBytes:rom.prgSize,chrBytes:rom.chrSize,tileCount:Math.floor(rom.chrSize/16),
   chrCRC32:rom.chrSize?hex(api.crc32(rom.chr)):null};
 }
 async function collect(){
  const games=api.libraryEntries();
  if(!games.length){note.textContent='Load one or more NES games first.';return}
  button.disabled=true;
  const files=[],manifest={schema:'nes-asset-batch-v1',pixelEncoding:'NES planar 2bpp',
   palette:'grayscale preview, not verified game colors',transparentPixel0:transparent.checked,
   columns:COLS,bankBytes:BANK_BYTES,games:[],summary:{total:games.length,exported:0,needsDecoder:0,failed:0}};
  let byteTotal=0;
  const append=(name,data)=>{
   if(++fileCount>10000)throw Error('Too many batch files. Use a smaller game collection.');
   byteTotal+=data.length;
   if(byteTotal>MAX_OUTPUT_BYTES)throw Error('Batch exceeds 256 MiB output limit. Split the collection into smaller ZIPs.');
   files.push({name,data});
  };
  let fileCount=0;
  try{
   for(let i=0;i<games.length;i++){
    const item=games[i];note.textContent=`Processing ${i+1}/${games.length}: ${item.name}`;
    // Yield between cartridges so progress updates remain visible.
    await new Promise(resolve=>setTimeout(resolve,0));
    let entry={index:i,name:item.name,status:'failed',note:'Unknown error'};
    const start=files.length,oldBytes=byteTotal,oldCount=fileCount;
    try{
     const rom=await api.readROMAtIndex(i);
     entry={index:i,...headerSummary(rom),status:'failed',note:'',files:[]};
     if(!rom.chrSize){
      entry.status='requires-game-decoder';entry.note='CHR-RAM game: graphics are loaded into PPU RAM by game code. No reliable direct CHR-ROM atlas is available.';
      manifest.summary.needsDecoder++;
     }else if(rom.chrSize%16!==0){
      throw Error('CHR size does not contain complete 16-byte tiles.');
     }else{
      const folder=`nes_assets/batch/game_${String(i).padStart(3,'0')}_${safeName(item.name)}_${entry.chrCRC32.toLowerCase()}/`;
      const rawFile=folder+'original_chr.chr';append(rawFile,rom.chr);entry.files.push(rawFile);
      const bankCount=Math.ceil(rom.chr.length/BANK_BYTES);
      entry.banks=[];
      for(let b=0;b<bankCount;b++){
       const first=b*BANK_BYTES/16,count=Math.min(BANK_BYTES/16,rom.chr.length/16-first);
       const filename=folder+`bank_${String(b).padStart(3,'0')}.png`;
       const blob=await api.pngBlob(atlas(rom.chr,first,count,transparent.checked));
       append(filename,new Uint8Array(await blob.arrayBuffer()));entry.files.push(filename);
       entry.banks.push({bank:b,firstTile:first,tileCount:count,image:filename,
        imageWidth:COLS*8,imageHeight:Math.ceil(count/COLS)*8,
        romFileOffset:rom.chrOffset+first*16,chrByteOffset:first*16});
      }
      const metaFile=folder+'tiles.json';
      append(metaFile,toBytes({schema:'nes-asset-batch-tilemap-v1',name:rom.name,
       mapper:rom.mapper,sourceKind:'chr',verifiedSourceBytes:true,
       sourceCRC32:entry.chrCRC32,chrROMFileOffset:rom.chrOffset,
       tilePixels:[8,8],tileBytes:16,bankBytes:BANK_BYTES,columns:COLS,
       transparentPixel0:transparent.checked,palette:'preview-grayscale-not-runtime',
       banks:entry.banks}));entry.files.push(metaFile);
      entry.status='exported';entry.note='Exact CHR-ROM tiles; PNG colors are preview grayscale, not game palettes.';
      manifest.summary.exported++;
     }
    }catch(err){
     // Never include partially exported ROM content if one bank fails.
     files.length=start;byteTotal=oldBytes;fileCount=oldCount;
     entry.status='failed';entry.note=err.message;
     manifest.summary.failed++;
    }
    manifest.games.push(entry);
   }
   append('compatibility_report.csv',encode.encode(reportCSV(manifest.games)));
   append('batch_index.json',toBytes(manifest));
   append('README.txt',encode.encode('NESAssetDump batch graphics export.\n'+
    'Each PNG is an unscaled 8x8 grid with 16 columns (128px wide), zero margins or spacing.\n'+
    'PNG colors are grayscale previews of source pixel values 0-3; they are NOT verified game palettes.\n'+
    'Set Godot Texture Filter to Nearest. See tiles.json for per-bank original ROM file offsets.\n'+
    'original_chr.chr preserves the exact bytes for each CHR-ROM cartridge.\n'+
    'CHR-RAM games are listed in the CSV report; their game-specific PRG graphics are not automatically decoded.\n'));
   api.download(api.zipStore(files),'NESAssetDump_batch_chr_rom.zip');
   note.textContent=`Batch exported: ${manifest.summary.exported} CHR-ROM games; `+
    `${manifest.summary.needsDecoder} CHR-RAM games flagged; ${manifest.summary.failed} failures. `+
    'See compatibility_report.csv in the ZIP.';
  }catch(err){note.textContent='Batch export failed: '+err.message}
  finally{button.disabled=false}
 }
 button.addEventListener('click',collect);
 for(const event of ['nes:library','nes:game'])window.addEventListener(event,()=>{button.disabled=api.libraryEntries().length===0});
})();