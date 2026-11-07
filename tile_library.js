'use strict';
// User-authored tile metadata. Never infer sprite identity from ROM graphics.
(() => {
 const $=id=>document.getElementById(id);
 const ids=['tagSelected','tagLabel','tagTags','tagNotes','tagSave','tagClear','tagCollection','tagCollectionName','tagCreate','tagDelete','tagToggle','tagFind','tagGodot','tagExport','tagStatus'];
 const ui=Object.fromEntries(ids.map(id=>[id,$(id)]));
 if(Object.values(ui).some(v=>!v))return;
 let notes=new Map(),collections=[],selectedName=null,tile=null,kind=null;
 const api=()=>window.NES_ASSET_API;
 const context=()=>api()?.getContext()||null;
 const key=(source,index)=>`${source}:${index}`;
 const empty=()=>({schema:'nes-tile-library-v1',annotations:{},collections:[],selectedCollection:null});
 const notify=()=>window.dispatchEvent(new Event('nes:annotations'));
 const checkString=(value,max,name)=>{if(typeof value!=='string'||value.length>max)throw Error(`Invalid ${name}.`);return value};
 function validKey(value){
  const m=/^(chr|prg):(0|[1-9][0-9]*)$/.exec(value);
  const data=m&&api()?.getSourceValidationContext(m[1])?.sourceData;
  if(!m||!data||!Number.isSafeInteger(Number(m[2]))||Number(m[2])>=Math.floor(data.length/16))
   throw Error('Invalid tile reference.');
  return value;
 }
 function validate(payload){
  if(!payload||payload.schema!=='nes-tile-library-v1'||!payload.annotations||
   typeof payload.annotations!=='object'||Array.isArray(payload.annotations)||
   !Array.isArray(payload.collections)||payload.collections.length>64)
   throw Error('Invalid tile library structure.');
  const annotationKeys=Object.keys(payload.annotations);
  if(annotationKeys.length>40000)throw Error('Too many tile annotations.');
  const nextNotes=new Map();
  for(const k of annotationKeys){
   validKey(k);const a=payload.annotations[k];
   if(!a||typeof a!=='object'||Array.isArray(a))throw Error('Invalid tile annotation.');
   const label=checkString(a.label,64,'tile label');
   const description=checkString(a.notes,500,'tile notes');
   if(!Array.isArray(a.tags)||a.tags.length>12)throw Error('Invalid tile tags.');
   const tags=a.tags.map(t=>checkString(t,32,'tile tag').trim()).filter(Boolean);
   if(new Set(tags.map(t=>t.toLowerCase())).size!==tags.length)throw Error('Repeated tile tag.');
   nextNotes.set(k,{label,notes:description,tags});
  }
  let total=0;const nextCollections=[],names=new Set();
  for(const entry of payload.collections){
   if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('Invalid collection.');
   const name=checkString(entry.name,64,'collection name').trim();
   if(!name||names.has(name.toLowerCase()))throw Error('Repeated or empty collection name.');
   names.add(name.toLowerCase());
   if(!Array.isArray(entry.tiles)||entry.tiles.length>40000)throw Error('Invalid collection tiles.');
   const tiles=entry.tiles.map(validKey);
   if(new Set(tiles).size!==tiles.length)throw Error('Repeated tile in collection.');
   total+=tiles.length;if(total>100000)throw Error('Too many collection memberships.');
   nextCollections.push({name,tiles:new Set(tiles)});
  }
  if(payload.selectedCollection!==null&&
    (typeof payload.selectedCollection!=='string'||!names.has(payload.selectedCollection.toLowerCase())))
   throw Error('Invalid selected collection.');
  return {notes:nextNotes,collections:nextCollections,selectedName:payload.selectedCollection};
 }
 function snapshot(){return {schema:'nes-tile-library-v1',annotations:Object.fromEntries(notes),
  collections:collections.map(c=>({name:c.name,tiles:[...c.tiles].sort()})),selectedCollection:selectedName};}
 function restore(payload){const next=validate(payload);
  notes=next.notes;collections=next.collections;selectedName=next.selectedName;
  tile=null;kind=null;refresh();notify();}
 function reset(){notes=new Map();collections=[];selectedName=null;tile=null;kind=null;refresh();notify();}
 const current=()=>collections.find(c=>c.name===selectedName)||null;
 function refresh(){
  const c=context();
  ui.tagCollection.replaceChildren();
  for(const collection of collections){const option=document.createElement('option');option.value=collection.name;
   const count=[...collection.tiles].filter(k=>k.startsWith(`${c?.sourceKind}:`)).length;
   option.textContent=`${collection.name} (${count} in current source)`;ui.tagCollection.append(option)}
  if(selectedName&&!collections.some(c=>c.name===selectedName))selectedName=null;
  if(!selectedName&&collections.length)selectedName=collections[0].name;
  ui.tagCollection.value=selectedName||'';
  const active=Boolean(c)&&tile!==null&&kind===c.sourceKind;
  ui.tagSelected.textContent=active?`${kind.toUpperCase()} tile #${tile}`:'Select a tile in the atlas or catalog';
  for(const id of ['tagSave','tagClear'])ui[id].disabled=!active;
  ui.tagToggle.disabled=!active||!current();
  for(const id of ['tagCreate','tagExport'])ui[id].disabled=!c;
  for(const id of ['tagDelete','tagFind','tagGodot'])ui[id].disabled=!c||!current();
  ui.tagToggle.textContent=active&&current()?.tiles.has(key(kind,tile))?'Remove tile from collection':'Add tile to collection';
  const annotation=active?notes.get(key(kind,tile)):null;
  ui.tagLabel.value=annotation?.label||'';ui.tagTags.value=annotation?.tags.join(', ')||'';
  ui.tagNotes.value=annotation?.notes||'';
  ui.tagStatus.textContent=`${notes.size} annotated tile(s); ${collections.length} collection(s). All labels are user-authored.`;
 }
 function select(index){const c=context();if(!c||!Number.isInteger(index)||index<0||index>=Math.floor(c.sourceData.length/16))return;
  tile=index;kind=c.sourceKind;refresh()}
 function matches(source,index,mode,value){
  const k=key(source,index),term=value.toLowerCase();
  if(mode==='collection')return collections.some(c=>c.name.toLowerCase()===term&&c.tiles.has(k));
  const a=notes.get(k);
  if(mode==='tag')return Boolean(a?.tags.some(t=>t.toLowerCase().includes(term)));
  if(mode==='label')return Boolean(a?.label.toLowerCase().includes(term));
  return false;
 }
 const annotationFor=(source,index)=>{const a=notes.get(key(source,index));return a?{label:a.label,tags:[...a.tags],notes:a.notes}:null};
 const collectionNames=(source,index)=>collections.filter(c=>c.tiles.has(key(source,index))).map(c=>c.name);
 ui.tagSave.addEventListener('click',()=>{const c=context();if(!c||tile===null||kind!==c.sourceKind)return;
  try{const label=ui.tagLabel.value.trim(),description=ui.tagNotes.value.trim();
   const tags=[...new Set(ui.tagTags.value.split(',').map(t=>t.trim().toLowerCase()).filter(Boolean))];
   if(label.length>64||description.length>500||tags.length>12||tags.some(t=>t.length>32))
    throw Error('Tile label, tags, or notes exceed the allowed limit.');
   const k=key(kind,tile);
   if(label||description||tags.length)notes.set(k,{label,notes:description,tags});else notes.delete(k);
   refresh();notify();ui.tagStatus.textContent=`Saved annotation for tile #${tile}.`;
  }catch(e){ui.tagStatus.textContent=e.message}});
 ui.tagClear.addEventListener('click',()=>{if(tile===null)return;
  notes.delete(key(kind,tile));refresh();notify()});
 ui.tagCreate.addEventListener('click',()=>{const name=ui.tagCollectionName.value.trim();
  if(!name||name.length>64){ui.tagStatus.textContent='Collection name must be 1–64 characters.';return}
  if(collections.length>=64||collections.some(c=>c.name.toLowerCase()===name.toLowerCase())){
   ui.tagStatus.textContent='Collection already exists or maximum collections reached.';return}
  collections.push({name,tiles:new Set()});selectedName=name;ui.tagCollectionName.value='';refresh();notify()});
 ui.tagCollection.addEventListener('change',()=>{selectedName=ui.tagCollection.value;refresh()});
 ui.tagDelete.addEventListener('click',()=>{if(!current())return;
  collections=collections.filter(c=>c.name!==selectedName);selectedName=collections[0]?.name||null;refresh();notify()});
 ui.tagToggle.addEventListener('click',()=>{const c=context(),collection=current();
  if(!c||!collection||tile===null||kind!==c.sourceKind)return;
  const k=key(kind,tile);if(collection.tiles.has(k))collection.tiles.delete(k);else collection.tiles.add(k);
  refresh();notify()});
 function showCollection(exportGodot){const c=context(),collection=current();if(!c||!collection)return;
  $('tileSearch').value=`collection:${collection.name}`;$('tileFind').click();
  if(exportGodot){if(!$('tileSetExport').disabled)$('tileSetExport').click();
   else ui.tagStatus.textContent='No tiles from the current source are in this collection.'}
 }
 ui.tagFind.addEventListener('click',()=>showCollection(false));
 ui.tagGodot.addEventListener('click',()=>showCollection(true));
 ui.tagExport.addEventListener('click',()=>{const c=context();if(!c)return;
  const name=c.name.replace(/\.nes$/i,'').replace(/[^a-z0-9_-]/gi,'_').slice(0,70);
  const result={rom:api().getROMIdentity(),tileLibrary:snapshot(),
   warning:'All labels, collections, and palette relationships are user annotations. No ROM bytes are included.'};
  api().download(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),
   `${name}_${c.crc32.toLowerCase()}_tile_library.json`);
 });
 window.addEventListener('nes:tile',event=>select(event.detail.tile));
 window.addEventListener('nes:game',reset);
 window.addEventListener('nes:workspace',()=>{tile=null;kind=null;refresh()});
 window.NES_TILE_LIBRARY={snapshot,validate,restore,empty,matches,annotationFor,collectionNames};
 refresh();
})();