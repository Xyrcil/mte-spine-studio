export function standaloneInstances(entries){
  return entries.map((entry,index)=>({id:`asset-${entry.id}`,gameObject:null,name:entry.name,active:index===0,skeletonId:entry.id,animation:['animation','idle','Idle','stand','moren','normal'].find(name=>entry.animations.some(animation=>animation.name===name))||entry.animations[0]?.name||'',skin:entry.skins.includes('default')?'default':entry.skins[0]||'',loop:true,timeScale:1,flipX:false,flipY:false,sortingOrder:index,transform:null,status:entry.status}));
}

export function materialOrdering(renderer){
  if(!renderer)return {};
  const materials=renderer.materials,queues=[...new Set(materials.map(material=>material.renderQueue))];
  const status=renderer.errors.length?'missing-material':!materials.length||queues.some(queue=>!Number.isInteger(queue))?'unresolved':queues.length>1?'mixed-queues':undefined;
  return {...(status?{renderOrderStatus:status}:{renderQueue:queues[0]}),...(materials.length?{renderMaterials:materials}:{})};
}
