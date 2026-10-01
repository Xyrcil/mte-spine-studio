const finite=(value,label)=>{if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`Invalid ${label}`);return value;};
const text=(value,label)=>{if(typeof value!=='string'||value.length>512)throw new Error(`Invalid ${label}`);return value;};
export function validateScene(value) {
  if(!value||value.schema!==1||!Array.isArray(value.objects)||value.objects.length>200)throw new Error('Unsupported scene format');
  const camera={};for(const key of ['x','y','width','height'])camera[key]=finite(value.camera?.[key],`camera ${key}`);
  if(camera.width<=0||camera.height<=0)throw new Error('Camera dimensions must be positive');
  if(!/^#[0-9a-f]{6}$/i.test(value.background))throw new Error('Invalid background color');
  const seen=new Set();
  const objects=value.objects.map(object=>{
    const id=text(object.id,'object ID');if(seen.has(id))throw new Error('Duplicate object ID');seen.add(id);
    if(!['spine','image'].includes(object.kind))throw new Error('Unsupported object type');
    const result={id,kind:object.kind,name:text(object.name||'','object name'),x:finite(object.x,'x'),y:finite(object.y,'y'),scale:finite(object.scale,'scale'),rotation:finite(object.rotation,'rotation'),opacity:finite(object.opacity,'opacity'),flipX:Boolean(object.flipX),flipY:Boolean(object.flipY),visible:object.visible!==false,locked:Boolean(object.locked)};
    if(result.scale<=0||result.opacity<0||result.opacity>1)throw new Error('Invalid object scale or opacity');
    if(object.kind==='spine') {
      result.bundle=text(object.bundle,'bundle');
      if(!object.layers||!Array.isArray(object.layers))throw new Error('Missing animation state');
      const layerIds=new Set();
      result.layers=object.layers.map(layer=>{
        if(layerIds.has(layer.id))throw new Error('Duplicate layer ID');layerIds.add(layer.id);
        if(!Array.isArray(layer.tracks)||layer.tracks.length>32)throw new Error('Invalid animation tracks');
        const trackIds=new Set();
        return {id:text(layer.id,'layer ID'),active:layer.active!==false,tracks:layer.tracks.map(track=>{
          const index=finite(track.index,'track index');if(index<0||index>31||!Number.isInteger(index)||trackIds.has(index))throw new Error('Invalid track index');trackIds.add(index);
          const time=finite(track.time,'animation time');if(time<0)throw new Error('Animation time must be positive');
          return {index,name:text(track.name,'animation name'),time,loop:Boolean(track.loop),timeScale:finite(track.timeScale,'track speed')};
        })};
      });
    } else {
      if(typeof object.src!=='string'||!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(object.src))throw new Error('Image scenes require an embedded raster image');
      result.src=object.src;result.width=finite(object.width,'image width');result.height=finite(object.height,'image height');
      if(result.width<=0||result.height<=0)throw new Error('Invalid image dimensions');
    }
    return result;
  });
  const speed=finite(value.speed,'playback speed');if(speed<=0)throw new Error('Playback speed must be positive');
  return {schema:1,name:text(value.name||'Untitled scene','scene name'),background:value.background,camera,speed,paused:Boolean(value.paused),objects};
}

export class History {
  constructor(limit=50){this.limit=limit;this.past=[];this.future=[];}
  push(scene){const copy=structuredClone(scene);if(JSON.stringify(this.past.at(-1))===JSON.stringify(copy))return;this.past.push(copy);if(this.past.length>this.limit)this.past.shift();this.future=[];}
  undo(current){if(!this.past.length)return null;this.future.push(structuredClone(current));return this.past.pop();}
  redo(current){if(!this.future.length)return null;this.past.push(structuredClone(current));return this.future.pop();}
}

let dbPromise;
function database(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const request=indexedDB.open('mte-spine-scenes',1);request.onupgradeneeded=()=>request.result.createObjectStore('scenes');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});return dbPromise;}
export async function saveLocalScene(scene,key='autosave'){
  const checked=validateScene(scene),db=await database();
  return new Promise((resolve,reject)=>{const tx=db.transaction('scenes','readwrite');tx.objectStore('scenes').put(checked,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Scene save aborted'));});
}
export async function loadLocalScene(key='autosave'){
  const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction('scenes').objectStore('scenes').get(key);request.onsuccess=()=>{try{resolve(request.result?validateScene(request.result):null);}catch(error){reject(error);}};request.onerror=()=>reject(request.error);});
}
export async function listLocalScenes(){const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction('scenes').objectStore('scenes').getAllKeys();request.onsuccess=()=>resolve(request.result.filter(key=>key!=='autosave'));request.onerror=()=>reject(request.error);});}
export async function deleteLocalScene(key){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('scenes','readwrite');tx.objectStore('scenes').delete(key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
