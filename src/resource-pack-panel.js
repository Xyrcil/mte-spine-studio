import {resourceFiles,validatePackCatalogues,resourceType,packUrl} from './engine/resource-pack.js';
import {stageResourceZip} from './engine/resource-zip.js';
export function createResourcePackPanel(cache,editor,message,stage){
  const panel=document.createElement('section');panel.id='resource-pack-panel';panel.className='scene-controls';panel.innerHTML='<h2>Local resource pack</h2><p>Import your converted assets folder. Files stay in this browser and are not uploaded. A successful import replaces the previously imported pack, not the original files. Keep your source folder as a backup.</p><div class="actions"><button id="pack-choose">Import assets folder</button><button id="pack-cancel" disabled>Cancel import</button><button id="pack-remove">Remove imported pack</button></div><input id="pack-folder" type="file" webkitdirectory multiple hidden><progress id="pack-progress" max="1" value="0"></progress><p id="pack-status" role="status"></p><button id="pack-reload" hidden>Reload with imported resources</button>';
  panel.style.display='none';document.querySelector('.inspector').append(panel);
  const zipButton=document.createElement('button');zipButton.id='pack-zip';zipButton.textContent='Import resource ZIP';panel.querySelector('.actions').prepend(zipButton);const zipInput=document.createElement('input');zipInput.id='pack-zip-file';zipInput.type='file';zipInput.accept='.zip,application/zip';zipInput.hidden=true;panel.append(zipInput);
  const field=id=>panel.querySelector('#pack-'+id);let busy=false,controller;
  const status=text=>field('status').textContent=text;
  const requireReload=()=>{stage.packReloadRequired=true;stage.paused=true;stage.dispatchEvent(new CustomEvent('resource-import-start'));stage.dispatchEvent(new CustomEvent('scene-change'));field('reload').hidden=false;field('choose').disabled=field('remove').disabled=true;};
  navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='PACK_CHANGED'){requireReload();status('Local resource pack changed. Reload to use the new resource catalogue.');}});
  async function refresh(){const value=await cache.request('PACK_STATUS');status(value?`${value.files} imported files · ${(value.bytes/1048576).toFixed(1)} MiB`:'No imported pack. Online assets are used when available.');return value;}
  async function importFiles(files,archive=false){
    if(busy||editor.busy)throw new Error('Finish scene editing, loading or recording before importing resources');
    busy=true;controller=new AbortController();field('cancel').disabled=false;field('choose').disabled=zipButton.disabled=true;field('remove').disabled=true;field('reload').hidden=true;
    field('progress').max=1;field('progress').value=0;status(archive?'Reading resource archive…':'Checking resource catalogues…');
    const wasPaused=stage.paused;stage.resourceImportBusy=true;stage.paused=true;stage.dispatchEvent(new CustomEvent('resource-import-start'));stage.dispatchEvent(new CustomEvent('scene-change'));
    const base=new URL(import.meta.env.BASE_URL,location.origin).href;let committed=false,name,commitAttempted=false;
    try{
      if(!await cache.ready)throw new Error('Local pack import requires the production build and browser storage');let pack;
      const estimate=await navigator.storage?.estimate?.(),budget=estimate?.quota?(estimate.quota-(estimate.usage||0))/1.05:Infinity;
      if(!archive){pack=resourceFiles(files);await validatePackCatalogues(pack.rows);if(pack.bytes>budget)throw new Error('Not enough browser storage for this import; the previous pack is retained');}
      if(controller.signal.aborted)throw new DOMException('Resource import cancelled','AbortError');
      name=`mte-studio:${new URL(base).pathname}:pack:${crypto.randomUUID()}`;
      const target=await caches.open(name);
      if(archive){pack=await stageResourceZip(files,target,base,{signal:controller.signal,budget,onProgress:info=>{field('progress').max=info.total;field('progress').value=info.readBytes;status(`Importing ${info.files} files · ${(info.bytes/1048576).toFixed(1)} MiB`);}});await validatePackCatalogues(pack.rows);}
      else{field('progress').max=pack.rows.length;for(let index=0;index<pack.rows.length;index++){if(controller.signal.aborted)throw new DOMException('Resource import cancelled','AbortError');const {path,file}=pack.rows[index];await target.put(packUrl(path,base),new Response(file,{headers:{'content-type':resourceType(path),'content-length':String(file.size)}}));field('progress').value=index+1;status(`Importing ${index+1} / ${pack.rows.length} files`);if(index%20===0)await new Promise(resolve=>setTimeout(resolve,0));}}
      if(controller.signal.aborted)throw new DOMException('Resource import cancelled','AbortError');field('cancel').disabled=true;status('Activating resource pack…');commitAttempted=true;await cache.request('PACK_COMMIT',{name,files:pack.rows.length,bytes:pack.bytes,manifest:pack.rows.map(row=>({path:row.path,size:row.file.size}))},info=>status(`Checking imported files ${info.done} / ${info.total}`));committed=true;
      requireReload();status(`Imported ${pack.rows.length} files${pack.excluded?` · ${pack.excluded} unsupported files excluded`:''}. Reload to use this pack.`);message('Local resource pack imported. Reload to use it.');return {files:pack.rows.length,bytes:pack.bytes,excluded:pack.excluded};
    }finally{if(name&&!committed){if(commitAttempted)try{committed=(await cache.request('PACK_STATUS'))?.name===name;}catch{committed=true;}if(!committed)await caches.delete(name).catch(()=>status('The incomplete browser copy could not be removed'));}busy=false;controller=null;stage.resourceImportBusy=false;if(committed)requireReload();else if(!stage.packReloadRequired){stage.paused=wasPaused;stage.dispatchEvent(new CustomEvent('resource-import-ended'));}stage.dispatchEvent(new CustomEvent('scene-change'));field('cancel').disabled=true;field('choose').disabled=field('remove').disabled=zipButton.disabled=Boolean(stage.packReloadRequired);}
  }
  field('choose').onclick=()=>field('folder').click();field('folder').onchange=()=>{importFiles(field('folder').files).catch(error=>{status(error.name==='AbortError'?'Import cancelled; the previous pack is retained':error.message);message(field('status').textContent);}).finally(()=>field('folder').value='');};
  field('cancel').onclick=()=>controller?.abort();field('reload').onclick=()=>location.reload();
  zipButton.onclick=()=>zipInput.click();zipInput.onchange=()=>{const file=zipInput.files[0];if(file)importFiles(file,true).catch(error=>{status(error.name==='AbortError'?'Import cancelled; the previous pack is retained':error.message);message(field('status').textContent);}).finally(()=>zipInput.value='');};
  field('remove').onclick=async()=>{if(busy||editor.busy)return;try{await cache.request('PACK_REMOVE');requireReload();status('Imported browser copy removed. Original files and saved scenes are unchanged.');message(field('status').textContent);}catch(error){status(error.message);}};
  cache.ready.then(ready=>{panel.style.display='';if(ready)refresh().catch(error=>status(error.message));else{status('Import is available in the production build on HTTPS or localhost.');field('choose').disabled=field('remove').disabled=zipButton.disabled=true;}});
  return {importFiles,importZip:file=>importFiles(file,true),refresh,get busy(){return busy;}};
}
