const ENTRY_NUMBERS=['eventThreshold','attachmentThreshold','drawOrderThreshold','animationStart','animationEnd','animationLast','nextAnimationLast','delay','trackTime','trackLast','nextTrackLast','trackEnd','timeScale','alpha','interruptAlpha','mixTime','mixDuration','mixBlend','totalAlpha'];
const BONE_NUMBERS=['x','y','rotation','scaleX','scaleY','shearX','shearY','ax','ay','arotation','ascaleX','ascaleY','ashearX','ashearY'];
const CONSTRAINT_NUMBERS=['mix','softness','bendDirection','rotateMix','translateMix','scaleMix','shearMix','position','spacing'];
const numeric=(value,label)=>{if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`Invalid ${label}`);return value;};
const numbers=(object,keys)=>Object.fromEntries(keys.filter(key=>typeof object[key]==='number').map(key=>[key,object[key]]));
const vector=color=>color?[color.r,color.g,color.b,color.a]:null;
const array=(value,max,label)=>{if(!Array.isArray(value)||value.length>max)throw new Error(`Invalid ${label}`);return value;};
const name=value=>{if(typeof value!=='string'||value.length>512)throw new Error('Invalid animation or attachment name');return value;};
const color=value=>array(value,4,'color').length===4?value.map(value=>numeric(value,'color')):(()=>{throw new Error('Invalid color');})();

export function captureAnimation(state){
  const entries=[],ids=new Map();
  const visit=entry=>{
    if(!entry||!entry.animation)return null;if(ids.has(entry))return ids.get(entry);
    const id=entries.length;ids.set(entry,id);entries.push(null);
    entries[id]={name:entry.animation.name,index:entry.trackIndex,loop:entry.loop,holdPrevious:entry.holdPrevious,...numbers(entry,ENTRY_NUMBERS),next:visit(entry.next),mixingFrom:visit(entry.mixingFrom),mixingTo:visit(entry.mixingTo),timelineMode:[...entry.timelineMode],timelinesRotation:[...entry.timelinesRotation],timelineHoldMix:entry.timelineHoldMix.map(visit)};
    return id;
  };
  const tracks=Array.from(state.tracks,visit);
  return {schema:1,timeScale:state.timeScale,unkeyedState:state.unkeyedState,animationsChanged:state.animationsChanged,tracks,entries};
}
export function validateAnimation(value){
  if(!value||value.schema!==1)throw new Error('Unsupported animation checkpoint');
  const raw=array(value.entries,1024,'animation entries');
  const reference=value=>{if(value===null)return null;if(!Number.isInteger(value)||value<0||value>=raw.length)throw new Error('Invalid animation entry reference');return value;};
  const entries=raw.map(entry=>{
    const index=numeric(entry.index,'track index');if(!Number.isInteger(index)||index<0||index>31)throw new Error('Invalid track index');
    if(typeof entry.loop!=='boolean'||typeof entry.holdPrevious!=='boolean')throw new Error('Invalid animation flags');
    const result={name:name(entry.name),index,loop:entry.loop,holdPrevious:entry.holdPrevious};
    for(const key of ENTRY_NUMBERS)if(key!=='totalAlpha'||entry[key]!==undefined)result[key]=numeric(entry[key],key);
    if(result.trackTime<0||result.mixDuration<0||result.animationStart>result.animationEnd||![0,1,2,3].includes(result.mixBlend))throw new Error('Invalid animation timing or blend');
    for(const key of ['next','mixingFrom','mixingTo'])result[key]=reference(entry[key]);
    result.timelineMode=array(entry.timelineMode,20000,'timeline modes').map(v=>{if(![0,1,2,3,4].includes(v))throw new Error('Invalid timeline mode');return v;});
    result.timelinesRotation=array(entry.timelinesRotation,40000,'rotation history').map(v=>v===null?null:numeric(v,'rotation history'));
    result.timelineHoldMix=array(entry.timelineHoldMix,20000,'timeline mix references').map(reference);return result;
  });
  const tracks=array(value.tracks,32,'animation tracks').map(reference);
  tracks.forEach((id,index)=>{if(id!==null&&entries[id].index!==index)throw new Error('Animation track does not match entry');});
  for(let id=0;id<entries.length;id++)for(const key of ['mixingFrom','next']){
    const seen=new Set();let cursor=id;
    while(cursor!==null){if(seen.has(cursor))throw new Error('Cyclic animation chain');seen.add(cursor);if(key==='mixingFrom'&&seen.size>64)throw new Error('Animation mix chain is too deep');cursor=entries[cursor][key];}
  }
  for(let id=0;id<entries.length;id++){const entry=entries[id];if(entry.mixingFrom!==null&&(entries[entry.mixingFrom].mixingTo!==id||entries[entry.mixingFrom].index!==entry.index))throw new Error('Invalid animation mix relationship');if(entry.mixingTo!==null&&(entries[entry.mixingTo].mixingFrom!==id||entries[entry.mixingTo].index!==entry.index))throw new Error('Invalid animation mix relationship');}
  const reached=new Set(),pending=tracks.filter(id=>id!==null);while(pending.length){const id=pending.pop();if(reached.has(id))continue;reached.add(id);const entry=entries[id];for(const ref of [entry.next,entry.mixingFrom,entry.mixingTo,...entry.timelineHoldMix])if(ref!==null)pending.push(ref);}if(reached.size!==entries.length)throw new Error('Unreachable animation entries');
  if(typeof value.animationsChanged!=='boolean'||!Number.isSafeInteger(value.unkeyedState)||value.unkeyedState<0)throw new Error('Invalid animation cursor');
  return {schema:1,timeScale:numeric(value.timeScale,'state speed'),unkeyedState:value.unkeyedState,animationsChanged:value.animationsChanged,tracks,entries};
}
function attachmentReference(skeleton,slot){
  const attachment=slot.getAttachment();if(!attachment)return {attachment:null};
  for(const skin of [skeleton.skin,skeleton.data.defaultSkin,...skeleton.data.skins])if(skin)for(const [key,value] of Object.entries(skin.attachments[slot.data.index]||{}))if(value===attachment)return {attachment:key,attachmentSkin:skin.name};
  throw new Error(`Attachment is not in the skeleton asset: ${attachment.name}`);
}
export function capturePose(skeleton){
  return {schema:1,skin:skeleton.skin?.name||null,...numbers(skeleton,['x','y','scaleX','scaleY']),color:vector(skeleton.color),bones:skeleton.bones.map(bone=>({...numbers(bone,BONE_NUMBERS),appliedValid:Boolean(bone.appliedValid)})),slots:skeleton.slots.map(slot=>({...attachmentReference(skeleton,slot),color:vector(slot.color),darkColor:vector(slot.darkColor),deform:[...slot.deform],...(slot.attachmentState!==undefined?{attachmentState:slot.attachmentState}:{})})),drawOrder:skeleton.drawOrder.map(slot=>slot.data.index),ik:skeleton.ikConstraints.map(constraint=>({...numbers(constraint,CONSTRAINT_NUMBERS),compress:Boolean(constraint.compress),stretch:Boolean(constraint.stretch)})),transform:skeleton.transformConstraints.map(constraint=>numbers(constraint,CONSTRAINT_NUMBERS)),path:skeleton.pathConstraints.map(constraint=>numbers(constraint,CONSTRAINT_NUMBERS))};
}
export function validatePose(value){
  if(!value||value.schema!==1)throw new Error('Unsupported pose checkpoint');
  const result={schema:1,skin:value.skin===null?null:name(value.skin),color:color(value.color)};
  for(const key of ['x','y','scaleX','scaleY'])result[key]=numeric(value[key],key);
  result.bones=array(value.bones,20000,'pose bones').map(bone=>{const row={appliedValid:Boolean(bone.appliedValid)};for(const key of BONE_NUMBERS)row[key]=numeric(bone[key],key);return row;});
  result.slots=array(value.slots,20000,'pose slots').map(slot=>({attachment:slot.attachment===null?null:name(slot.attachment),...(slot.attachmentSkin!==undefined?{attachmentSkin:name(slot.attachmentSkin)}:{}),color:color(slot.color),darkColor:slot.darkColor===null?null:color(slot.darkColor),deform:array(slot.deform,200000,'slot deformation').map(v=>numeric(v,'deformation')),...(slot.attachmentState!==undefined?{attachmentState:numeric(slot.attachmentState,'attachment state')}:{})}));
  const seen=new Set();result.drawOrder=array(value.drawOrder,20000,'draw order').map(index=>{if(!Number.isInteger(index)||index<0||index>=result.slots.length||seen.has(index))throw new Error('Invalid slot draw order');seen.add(index);return index;});if(result.drawOrder.length!==result.slots.length)throw new Error('Incomplete slot draw order');
  for(const key of ['ik','transform','path'])result[key]=array(value[key],20000,'pose constraints').map(constraint=>{const row={};for(const field of CONSTRAINT_NUMBERS)if(constraint[field]!==undefined)row[field]=numeric(constraint[field],field);if(key==='ik'){row.compress=Boolean(constraint.compress);row.stretch=Boolean(constraint.stretch);}return row;});
  return result;
}
export function assertCheckpoint(layer,animation,pose){
  const data=layer.skeleton.data;
  if(animation)for(const entry of animation.entries){const clip=entry.name==='<empty>'?{timelines:[]}:data.findAnimation(entry.name);if(!clip)throw new Error(`Scene animation unavailable: ${entry.name}`);for(const key of ['timelineMode','timelineHoldMix'])if(entry[key].length!==0&&entry[key].length!==clip.timelines.length)throw new Error('Animation timeline count does not match asset');if(entry.timelinesRotation.length!==0&&entry.timelinesRotation.length!==clip.timelines.length*2)throw new Error('Rotation history does not match asset');}
  if(!pose)return;
  if(pose.skin!==null&&!data.findSkin(pose.skin))throw new Error(`Scene skin unavailable: ${pose.skin}`);
  for(const [key,items] of [['bones',layer.skeleton.bones],['slots',layer.skeleton.slots],['ik',layer.skeleton.ikConstraints],['transform',layer.skeleton.transformConstraints],['path',layer.skeleton.pathConstraints]])if(pose[key].length!==items.length)throw new Error('Pose component count does not match asset');
  for(const [key,items] of [['ik',layer.skeleton.ikConstraints],['transform',layer.skeleton.transformConstraints],['path',layer.skeleton.pathConstraints]])pose[key].forEach((row,index)=>{for(const field of CONSTRAINT_NUMBERS)if((typeof items[index][field]==='number')!==(typeof row[field]==='number'))throw new Error('Pose constraint parameters do not match asset');});
  const skin=pose.skin!==null?data.findSkin(pose.skin):null;
  pose.slots.forEach((slot,index)=>{const owner=slot.attachmentSkin!==undefined?data.findSkin(slot.attachmentSkin):skin;if(slot.attachmentSkin!==undefined&&!owner)throw new Error(`Scene attachment skin unavailable: ${slot.attachmentSkin}`);if(slot.attachment!==null&&!owner?.getAttachment(index,slot.attachment)&&!(slot.attachmentSkin===undefined&&data.defaultSkin?.getAttachment(index,slot.attachment)))throw new Error(`Scene attachment unavailable: ${slot.attachment}`);});
}
export function restoreAnimation(state,value,spine=window.spine){
  state.clearTracks();state.queue.clear();
  const entries=value.entries.map(row=>{const animation=row.name==='<empty>'?spine.AnimationState.emptyAnimation:state.data.skeletonData.findAnimation(row.name),entry=state.trackEntry(row.index,animation,row.loop,null);entry.holdPrevious=row.holdPrevious;for(const key of ENTRY_NUMBERS)if(row[key]!==undefined)entry[key]=row[key];if(row.totalAlpha===undefined)delete entry.totalAlpha;entry.timelineMode=[...row.timelineMode];entry.timelinesRotation=[...row.timelinesRotation];return entry;});
  value.entries.forEach((row,index)=>{const entry=entries[index];for(const key of ['next','mixingFrom','mixingTo'])entry[key]=row[key]===null?null:entries[row[key]];entry.timelineHoldMix=row.timelineHoldMix.map(id=>id===null?null:entries[id]);});
  state.tracks=value.tracks.map(id=>id===null?null:entries[id]);state.timeScale=value.timeScale;state.unkeyedState=value.unkeyedState;state.animationsChanged=value.animationsChanged;state.events.length=0;state.propertyIDs.clear();
}
export function restorePose(skeleton,value){
  skeleton.setSkin(value.skin===null?null:skeleton.data.findSkin(value.skin));
  for(const key of ['x','y','scaleX','scaleY'])skeleton[key]=value[key];skeleton.color.set(...value.color);
  value.bones.forEach((row,index)=>Object.assign(skeleton.bones[index],row));
  value.slots.forEach((row,index)=>{const slot=skeleton.slots[index];slot.setAttachment(row.attachment===null?null:row.attachmentSkin!==undefined?skeleton.data.findSkin(row.attachmentSkin).getAttachment(index,row.attachment):skeleton.getAttachment(index,row.attachment));slot.color.set(...row.color);if(row.darkColor&&slot.darkColor)slot.darkColor.set(...row.darkColor);slot.deform=[...row.deform];if(row.attachmentState!==undefined)slot.attachmentState=row.attachmentState;});
  skeleton.drawOrder=value.drawOrder.map(index=>skeleton.slots[index]);
  for(const [key,items] of [['ik',skeleton.ikConstraints],['transform',skeleton.transformConstraints],['path',skeleton.pathConstraints]])value[key].forEach((row,index)=>Object.assign(items[index],row));
}
