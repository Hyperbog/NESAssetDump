
'use strict';
const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['files','game','status','source','sourceNote','bankSize','bank','scope','cols','transparent','paletteVariant','paletteGroup','paletteLayer','paint','preview','detail','tileInfo','paletteSwatches','paletteNote','paletteFile','paintCount','png','json','raw','pack','variants','exportPalette','paletteRaw','paletteSwatch','paletteCsv','palettePack','masterPal','exportStatus'].map(id=>[id,$(id)]));
let library=[],rom=null,sourceData=null,sourceKind='',sourceBase=null,chosen=0,view=null,loadCounter=0;
const colorPreview = ['#000000','#555555','#AAAAAA','#FFFFFF'];
// 64-color NTSC-style reference RGB table. A display approximation, not a pixel-perfect physical PPU model.
const RGB64 = (`666666 002A88 1412A7 3B00A4 5C007E 6E0040 6C0600 561D00 333500 0B4800 005200 004F08 00404D 000000 000000 000000 ADADAD 155FD9 4240FF 7527FE A01ACC B71E7B B53120 994E00 6B6D00 388700 0C9300 008F32 007C8D 000000 000000 000000 FFFFFF 64B0FF 9290FF C676FF F36AFF FE6ECC FE8170 EA9E22 BCBE00 88D800 5CE430 45E082 48CDDE 4F4F4F 000000 000000 FFFFFF C0DFFF D3D2FF E8C8FF FBC2F2 FEC4D9 FECCC5 F7D8A5 E4E594 CFEEA6 BDF4B6 B3F3CC B5EBF2 B8B8B8 000000 000000`).split(/\s+/).map(s=>[0,2,4].map(i=>parseInt(s.slice(i,i+2),16)));
let masterColors=RGB64;
const variantPreview={id:'preview',name:'Grayscale preview (not game colors)',kind:'preview',data:null,offset:null};
let variants=[variantPreview],assignments=new Map(),painting=false;
const textEncoder=new TextEncoder();
function hex(n,places=2){return n.toString(16).toUpperCase().padStart(places,'0')}
function message(str){ui.exportStatus.textContent=str}
function error(str){ui.status.textContent=str;for(const id of ['png','json','raw','pack','variants','exportPalette','paletteRaw','paletteSwatch','paletteCsv','palettePack','masterPal'])ui[id].disabled=true}
function sizeLabel(n){return (n/1024).toLocaleString()+' KiB'}
function readNES(b,name){
 if(b.length<16||b[0]!==78||b[1]!==69||b[2]!==83||b[3]!==26)throw Error('Unsupported cartridge format: expected an iNES or NES 2.0 .nes file.');
 const h=b.subarray(0,16),nes2=(h[7]&12)===8,mapper=(h[6]>>4)|(h[7]&240)|(nes2?(h[8]&15)<<8:0),trainer=(h[6]&4)?512:0;
 const romSize=(low,upper,unit)=>upper===15?2**(low>>2)*(2*(low&3)+1):((upper<<8)|low)*unit;
 const prgSize=nes2?romSize(h[4],h[9]&15,16384):h[4]*16384;
 const chrSize=nes2?romSize(h[5],h[9]>>4,8192):h[5]*8192;
 const prgOffset=16+trainer,chrOffset=prgOffset+prgSize;
 if(!Number.isSafeInteger(prgSize)||!Number.isSafeInteger(chrSize)||prgSize<0||chrSize<0||prgSize+chrOffset>Number.MAX_SAFE_INTEGER)throw Error('Invalid ROM size in header.');
 if(prgSize===0||b.length<chrOffset+chrSize)throw Error('Truncated or invalid PRG/CHR data.');
 return {name,nes2,mapper,prgSize,chrSize,prgOffset,chrOffset,prg:b.subarray(prgOffset,chrOffset),chr:b.subarray(chrOffset,chrOffset+chrSize),dump:null,assignments:new Map(),variants:null};
}
const CRC_TABLE=Uint32Array.from({length:256},(_,i)=>{let v=i;for(let b=0;b<8;b++)v=v&1?0xEDB88320^(v>>>1):v>>>1;return v>>>0});
function crc32(bytes){let n=0xffffffff;for(const v of bytes)n=CRC_TABLE[(n^v)&255]^(n>>>8);return (n^0xffffffff)>>>0}
// ZIP reader uses the central directory rather than scanning compressed data for signatures.
function openZip(bytes){
 const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=bytes.length;
 let eocd=-1;for(let p=length-22;p>=Math.max(0,length-65557);p--)if(dv.getUint32(p,true)===0x06054b50&&p+22+dv.getUint16(p+20,true)===length){eocd=p;break}
 if(eocd<0)throw Error('ZIP central directory not found.');
 if(dv.getUint16(eocd+4,true)||dv.getUint16(eocd+6,true))throw Error('Multi-disk ZIP is unsupported.');
 const total=dv.getUint16(eocd+10,true),start=dv.getUint32(eocd+16,true),size=dv.getUint32(eocd+12,true);
 if(total===65535||start===0xffffffff||size===0xffffffff)throw Error('ZIP64 archives are not yet supported.');
 if(start+size>eocd)throw Error('Invalid ZIP central directory offset.');
 const entries=[];let p=start;
 for(let i=0;i<total;i++){
  if(p+46>eocd||dv.getUint32(p,true)!==0x02014b50)throw Error('Invalid ZIP entry header.');
  const flags=dv.getUint16(p+8,true),method=dv.getUint16(p+10,true),crc=dv.getUint32(p+16,true),comp=dv.getUint32(p+20,true),raw=dv.getUint32(p+24,true),nm=dv.getUint16(p+28,true),ex=dv.getUint16(p+30,true),cm=dv.getUint16(p+32,true),local=dv.getUint32(p+42,true);
  if(p+46+nm+ex+cm>eocd)throw Error('Truncated ZIP entry.');
  const name=new TextDecoder(flags&2048?'utf-8':'windows-1252').decode(bytes.subarray(p+46,p+46+nm));
  if(name.toLowerCase().endsWith('.nes')){
   if(flags&1)throw Error('Encrypted NES entries are unsupported.');
   if(method!==0&&method!==8)throw Error(`ZIP compression method ${method} is unsupported.`);
   entries.push({name,local,comp,raw,crc,method,bytes});
  }
  p+=46+nm+ex+cm;
 }
 return entries;
}
async function unzipNES(entry){
 const b=entry.bytes,dv=new DataView(b.buffer,b.byteOffset,b.byteLength),p=entry.local;
 if(p+30>b.length||dv.getUint32(p,true)!==0x04034b50)throw Error('Invalid ZIP local file record.');
 const start=p+30+dv.getUint16(p+26,true)+dv.getUint16(p+28,true);
 if(start+entry.comp>b.length||entry.raw>64*1024*1024)throw Error('Invalid or excessively large ROM in ZIP.');
 const compressed=b.subarray(start,start+entry.comp);let result;
 if(entry.method===0)result=compressed.slice();
 else{
  if(typeof DecompressionStream==='undefined')throw Error('ZIP decompression unavailable in this browser. Extract the .nes file and load it directly.');
  result=new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
 }
 if(result.length!==entry.raw||crc32(result)!==entry.crc)throw Error(`ZIP integrity check failed for ${entry.name}`);
 return result;
}
async function addFiles(fileList){
 const previousGame=library[Number(ui.game.value)]?.name;
 let added=0,issues=[];
 for(const f of fileList){try{
  const b=new Uint8Array(await f.arrayBuffer());
  if(f.name.toLowerCase().endsWith('.zip')){
   const children=openZip(b);for(const e of children){library.push({name:e.name.split('/').pop(),zip:e});added++}
   if(!children.length)issues.push(`${f.name}: no .nes entries`);
  }else if(f.name.toLowerCase().endsWith('.nes')){library.push({name:f.name,bytes:b});added++}
  else issues.push(`${f.name}: not .nes or .zip`);
 }catch(e){issues.push(`${f.name}: ${e.message}`)}}
 library.sort((a,b)=>a.name.localeCompare(b.name));
 ui.game.replaceChildren();for(let i=0;i<library.length;i++){const o=document.createElement('option');o.value=String(i);o.textContent=library[i].name;ui.game.append(o)}
 ui.game.disabled=!library.length;if(library.length){const at=previousGame?library.findIndex(e=>e.name===previousGame):-1;ui.game.value=String(at>=0?at:0);await selectGame()}
 if(issues.length)message(issues.join('\n'));else message(`${added} ROM${added===1?'':'s'} added (${library.length} in library).`);
}
async function selectGame(){
 const seq=++loadCounter,entry=library[Number(ui.game.value)];if(!entry)return;
 ui.status.textContent='Reading '+entry.name+'…';
 try{
  const b=entry.bytes||await unzipNES(entry.zip);if(seq!==loadCounter)return;
  rom=readNES(b,entry.name);assignments=rom.assignments;rom.variants=[variantPreview];variants=rom.variants;
  ui.source.replaceChildren();const opt=(id,name)=>{const o=document.createElement('option');o.value=id;o.textContent=name;ui.source.append(o)};
  if(rom.chrSize)opt('chr','CHR-ROM — original tiles');
  opt('prg','PRG-ROM — experimental 2bpp scan');
  if(rom.dump)opt('dump','Imported PPU pattern dump');
  ui.source.value=rom.chrSize?'chr':'prg';ui.bankSize.value='8192';ui.scope.value='bank';ui.cols.value='16';ui.transparent.checked=true;ui.paletteLayer.value='sprite';ui.paletteGroup.value='0';ui.paint.checked=false;
  // Scan for candidate palette sets; candidates are never presented as verified runtime colors.
  const candidates=paletteCandidates(rom.prg);
  for(const c of candidates)variants.push({id:'rom'+c.offset,name:`PRG palette candidate @0x${hex(rom.prgOffset+c.offset,6)} (${c.length}B)`,kind:'candidate',data:c.data,offset:rom.prgOffset+c.offset,confidence:'unverified'});
  rebuildVariantSelect();updateSource();window.dispatchEvent(new Event("nes:game"));
  ui.status.textContent=`${rom.name}\nMapper ${rom.mapper} | ${rom.nes2?'NES 2.0':'iNES'} | PRG ${sizeLabel(rom.prgSize)} | CHR-ROM ${sizeLabel(rom.chrSize)}${rom.chrSize?'': ' (CHR-RAM cartridge)'}\n${library.length} game(s) in library; ${candidates.length} candidate palette set(s) found in PRG.`;
 }catch(e){rom=null;error(`${entry.name}: ${e.message}`)}
}
function paletteCandidates(prg){
 const found=[];if(prg.length>8*1024*1024)return found;
 // Two-pass: 32-byte snapshots first, then independent 16-byte tables. Both remain unverified.
 for(const length of [32,16])for(let off=0;off+length<=prg.length;off++){
  let valid=true;for(let j=0;j<length;j++)if(prg[off+j]>63){valid=false;break}if(!valid)continue;
  const seq=prg.subarray(off,off+length),unique=new Set(seq);
  if(unique.size<7||unique.size>20)continue;
  if(length===16&&new Set([seq[0],seq[4],seq[8],seq[12]]).size>2)continue;
  // Equal leading backdrop indices are typical but not guaranteed; this is a heuristic only.
  if(length===32&&new Set([seq[0],seq[4],seq[8],seq[12]]).size>2)continue;
  if(found.some(c=>off>=c.offset&&off+length<=c.offset+c.length))continue;
  found.push({offset:off,length,data:seq.slice()});
  if(found.length>=40)return found;
 }
 return found;
}
function rebuildVariantSelect(){
 ui.paletteVariant.replaceChildren();for(let i=0;i<variants.length;i++){const o=document.createElement('option');o.value=String(i);o.textContent=variants[i].name;ui.paletteVariant.append(o)}ui.paletteVariant.value='0';updatePaletteUI();
}
function activeVariant(){return variants[Number(ui.paletteVariant.value)||0]||variantPreview}
function updateSource(){if(!rom)return;const kind=ui.source.value;sourceKind=kind;
 if(kind==='chr'){sourceData=rom.chr;sourceBase=rom.chrOffset;ui.sourceNote.textContent='Verified CHR-ROM: every 16-byte pattern is preserved exactly.'}
 else if(kind==='dump'){sourceData=rom.dump;sourceBase=null;ui.sourceNote.textContent='Imported runtime pattern bytes; which ROM bank supplied each tile may be unknown.'}
 else {sourceData=rom.prg;sourceBase=rom.prgOffset;ui.sourceNote.textContent='EXPERIMENTAL: these are PRG bytes interpreted as 2bpp tiles, not confirmed graphics. Games with CHR-RAM may use compression or custom layouts.'}
 ui.bank.value='0';refreshBanks();window.dispatchEvent(new Event("nes:source"));
}
function refreshBanks(){if(!rom)return;const old=Number(ui.bank.value)||0,amount=Math.ceil(sourceData.length/Number(ui.bankSize.value));ui.bank.replaceChildren();for(let i=0;i<amount;i++){const o=document.createElement('option');o.value=String(i);o.textContent=`Bank ${i} +0x${hex(i*Number(ui.bankSize.value),5)}`;ui.bank.append(o)}ui.bank.value=String(Math.min(old,amount-1));render()}
function getView(){const bytes=Number(ui.bankSize.value),count=Math.floor(sourceData.length/16),first=ui.scope.value==='all'?0:Number(ui.bank.value)*bytes/16;return {start:first,count:ui.scope.value==='all'?count:Math.min(bytes/16,count-first),columns:Number(ui.cols.value)};}
function getPalette(index,layer=ui.paletteLayer.value,group=Number(ui.paletteGroup.value),variant=activeVariant()){
 if(variant.kind==='preview')return colorPreview.map(c=>[0,2,4].map(i=>parseInt(c.slice(i+1,i+3),16)));
 const shift=variant.data.length===32&&(layer==='sprite')?16:0,offset=shift+group*4;
 return Array.from({length:4},(_,i)=>masterColors[(i===0&&layer==='background'?variant.data[0]:variant.data[offset+i]||0)&63]);
}
function paintImage(start,count,columns,options={}){
 const rows=Math.ceil(count/columns),canvas=document.createElement('canvas');canvas.width=columns*8;canvas.height=rows*8;
 if(canvas.width>16384||canvas.height>16384||canvas.width*canvas.height>67108864)throw Error('Atlas exceeds canvas limits. Select smaller banks or more columns.');
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable.');
 const image=ctx.createImageData(canvas.width,canvas.height),layer=options.layer??ui.paletteLayer.value,variant=options.variant??activeVariant(),group=options.group??Number(ui.paletteGroup.value),trans=options.transparent??ui.transparent.checked,useAssignments=options.assignments??true;
 const palettes=Array.from({length:4},(_,i)=>getPalette(start,layer,i,variant)); // start is unused in palette selection; explicit layer and group are relevant
 for(let t=0;t<count;t++){
  const offset=(start+t)*16,x0=t%columns*8,y0=Math.floor(t/columns)*8,assigned=useAssignments?assignments.get(`${sourceKind}:${start+t}`):undefined;
  const pal=palettes[assigned===undefined?group:assigned];
  for(let y=0;y<8;y++){const a=sourceData[offset+y],b=sourceData[offset+y+8];for(let x=0;x<8;x++){
   const v=((a>>(7-x))&1)|(((b>>(7-x))&1)<<1),pixel=((y0+y)*canvas.width+x0+x)*4,color=pal[v];
   image.data[pixel]=color[0];image.data[pixel+1]=color[1];image.data[pixel+2]=color[2];image.data[pixel+3]=trans&&v===0?0:255;
  }}
 }
 ctx.putImageData(image,0,0);return canvas;
}
function render(){if(!rom)return;try{
 view=getView();ui.bank.disabled=ui.scope.value==='all';const atlas=paintImage(view.start,view.count,view.columns);ui.preview.width=atlas.width;ui.preview.height=atlas.height;ui.preview.getContext('2d').drawImage(atlas,0,0);for(const id of ['png','json','raw','pack','variants','exportPalette','paletteRaw','paletteSwatch','paletteCsv','palettePack','masterPal'])ui[id].disabled=false;inspect(view.start);updatePaletteUI();
 }catch(e){error(e.message)}}
function inspect(tile){if(!rom||tile<0||tile>=sourceData.length/16)return;chosen=tile;
 const tileImg=paintImage(tile,1,1);ui.detail.getContext('2d').clearRect(0,0,8,8);ui.detail.getContext('2d').drawImage(tileImg,0,0);
 const bytes=sourceData.subarray(tile*16,tile*16+16),location=sourceBase===null?'external dump':`0x${hex(sourceBase+tile*16,6)}`;
 ui.tileInfo.textContent=`Tile #${tile}\n${sourceKind.toUpperCase()} offset: 0x${hex(tile*16,5)}\nROM file offset: ${location}\nPalette group: ${assignments.get(`${sourceKind}:${tile}`)??'default'}\n${Array.from(bytes,x=>hex(x)).join(' ')}`;window.dispatchEvent(new CustomEvent("nes:tile",{detail:{tile}}));
}
function updatePaletteUI(){if(!rom)return;const v=activeVariant(),colors=getPalette(0);
 ui.paletteSwatches.replaceChildren();for(let k=0;k<4;k++){const e=document.createElement('span');e.style.background=`rgb(${colors[k].join(',')})`;e.title=`Pixel ${k}: ${v.data?'NES index '+hex(v.data[(v.data.length===32&&ui.paletteLayer.value==='sprite'?16:0)+Number(ui.paletteGroup.value)*4+k]&63):'Preview only'}`;ui.paletteSwatches.append(e)}
 ui.paletteNote.textContent=v.kind==='preview'?'Preview only; no palette has been verified for this game.':v.kind==='candidate'?'Unverified PRG palette candidate. Palette role, intended sprites/tiles and scene association are unknown.':`Imported ${v.data.length}-byte palette data. Exact source bytes; tile/sprite association is not implicit.`;
 ui.paintCount.textContent=`${assignments.size} manually assigned tile(s)`;
 ui.paletteRaw.disabled=!v.data; // Grayscale previews have no authentic NES palette byte indices.
 ui.paletteSwatch.disabled=!v.data;
 ui.paletteCsv.disabled=!v.data;
}
function stem(){return rom.name.replace(/\.nes$/i,'').replace(/[^a-z0-9._-]+/gi,'_').slice(0,120)}
function suffix(){return `${sourceKind}_${ui.scope.value==='all'?'all':`bank${ui.bank.value}_${ui.bankSize.value}B`}_${view.columns}col`}
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function makeMeta(start,count,columns,options={}){
 const variant=options.variant||activeVariant(),group=options.group??Number(ui.paletteGroup.value),layer=options.layer||ui.paletteLayer.value;
 return {schema:'nes-godot-ripper-v3',rom:rom.name,mapper:rom.mapper,nes2:rom.nes2,sourceKind,verifiedTileSource:sourceKind==='chr',warning:sourceKind==='prg'?'PRG byte scan is NOT proven graphics or decoded CHR-RAM data.':null,originalRomOffset:sourceBase,sourceCRC32:hex(crc32(sourceData),8),tileWidth:8,tileHeight:8,columns,rows:Math.ceil(count/columns),imageWidth:columns*8,imageHeight:Math.ceil(count/columns)*8,firstTile:start,tileCount:count,layer,paletteGroup:group,paletteVariant:{name:variant.name,kind:variant.kind,sourceOffset:variant.offset||null,rawIndices:variant.data?Array.from(variant.data):null,verifiedRuntime:false},masterPaletteNote:'NTSC-style RGB approximation, may differ from emulator or hardware; import 192B master PAL to customize.',transparentIndex0:options.transparent??ui.transparent.checked,assignments:Object.fromEntries([...assignments].filter(([key])=>{const [kind,tile]=key.split(':');return kind===sourceKind&&Number(tile)>=start&&Number(tile)<start+count}).map(([key,g])=>[Number(key.split(':')[1]),g])),tiles:Array.from({length:count},(_,i)=>({atlasIndex:i,tileIndex:start+i,byteOffset:(start+i)*16,romFileOffset:sourceBase===null?null:sourceBase+(start+i)*16,x:(i%columns)*8,y:Math.floor(i/columns)*8,paletteGroup:assignments.get(`${sourceKind}:${start+i}`)??group}))};
}
function zipStore(entries){
 const parts=[],central=[];let offset=0,total=0;
 const u16=(v,i,n)=>v.setUint16(i,n,true),u32=(v,i,n)=>v.setUint32(i,n>>>0,true);
 for(const e of entries){const name=textEncoder.encode(e.name),data=e.data,crc=crc32(data);
  if(name.length>65535||data.length>0xffffffff)throw Error('ZIP entry too large');
  const local=new Uint8Array(30+name.length),lv=new DataView(local.buffer);u32(lv,0,0x04034b50);u16(lv,4,20);u16(lv,6,0x800);u32(lv,14,crc);u32(lv,18,data.length);u32(lv,22,data.length);u16(lv,26,name.length);local.set(name,30);
  const c=new Uint8Array(46+name.length),cv=new DataView(c.buffer);u32(cv,0,0x02014b50);u16(cv,4,20);u16(cv,6,20);u16(cv,8,0x800);u32(cv,16,crc);u32(cv,20,data.length);u32(cv,24,data.length);u16(cv,28,name.length);u32(cv,42,offset);c.set(name,46);
  parts.push(local,data);central.push(c);offset+=local.length+data.length;total+=c.length;
 }
 if(entries.length>65535||offset+total>0xffffffff)throw Error('ZIP too large.');
 const footer=new Uint8Array(22),v=new DataView(footer.buffer);u32(v,0,0x06054b50);u16(v,8,entries.length);u16(v,10,entries.length);u32(v,12,total);u32(v,16,offset);
 return new Blob([...parts,...central,footer],{type:'application/zip'});
}
function pngBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG creation failed.')),'image/png'))}

function rgbHex(color){return '#'+color.map(n=>hex(n)).join('')}
function paletteRows(v){
 if(!v.data)return [];
 const count=v.data.length===32?8:4;
 return Array.from({length:count},(_,index)=>{
  const layer=v.data.length===32&&index>=4?'sprite':(v.data.length===32?'background':ui.paletteLayer.value);
  const group=index%4,base=index*4;
  const indices=Array.from({length:4},(_,pixel)=>v.data[base+pixel]&63);
  const colors=indices.map((idx,pixel)=>masterColors[(pixel===0&&layer==='background')?(v.data[0]&63):idx]);
  return {layer,group,indices,rgb:colors,hex:colors.map(rgbHex),transparentIndex0:layer==='sprite'};
 });
}
function paletteExportObject(){
 const v=activeVariant();
 return {schema:'nes-asset-palette-export-v1',game:rom.name,mapper:rom.mapper,variantName:v.name,origin:v.kind,
  sourceRomOffset:v.offset??null,verifiedRuntime:false,
  rawPaletteIndices:v.data?Array.from(v.data):null,
  rows:paletteRows(v),referenceMasterRGB:masterColors,
  selectedLayer:ui.paletteLayer.value,selectedSubPalette:Number(ui.paletteGroup.value),
  manualTileAssignments:Object.fromEntries(assignments),
  warning:'Palette candidates found in PRG are NOT verified gameplay palettes. Manual assignments are user-provided. RGB values approximate NES colors; actual colors may vary by PPU model, emphasis, and display.'};
}
function paletteSwatchesCanvas(){
 const v=activeVariant(),rows=paletteRows(v);
 if(!rows.length)throw Error('Select or import a 16/32-byte palette to export swatches.');
 const swatch=32,canvas=document.createElement('canvas');canvas.width=swatch*4;canvas.height=swatch*rows.length;
 const context=canvas.getContext('2d');
 for(let r=0;r<rows.length;r++)for(let c=0;c<4;c++){
  context.fillStyle=rgbHex(rows[r].rgb[c]);context.fillRect(c*swatch,r*swatch,swatch,swatch);
 }
 return canvas;
}
function paletteCSV(){
 const rows=paletteRows(activeVariant());
 const header=['layer','group','pixel_index','nes_color_index_hex','rgb_hex','is_transparent','origin','source_rom_offset'];
 const v=activeVariant(),lines=[header.join(',')];
 for(const row of rows)for(let i=0;i<4;i++)lines.push([
  row.layer,row.group,i,hex(row.indices[i]),row.hex[i],row.transparentIndex0&&i===0,v.kind,v.offset===null?'':`0x${hex(v.offset,6)}`
 ].join(','));
 return lines.join('\r\n')+'\r\n';
}
async function palettePackEntries(){
 const v=activeVariant(),entries=[],obj=paletteExportObject();
 entries.push({name:'palette_metadata.json',data:textEncoder.encode(JSON.stringify(obj,null,2))});
 entries.push({name:'palette_colors.csv',data:textEncoder.encode(paletteCSV())});
 entries.push({name:'master_palette_rgb_192b.pal',data:new Uint8Array(masterColors.flat())});
 if(v.data){
  entries.push({name:`nes_palette_indices_${v.data.length}b.pal`,data:v.data});
  const b=await pngBlob(paletteSwatchesCanvas());entries.push({name:'palette_swatch_reference.png',data:new Uint8Array(await b.arrayBuffer())});
 }
 return entries;
}
ui.paletteRaw.addEventListener('click',()=>{const v=activeVariant();if(v.data)download(new Blob([v.data],{type:'application/octet-stream'}),`${stem()}_${v.kind}_${v.data.length}b.pal`)});
ui.paletteSwatch.addEventListener('click',async()=>{try{download(await pngBlob(paletteSwatchesCanvas()),`${stem()}_palette_swatches.png`)}catch(e){message(e.message)}});
ui.paletteCsv.addEventListener('click',()=>{if(rom)download(new Blob([paletteCSV()],{type:'text/csv'}),`${stem()}_palette_colors.csv`)});
ui.palettePack.addEventListener('click',async()=>{if(!rom)return;ui.palettePack.disabled=true;try{
 const entries=await palettePackEntries();download(zipStore(entries),`${stem()}_palette_pack.zip`);
 message(`Exported palette pack: ${entries.map(e=>e.name).join(', ')}`);
 }catch(e){message('Palette export failed: '+e.message)}finally{ui.palettePack.disabled=false}});
ui.masterPal.addEventListener('click',()=>{if(rom)download(new Blob([new Uint8Array(masterColors.flat())],{type:'application/octet-stream'}),`${stem()}_master_rgb_192b.pal`)});

ui.files.addEventListener('change',()=>addFiles(ui.files.files));ui.game.addEventListener('change',selectGame);ui.source.addEventListener('change',updateSource);
for(const id of ['scope','cols','transparent','paletteVariant','paletteGroup','paletteLayer'])ui[id].addEventListener('change',render);
ui.bankSize.addEventListener('change',refreshBanks);ui.bank.addEventListener('change',render);
ui.preview.addEventListener('click',e=>{if(!rom||!view)return;const r=ui.preview.getBoundingClientRect();if(!r.width||!r.height)return;const x=Math.floor((e.clientX-r.left)*ui.preview.width/r.width/8),y=Math.floor((e.clientY-r.top)*ui.preview.height/r.height/8),index=y*view.columns+x;if(index<view.count){const tile=view.start+index;if(ui.paint.checked){assignments.set(`${sourceKind}:${tile}`,Number(ui.paletteGroup.value));render()}inspect(tile)}});
ui.png.addEventListener('click',async()=>{if(!rom)return;try{download(await pngBlob(paintImage(view.start,view.count,view.columns)),`${stem()}_${suffix()}.png`)}catch(e){message(e.message)}});
ui.json.addEventListener('click',()=>{if(rom)download(new Blob([JSON.stringify(makeMeta(view.start,view.count,view.columns),null,2)],{type:'application/json'}),`${stem()}_${suffix()}.json`)});
ui.raw.addEventListener('click',()=>{if(!rom)return;const b=sourceData.slice(view.start*16,(view.start+view.count)*16);download(new Blob([b]),`${stem()}_${suffix()}.${sourceKind==='chr'?'chr':'bin'}`)});
ui.exportPalette.addEventListener('click',()=>{if(!rom)return;const v=activeVariant(),obj={schema:'nes-palettes-v1',game:rom.name,mapper:rom.mapper,variantName:v.name,origin:v.kind,sourceOffset:v.offset,role:v.data?.length===32?'NES 8 sub-palettes; interpretation BG/Sprite':'role not verified',indices:v.data?Array.from(v.data):null,masterRGB:masterColors,assignments:Object.fromEntries(assignments),warning:'For ROM candidates, presence in ROM does not prove use or tile association. Manual tile assignments were chosen in the editor.'};download(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),`${stem()}_palettes.json`)});
ui.variants.addEventListener('click',async()=>{if(!rom)return;ui.variants.disabled=true;try{
 const entry=[],variant=activeVariant(),layer=ui.paletteLayer.value;
 for(let g=0;g<4;g++){const canvas=paintImage(view.start,view.count,view.columns,{group:g,assignments:false});entry.push({name:`${stem()}_${suffix()}_${layer}_palette${g}.png`,data:new Uint8Array(await (await pngBlob(canvas)).arrayBuffer())})}
 entry.push({name:'palettes.json',data:textEncoder.encode(JSON.stringify({schema:'nes-palette-variants-v1',game:rom.name,origin:variant.kind,variantName:variant.name,rawIndices:variant.data?Array.from(variant.data):null,sourceKind,layer,groups:[0,1,2,3],tileAssignmentsUsed:false,warning:'The four alternatives are palettes, not automatically verified sprite associations.'},null,2))});
 download(zipStore(entry),`${stem()}_${layer}_palette_variants.zip`);message('Four palette variants exported.');
 }catch(e){message(e.message)}finally{ui.variants.disabled=false}});
ui.pack.addEventListener('click',async()=>{if(!rom)return;ui.pack.disabled=true;try{
 const size=Number(ui.bankSize.value),columns=Number(ui.cols.value),bankCount=Math.ceil(sourceData.length/size),entries=[],index={schema:'nes-godot-bank-pack-v3',rom:rom.name,sourceKind,verifiedTileSource:sourceKind==='chr',mapper:rom.mapper,sourceBytes:sourceData.length,CRC32:hex(crc32(sourceData),8),bankBytes:size,columns,tilesPerBank:size/16,variant:activeVariant().name,layer:ui.paletteLayer.value,paletteGroup:Number(ui.paletteGroup.value),banks:[]};
 for(let bank=0;bank<bankCount;bank++){
  const first=bank*size/16,count=Math.min(size/16,sourceData.length/16-first),tag=`bank_${String(bank).padStart(3,'0')}`,png=`${tag}.png`,json=`${tag}.json`;
  const blob=await pngBlob(paintImage(first,count,columns)),meta=makeMeta(first,count,columns);
  entries.push({name:png,data:new Uint8Array(await blob.arrayBuffer())});entries.push({name:json,data:textEncoder.encode(JSON.stringify(meta))});index.banks.push({bank,firstTile:first,count,png,json});
  if(bank%8===0)message(`Exporting bank ${bank+1}/${bankCount}...`);
 }
 entries.push({name:`original_${sourceKind}.${sourceKind==='chr'?'chr':'bin'}`,data:sourceData});entries.push({name:'atlas_index.json',data:textEncoder.encode(JSON.stringify(index,null,2))});
 entries.push({name:'README.txt',data:textEncoder.encode('NES Godot 8x8 atlas export. PNGs are exactly 8x8 per tile, no padding. Use nearest filtering and Godot 8x8 texture regions.\nCHR-ROM extraction is exact, PRG raw 2bpp scanning is NOT a reconstruction of compressed CHR-RAM graphics.\nPalette candidates found inside PRG are unverified; per-tile assignments are user-defined.\n')});
 download(zipStore(entries),`${stem()}_${sourceKind}_${size}B_banks.zip`);message(`Exported ${bankCount} banks, ${entries.length} ZIP entries.`);
 }catch(e){message('Export error: '+e.message)}finally{ui.pack.disabled=false}});
ui.paletteFile.addEventListener('change',async()=>{if(!rom||!ui.paletteFile.files[0])return;try{
 const f=ui.paletteFile.files[0],b=new Uint8Array(await f.arrayBuffer());
 if(b.length===192){masterColors=Array.from({length:64},(_,i)=>Array.from(b.subarray(i*3,i*3+3)));message('Imported 192-byte NES RGB master palette.');updatePaletteUI();render();return}
 if(b.length!==16&&b.length!==32)throw Error('Expected 16 or 32 raw NES palette bytes, or a 192-byte 64×RGB master palette.');
 if(b.some(v=>v>63))throw Error('Palette index must be 0–63; this does not look like a raw NES PPU palette.');
 variants.push({id:'user'+variants.length,name:`Imported ${f.name} (${b.length}B)`,kind:'imported',data:b,offset:null});
 rebuildVariantSelect();ui.paletteVariant.value=String(variants.length-1);render();message(`Imported ${b.length} bytes of NES palette indices. Sprite/tile assignments still need attributes or manual selection.`);
 }catch(e){message(e.message)}ui.paletteFile.value=''});
const drop=$('drop');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over')});drop.addEventListener('dragleave',()=>drop.classList.remove('over'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');addFiles(e.dataTransfer.files)});


let spriteCRCSource=null,spriteCRCValue='';
window.NES_ASSET_API={
 getContext:()=>{
  if(!rom||!sourceData)return null;
  if(spriteCRCSource!==sourceData){spriteCRCSource=sourceData;spriteCRCValue=hex(crc32(sourceData),8)}
  return {name:rom.name,mapper:rom.mapper,sourceKind,sourceData,sourceBase,view:getView(),assignments:new Map(assignments),paletteLayer:ui.paletteLayer.value,transparent:ui.transparent.checked,crc32:spriteCRCValue,paletteGroup:Number(ui.paletteGroup.value),variant:activeVariant(),masterColors,tileCanvas:(tile,group)=>paintImage(tile,1,1,{group,layer:'sprite',transparent:true,assignments:false}),zipStore,pngBlob,download};
 },
 tileCanvas:(tile,group)=>paintImage(tile,1,1,{group,layer:'sprite',transparent:true,assignments:false}),
 inspectTile:inspect,
 zipStore,pngBlob,download,
 setMasterColors:(rgb)=>{masterColors=rgb;render()},
 importPalette:(data,name)=>{variants.push({id:'project'+variants.length,name,kind:'project',data:new Uint8Array(data),offset:null});rebuildVariantSelect();ui.paletteVariant.value=String(variants.length-1);render()},
 selectPreview:()=>{ui.paletteVariant.value='0';render()}
};
