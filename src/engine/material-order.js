const modes=['normal','additive','multiply','screen'];

export function compileMaterialMapping(layer){
  if(layer.instance.renderOrderStatus!=='mixed-queues')return null;
  const source=layer.entry.materialBindings;
  if(!source?.pages.length||source.errors.length)return {reason:'Skeleton material bindings are unavailable'};
  const pages=new Map(source.pages.filter(page=>page.atlas===0).map(page=>[page.page,page.materials])),queues=new Map();
  for(const materials of pages.values())for(const material of Object.values(materials)){if(!Number.isInteger(material.renderQueue)||material.renderQueue<0)return {reason:'Skeleton material queue is unavailable'};queues.set(material.id,material.renderQueue);}
  for(const material of layer.instance.renderMaterials)if(queues.get(material.id)!==material.renderQueue)return {reason:'Renderer and skeleton materials do not match'};
  return {pages};
}

export function skeletonDrawSegments(layer){
  const mapping=layer.materialMapping;
  if(!mapping||mapping.reason)return [{queue:layer.instance.renderQueue}];
  const segments=[];
  for(const slot of layer.skeleton.drawOrder){
    if(!slot.bone.active)continue;
    const attachment=slot.getAttachment(),page=attachment?.region?.page?.name;
    if(!page)continue;
    const materials=mapping.pages.get(page),mode=modes[slot.data.blendMode];
    if(!materials||!mode)throw new Error('Animated attachment material is unavailable');
    const material=materials[mode]||materials.normal;
    if(!material)throw new Error('Animated attachment material is unavailable');
    const previous=segments.at(-1);if(previous?.material===material.id)previous.slots.push(slot.data.index);else segments.push({material:material.id,queue:material.renderQueue,slots:[slot.data.index]});
  }
  return segments;
}

export function drawSkeletonSlots(renderer,skeleton,slots){
  const target=renderer.skeletonRenderer,previous=target.slotFilter,selected=new Set(slots);
  target.slotFilter=slot=>selected.has(slot.data.index);
  try{renderer.drawSkeleton(skeleton,false);}finally{target.slotFilter=previous;}
}
