export function standaloneInstances(entries){
  return entries.map((entry,index)=>({id:`asset-${entry.id}`,gameObject:null,name:entry.name,active:index===0,skeletonId:entry.id,animation:['animation','idle','Idle','stand','moren','normal'].find(name=>entry.animations.some(animation=>animation.name===name))||entry.animations[0]?.name||'',skin:entry.skins.includes('default')?'default':entry.skins[0]||'',loop:true,timeScale:1,flipX:false,flipY:false,sortingOrder:index,transform:null,status:entry.status}));
}

export function completeSkeletonInstances(instances,entries){
  const unassignedInstances=instances.filter(instance=>instance.status==='unassigned');
  const bound=instances.filter(instance=>instance.status!=='unassigned');
  const referenced=new Set(bound.map(instance=>instance.skeletonId));
  const extra=standaloneInstances(entries.filter(entry=>!referenced.has(entry.id)));
  if(bound.length)for(const instance of extra)instance.active=false;
  return {instances:[...bound,...extra],unassignedInstances};
}

export function materialOrdering(renderer){
  if(!renderer)return {};
  const materials=renderer.materials,queues=[...new Set(materials.map(material=>material.renderQueue))];
  const status=renderer.errors.length?'missing-material':!materials.length||queues.some(queue=>!Number.isInteger(queue))?'unresolved':queues.length>1?'mixed-queues':undefined;
  return {...(status?{renderOrderStatus:status}:{renderQueue:queues[0]}),...(materials.length?{renderMaterials:materials}:{})};
}

export function skeletonDisplaySettings(renderType,data,canvasPixelsPerUnit=100){
  if(renderType==='SkeletonGraphic'&&(!Number.isFinite(canvasPixelsPerUnit)||canvasPixelsPerUnit<=0))throw new Error('Invalid Canvas reference pixels per unit');
  return {renderType,...(renderType==='SkeletonGraphic'?{canvasPixelsPerUnit}:{}),animation:data.startingAnimation??data._animationName,loop:Boolean(data.startingLoop??data.loop)};
}
