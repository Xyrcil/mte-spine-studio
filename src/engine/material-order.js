const modes=['normal','additive','multiply','screen'];
const tintShaders=new Set(['Spine/Blend Modes/Skeleton PMA Additive','Spine/Blend Modes/Skeleton PMA Multiply','Spine/Blend Modes/Skeleton PMA Screen']);

export function materialTint(material){
  const values=material.properties?.m_Colors,colors=Array.isArray(values)?Object.fromEntries(values):values,color=colors?._Color;
  if(!color)return;
  if(!['r','g','b','a'].every(key=>Number.isFinite(color[key])&&color[key]>=0&&color[key]<=65504)||color.a>1)throw new Error('Skeleton material tint is invalid or exceeds renderer limits');
  if(['r','g','b','a'].every(key=>color[key]===1))return;
  if(!tintShaders.has(material.shader))throw new Error('Skeleton material tint shader is unavailable');
  return {r:color.r,g:color.g,b:color.b,a:color.a};
}

export function compileMaterialMapping(layer){
  const mixed=layer.instance.renderOrderStatus==='mixed-queues';
  const source=layer.entry.materialBindings;
  if(source?.errors?.length)return {reason:'Skeleton material bindings are unavailable'};
  if(!mixed&&!source?.pages?.some(page=>Object.values(page.materials).some(material=>material.properties?.m_Colors)))return null;
  if(!source?.pages.length||source.errors.length)return {reason:'Skeleton material bindings are unavailable'};
  const pages=new Map(),queues=new Map();let tinted=false;
  try{for(const page of source.pages.filter(page=>page.atlas===0)){const materials={};for(const [mode,material] of Object.entries(page.materials)){if(mixed&&(!Number.isInteger(material.renderQueue)||material.renderQueue<0))return {reason:'Skeleton material queue is unavailable'};queues.set(material.id,material.renderQueue);const tint=materialTint(material);tinted ||= Boolean(tint);materials[mode]={...material,...(tint?{tint}:{})};}pages.set(page.page,materials);}}catch(error){return {reason:error.message};}
  if(!mixed&&!tinted)return null;
  if(mixed)for(const material of layer.instance.renderMaterials)if(queues.get(material.id)!==material.renderQueue)return {reason:'Renderer and skeleton materials do not match'};
  return {pages,tinted,mixed};
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
    const previous=segments.at(-1);if(previous?.material===material.id)previous.slots.push(slot.data.index);else segments.push({material:material.id,queue:mapping.mixed?material.renderQueue:layer.instance.renderQueue,slots:[slot.data.index],...(material.tint?{tint:material.tint}:{})});
  }
  return segments;
}

export function drawSkeletonSlots(renderer,skeleton,slots,tint){
  const target=renderer.skeletonRenderer,previous=target.slotFilter,selected=new Set(slots),colors=[];
  target.slotFilter=slot=>selected.has(slot.data.index);
  try{if(tint)for(const index of slots){const color=skeleton.slots[index]?.color;if(!color)throw new Error('Material tint slot is unavailable');colors.push({color,value:{r:color.r,g:color.g,b:color.b,a:color.a}});for(const key of ['r','g','b','a'])color[key]*=tint[key];}renderer.drawSkeleton(skeleton,false);}finally{for(const {color,value} of colors)Object.assign(color,value);target.slotFilter=previous;}
}
