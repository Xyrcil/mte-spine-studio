import {objectTransform,multiply,inversePoint} from './geometry.js';

export const backgroundOwner=(object,objects)=>object.parentId===undefined?null:objects.find(row=>row.id===object.parentId);
export function validateBackgroundLinks(objects){
  for(const object of objects)if(object.parentId!==undefined){const owner=backgroundOwner(object,objects);if(object.kind!=='image'||object.asset||!owner||owner===object||owner.parentId!==undefined||!(owner.kind==='spine'||owner.kind==='image'&&owner.asset))throw new Error('Invalid character background owner');}
}
export function objectVisible(object,objects){const owner=backgroundOwner(object,objects);return object.visible!==false&&(object.parentId===undefined||Boolean(owner&&owner.visible!==false));}
export function backgroundMatrix(object,objects){const owner=backgroundOwner(object,objects);return owner?multiply(objectTransform(owner),objectTransform(object)):objectTransform(object);}
export function backgroundOpacity(object,objects){return (object.opacity??1)*(backgroundOwner(object,objects)?.opacity??1);}
export function matrixPose(matrix){const scale=Math.hypot(matrix[0],matrix[1]),det=matrix[0]*matrix[3]-matrix[1]*matrix[2];if(!Number.isFinite(scale)||scale<=0||!matrix.every(Number.isFinite))throw new Error('Invalid background transform');return {x:matrix[4],y:matrix[5],scale,rotation:Math.atan2(matrix[1],matrix[0])*180/Math.PI,flipX:false,flipY:det<0};}
export function setBackgroundParent(object,parentId,objects){
  const candidate={...object};if(parentId===undefined)delete candidate.parentId;else candidate.parentId=parentId;
  validateBackgroundLinks(objects.map(row=>row===object?candidate:row));const world=backgroundMatrix(object,objects),opacity=backgroundOpacity(object,objects),visible=objectVisible(object,objects),owner=backgroundOwner(candidate,objects);let local=world;
  if(owner){const parent=objectTransform(owner),origin=inversePoint(parent,0,0),x=inversePoint(parent,1,0),y=inversePoint(parent,0,1);if(!origin||!x||!y)throw new Error('Character transform cannot be inverted');local=multiply([x.x-origin.x,x.y-origin.y,y.x-origin.x,y.y-origin.y,origin.x,origin.y],world);}
  Object.assign(object,matrixPose(local));if(parentId===undefined){delete object.parentId;object.opacity=opacity;object.visible=visible;}else object.parentId=parentId;
}
export function objectDragDelta(object,objects,x,y){const owner=backgroundOwner(object,objects);if(!owner)return {x,y};const matrix=objectTransform(owner);return inversePoint(matrix,matrix[4]+x,matrix[5]+y);}
export function sceneDrawOrder(objects){return objects.filter(object=>object.parentId===undefined).flatMap(object=>[...objects.filter(child=>child.parentId===object.id),object]);}
export function moveSceneLayer(objects,object,direction){const siblings=objects.filter(row=>row.parentId===object.parentId),index=siblings.indexOf(object),other=siblings[index+direction];if(!other)return;const a=objects.indexOf(object),b=objects.indexOf(other);[objects[a],objects[b]]=[objects[b],objects[a]];}
export function duplicateSceneObject(scene,id,makeId=()=>crypto.randomUUID()){
  const result=structuredClone(scene),original=result.objects.find(row=>row.id===id);if(!original)throw new Error('Object is unavailable');
  const sources=[original,...result.objects.filter(row=>row.parentId===id)],ids=new Map(sources.map(row=>[row.id,makeId()])),copies=sources.map(row=>{const copy=structuredClone(row);copy.id=ids.get(row.id);copy.name+=' copy';if(row===original)copy.x+=1;else copy.parentId=ids.get(row.parentId);return copy;});result.objects.push(...copies);
  if(result.audio){result.audio.ambientTracks.push(...result.audio.ambientTracks.filter(track=>ids.has(track.id)).map(track=>({...track,id:ids.get(track.id)})));if(result.audio.effectTracks)result.audio.effectTracks=[...result.audio.effectTracks,...result.audio.effectTracks.filter(track=>ids.has(track.group)).map(track=>({...track,group:ids.get(track.group)}))].slice(-12);}
  return {scene:result,copy:copies[0]};
}
