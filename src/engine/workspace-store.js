import {validateScene} from './scene.js';

const DATABASE='mte-scene-workspace',VERSION=1;
let opening;

function database(){
  if(!opening){
    const request=indexedDB.open(DATABASE,VERSION);
    const pending=new Promise((resolve,reject)=>{
      request.onupgradeneeded=()=>{for(const name of ['scenes','sceneMetadata','drafts','draftMetadata','preferences'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});};
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();if(opening===pending)opening=undefined;};db.onclose=()=>{if(opening===pending)opening=undefined;};resolve(db);};
      request.onerror=()=>reject(request.error||new Error('Scene storage could not be opened'));
      request.onblocked=()=>reject(new Error('Scene storage is open in another tab'));
    }).catch(error=>{if(opening===pending)opening=undefined;throw error;});
    opening=pending;
  }
  return opening;
}

async function transact(names,mode,action){
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(names,mode),stores=Object.fromEntries(names.map(name=>[name,tx.objectStore(name)]));let request;
    try{request=action(stores);}catch(error){tx.abort();reject(error);return;}
    tx.oncomplete=()=>resolve(request?.result);
    tx.onerror=()=>reject(tx.error||new Error('Scene storage transaction failed'));
    tx.onabort=()=>reject(tx.error||new Error('Scene storage transaction was cancelled'));
  });
}

const idCheck=id=>{if(typeof id!=='string'||!id||id.length>512)throw new Error('Invalid scene ID');return id;};
const read=(store,id)=>transact([store],'readonly',s=>s[store].get(idCheck(id)));
const list=store=>transact([store],'readonly',s=>s[store].getAll());

export async function saveWorkspaceScene(id,scene,{thumbnail='',legacyKey}={}){
  id=idCheck(id);scene=validateScene(scene);
  if(typeof thumbnail!=='string'||thumbnail.length>500000||thumbnail&&!/^data:image\/(jpeg|png|webp);base64,/.test(thumbnail))throw new Error('Invalid scene thumbnail');
  const metadata={id,name:scene.name,updated:Date.now(),thumbnail,artworkCount:scene.objects.filter(object=>object.kind==='spine'||object.asset).length,backgroundCount:scene.objects.filter(object=>object.kind==='image'&&!object.asset).length,...(legacyKey?{legacyKey}: {})};
  await transact(['scenes','sceneMetadata'],'readwrite',s=>{s.scenes.put({id,scene});s.sceneMetadata.put(metadata);});
  return metadata;
}
export async function loadWorkspaceScene(id){return (await read('scenes',id))?.scene||null;}
export async function listWorkspaceScenes(){return (await list('sceneMetadata')).sort((a,b)=>b.updated-a.updated);}
export async function deleteWorkspaceScene(id){id=idCheck(id);return transact(['scenes','sceneMetadata'],'readwrite',s=>{s.scenes.delete(id);s.sceneMetadata.delete(id);});}
export async function saveWorkspaceDraft(id,scene,{baseId=null,legacyKey=null}={}){
  id=idCheck(id);scene=validateScene(scene);
  const metadata={id,name:scene.name,updated:Date.now(),baseId,legacyKey,artworkCount:scene.objects.filter(object=>object.kind==='spine'||object.asset).length,backgroundCount:scene.objects.filter(object=>object.kind==='image'&&!object.asset).length};
  await transact(['drafts','draftMetadata'],'readwrite',s=>{s.drafts.put({id,scene});s.draftMetadata.put(metadata);});
  return metadata;
}
export async function loadWorkspaceDraft(id){return (await read('drafts',id))?.scene||null;}
export async function listWorkspaceDrafts(){return (await list('draftMetadata')).sort((a,b)=>b.updated-a.updated);}
export async function deleteWorkspaceDraft(id){id=idCheck(id);return transact(['drafts','draftMetadata'],'readwrite',s=>{s.drafts.delete(id);s.draftMetadata.delete(id);});}
export async function savePreview(scene){scene=validateScene(scene);return transact(['preferences'],'readwrite',s=>s.preferences.put({id:'preview',scene}));}
export async function loadPreview(){return (await read('preferences','preview'))?.scene||null;}
