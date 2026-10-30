import {voiceAppearance} from './voice-catalog.js';
import {InteractionRoot} from './interaction.js';

export function appearancePlaybackProfile(library,group){
  if(!group)return null;
  const appearance=voiceAppearance(library,{appearanceId:group?.appearanceId??group?.presentation?.appearanceId,bundle:group?.presentation?.id});
  if(!appearance||!['skin','painting'].includes(appearance.kind)||!/^\d+$/.test(appearance.id)||group.kind!=='spine')return null;
  const item=appearance.entranceItem;
  const entranceItem=Number.isSafeInteger(item)&&item>=0?item:null;
  const layers=group.layers.filter(layer=>layer.active!==false);
  return {appearanceId:appearance.id,entranceItem,idleAvailable:layers.some(layer=>layer.skeleton.data.findAnimation('animation')),available:entranceItem>0&&layers.some(layer=>layer.skeleton.data.findAnimation('start')&&layer.skeleton.data.findAnimation('animation'))};
}

export function prepareAppearancePlayback(library,group,{entrance=true,unlocked=true}={}){
  const profile=appearancePlaybackProfile(library,group);if(!profile)return {applied:false,entrance:false};
  const entering=new Set();
  for(const root of group.controllers||[])if(root instanceof InteractionRoot)root.reset();
  for(const layer of group.layers.filter(layer=>layer.active!==false)){
    const idle=layer.skeleton.data.findAnimation('animation');if(!idle)continue;
    const start=entrance&&unlocked&&profile.entranceItem>0&&layer.skeleton.data.findAnimation('start');
    layer.state.clearTracks();layer.skeleton.setToSetupPose();
    if(start){layer.state.setAnimation(0,'start',false);layer.state.addAnimation(0,'animation',true,0);entering.add(layer);}
    else layer.state.setAnimation(0,'animation',true);
  }
  for(const root of group.controllers||[])if(root instanceof InteractionRoot){
    if(entering.has(root.primary))Object.assign(root.value,{playing:true,event:0,track:0,animation:'start'});
    root.initializeBackgrounds();
  }
  return {applied:true,entrance:entering.size>0,profile};
}
