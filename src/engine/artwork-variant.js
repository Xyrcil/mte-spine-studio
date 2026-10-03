export function switchLayerSkin(layer,name){
  if(name!==null&&typeof name!=='string')throw new Error('Invalid artwork variant');
  const skeleton=layer.skeleton,skin=name===null?null:skeleton.data.findSkin(name);if(name!==null&&!skin)throw new Error(`Artwork variant unavailable: ${name}`);
  if(skeleton.skin===skin)return;
  const state=layer.state,queue=state.queue,pending=[...queue.objects],events=[...state.events],disabled=queue.drainDisabled;
  const cursors=new Map(),visit=entry=>{if(!entry||cursors.has(entry))return;cursors.set(entry,Object.fromEntries(['animationLast','nextAnimationLast','trackLast','nextTrackLast'].map(key=>[key,entry[key]])));for(const key of ['next','mixingFrom','mixingTo'])visit(entry[key]);};for(const track of state.tracks)visit(track);
  queue.drainDisabled=true;
  try{skeleton.setSkin(skin);skeleton.setSlotsToSetupPose();state.apply(skeleton);}
  finally{for(const [entry,values] of cursors)Object.assign(entry,values);queue.objects.splice(0,queue.objects.length,...pending);state.events.splice(0,state.events.length,...events);queue.drainDisabled=disabled;}
}
