import {multiply,objectTransform,inversePoint} from './geometry.js';
import {PackedAnimation} from './packed-animation.js';

export function expandHotSpringPresentations(presentations,houses=[],roles=[]){
  const result=[...presentations];
  const dialogueSource=presentations.find(row=>row.id==='UI/Prefab/Onsen');
  const dialogueAnimations=(dialogueSource?.visualAnimations||[]).filter(row=>row.type==='AnimationClip'&&/^ani_love_[1-5](?:_[1-3])?$/.test(row.data.m_Name)&&row.data.packedCurves).map(row=>({name:row.data.m_Name,clip:row.id,duration:row.data.packedCurves.stop-row.data.packedCurves.start}));
  const scaler=presentations.find(row=>row.id==='UI/Prefab/UIRoot')?.canvasScalers?.find(row=>row.m_UiScaleMode===1&&row.m_ScreenMatchMode===1);
  let decoration;
  if(dialogueSource&&scaler){
    const nodes=new Map(dialogueSource.hierarchy.map(node=>[node.id,node])),transforms=dialogueSource.hierarchy.filter(node=>node.type.includes('Transform'));
    const main=dialogueSource.hierarchy.find(node=>node.type==='GameObject'&&node.data.m_Name==='OnsenMainView');
    const withinMain=node=>{const seen=new Set();while(node&&!seen.has(node.id)){seen.add(node.id);if(String(node.data.m_GameObject?.m_PathID)===main?.id)return true;node=nodes.get(String(node.data.m_Father?.m_PathID));}return false;};
    const root=transforms.find(node=>nodes.get(String(node.data.m_GameObject?.m_PathID))?.data.m_Name==='OnsenLove'&&withinMain(node));
    if(root){const selected=new Set();const visit=node=>{selected.add(node.id);selected.add(String(node.data.m_GameObject.m_PathID));for(const child of node.data.m_Children||[])visit(nodes.get(String(child.m_PathID)));};visit(root);
      const source=dialogueSource.visualAnimations.find(node=>node.type==='Animator'&&String(node.data.m_GameObject.m_PathID)===String(root.data.m_GameObject.m_PathID));
      if(source)decoration={rootTransform:root.id,source,scaler:structuredClone(scaler),hierarchy:structuredClone(dialogueSource.hierarchy.filter(node=>selected.has(node.id))),clips:dialogueSource.visualAnimations.filter(node=>node.type==='AnimationClip'&&dialogueAnimations.some(animation=>animation.clip===node.id)),images:dialogueSource.images.filter(image=>selected.has(image.transform)&&image.sprite?.path).map(image=>({...image,viewportDecoration:true,assetPath:`${dialogueSource.path}/${image.sprite.path}`}))};
    }
  }
  for(const house of houses){
    const source=presentations.find(row=>row.id===house.bundle);if(!source)continue;
    const root=source.hierarchy.find(node=>node.type==='GameObject'&&node.data.m_Name===house.id),transforms=source.hierarchy.filter(node=>node.type.includes('Transform'));
    const rootTransform=transforms.find(node=>String(node.data.m_GameObject?.m_PathID)===root?.id);if(!rootTransform)continue;
    const nodes=new Map(source.hierarchy.map(node=>[node.id,node])),selected=new Set();
    const visit=id=>{if(selected.has(id))return;selected.add(id);const node=nodes.get(id);for(const child of node?.data.m_Children||[])visit(String(child.m_PathID));};visit(rootTransform.id);
    const gameObjects=new Set(transforms.filter(node=>selected.has(node.id)).map(node=>String(node.data.m_GameObject?.m_PathID)));
    const hierarchy=structuredClone(source.hierarchy.filter(node=>selected.has(node.id)||gameObjects.has(node.id)));
    if(decoration){const overlay=structuredClone(decoration.hierarchy);if(overlay.some(node=>hierarchy.some(existing=>existing.id===node.id)))throw new Error('Hot spring decoration hierarchy collision');overlay.find(node=>node.id===decoration.rootTransform).data.m_Father={m_FileID:0,m_PathID:'0'};hierarchy.push(...overlay);}
    for(const node of hierarchy)if(node.type==='GameObject'&&house.roleIds.includes(node.data.m_Name))node.data.m_IsActive=true;
    const animations=(source.visualAnimations||[]).filter(node=>node.type==='Animation'&&gameObjects.has(String(node.data.m_GameObject?.m_PathID))),clips=new Set();
    for(const node of animations)for(const pointer of [node.data.m_Animation,...(node.data.m_Animations||[])])if(pointer)clips.add(String(pointer.m_PathID));
    result.push({...source,id:`${source.id}/${house.id}`,resourceBundle:source.id,hotSpringHouse:{...structuredClone(house),rootTransform:rootTransform.id,dialogueAnimations:structuredClone(dialogueAnimations),...(decoration?{decoration:structuredClone(decoration)}:{}),roles:structuredClone(house.roleIds.map(id=>roles.find(role=>role.id===id)).filter(Boolean))},standalone:false,hierarchy,
      instances:source.instances.filter(row=>selected.has(row.transform)),hotspots:source.hotspots.filter(row=>selected.has(row.transform)),controllers:source.controllers.filter(row=>gameObjects.has(row.gameObject)),
      effects:(source.effects||[]).filter(row=>selected.has(row.transform)),images:[...(source.images||[]).filter(row=>selected.has(row.transform)),...(decoration?.images||[])],canvasGroups:(source.canvasGroups||[]).filter(node=>gameObjects.has(String(node.data.m_GameObject?.m_PathID))),
      visualAnimations:[...animations,...(source.visualAnimations||[]).filter(node=>node.type==='AnimationClip'&&clips.has(node.id))],sortingGroups:(source.sortingGroups||[]).filter(node=>gameObjects.has(String(node.data.m_GameObject?.m_PathID)))});
  }
  return result;
}

export function validateHotSpringState(value){
  if(value?.schema!==1||value.kind!=='hot-spring'||!['idle','focusing','dialogue','returning'].includes(value.phase))throw new Error('Invalid hot spring state');
  const result={schema:1,kind:'hot-spring',phase:value.phase};
  for(const key of ['clock','start']){if(typeof value[key]!=='number'||!Number.isFinite(value[key])||value[key]<0)throw new Error('Invalid hot spring time');result[key]=value[key];}
  if(value.start>value.clock)throw new Error('Invalid hot spring transition');
  for(const key of ['roleId','voiceId']){if(typeof value[key]!=='string'||value[key].length>64)throw new Error('Invalid hot spring reference');result[key]=value[key];}
  if(!Number.isInteger(value.random)||value.random<1||value.random>4294967295)throw new Error('Invalid hot spring random state');result.random=value.random;
  result.from={};result.target={};for(const key of ['from','target'])for(const field of ['x','y','scale']){const n=value[key]?.[field];if(typeof n!=='number'||!Number.isFinite(n)||field==='scale'&&n<=0)throw new Error('Invalid hot spring transform');result[key][field]=n;}
  result.levels={};if(!value.levels||typeof value.levels!=='object'||Array.isArray(value.levels)||Object.keys(value.levels).length>16)throw new Error('Invalid hot spring levels');for(const [id,level] of Object.entries(value.levels)){if(id.length>64||!Number.isInteger(level)||level<1||level>5)throw new Error('Invalid hot spring level');result.levels[id]=level;}
  if(value.dialogueAnimation!==undefined){
    const animation=value.dialogueAnimation;
    if(animation!==null&&(!/^ani_love_[1-5](?:_[1-3])?$/.test(animation?.name)||typeof animation.start!=='number'||!Number.isFinite(animation.start)||animation.start<0||animation.start>value.clock||typeof animation.duration!=='number'||!Number.isFinite(animation.duration)||animation.duration<0))throw new Error('Invalid hot spring dialogue animation');
    result.dialogueAnimation=animation===null?null:{name:animation.name,start:animation.start,duration:animation.duration};
  }
  return result;
}

export class HotSpringRoot {
  constructor(stage,group){
    this.stage=stage;this.group=group;this.house=group.presentation.hotSpringHouse;this.source={id:'hot-spring',data:{}};
    this.roles=this.house.roles;this.transform=group.nodes.get(this.house.rootTransform);
    this.decorationModels=new Map();const decoration=this.house.decoration;
    if(decoration){try{for(const clip of decoration.clips)this.decorationModels.set(clip.data.m_Name,new PackedAnimation(group,decoration.source,clip));this.decorationDefaults=decoration.hierarchy.map(node=>({id:node.id,data:structuredClone(group.nodes.get(node.id).data)}));this.decorationColors=group.nativeImages.filter(image=>image.source.viewportDecoration).map(image=>({image,color:{...image.color}}));}catch(error){this.decorationReason=error.message;this.decorationModels.clear();}}
    this.hotspots=this.roles.flatMap(role=>{const go=[...group.nodes.values()].find(node=>node.type==='GameObject'&&node.data.m_Name===role.id),tf=group.transforms.get(go?.id);return tf?[{id:role.id,name:role.id,role,transform:tf.id}]:[];});
    this.hotspots.push({id:'continue',name:'Continue conversation',transform:this.transform.id},{id:'close',name:'Close conversation',transform:this.transform.id});this.reset();
  }
  missingAnimations(){return [];}
  onEvent(){}
  defaults(){return {x:this.house.backgroundOffset[0],y:this.house.backgroundOffset[1],scale:this.house.defaultZoom};}
  reset(){const pose=this.defaults();this.value={schema:1,kind:'hot-spring',phase:'idle',clock:0,start:0,roleId:'',voiceId:'',random:0x12345678,from:{...pose},target:{...pose},levels:Object.fromEntries(this.roles.map(role=>[role.id,1]))};this.apply();}
  snapshot(){return structuredClone(this.value);}
  check(value){const state=validateHotSpringState(value),role=this.roles.find(role=>role.id===state.roleId);if(state.roleId&&!role||['focusing','dialogue','returning'].includes(state.phase)&&!role||Object.keys(state.levels).some(id=>!this.roles.some(role=>role.id===id)))throw new Error('Hot spring role is unavailable');if(state.voiceId&&!role?.levels.some(pool=>pool.voiceIds.includes(state.voiceId)))throw new Error('Hot spring voice is unavailable');if(state.dialogueAnimation){const source=this.house.dialogueAnimations?.find(row=>row.name===state.dialogueAnimation.name);if(state.phase!=='dialogue'||!source||source.duration!==state.dialogueAnimation.duration)throw new Error('Hot spring dialogue animation is unavailable');}return state;}
  restore(value){this.value=this.check(value);this.apply();}
  pose(){const v=this.value,t=['focusing','returning'].includes(v.phase)?Math.min(1,Math.max(0,v.clock-v.start)):1,ease=1-(1-t)**2;return Object.fromEntries(['x','y','scale'].map(key=>[key,v.from[key]+(v.target[key]-v.from[key])*ease]));}
  apply(){const pose=this.pose(),data=this.transform.data;data.m_LocalPosition={...data.m_LocalPosition,x:pose.x,y:pose.y};data.m_AnchoredPosition={x:pose.x,y:pose.y};data.m_LocalScale={...data.m_LocalScale,x:pose.scale,y:pose.scale};
    const decoration=this.house.decoration;if(!decoration)return;for(const row of this.decorationDefaults||[])this.group.nodes.get(row.id).data=structuredClone(row.data);for(const row of this.decorationColors||[])row.image.color={...row.color};const root=this.group.nodes.get(decoration.rootTransform),go=this.group.nodes.get(String(root.data.m_GameObject.m_PathID)),animation=this.value.dialogueAnimation,model=this.decorationModels.get(animation?.name);go.data.m_IsActive=this.value.phase==='dialogue'&&Boolean(model);if(go.data.m_IsActive){model.time=Math.max(0,this.value.clock-animation.start);model.apply();}
  }
  emit(type,detail={}){this.stage.dispatchEvent(new CustomEvent(type,{detail:{group:this.group.id,controller:this.source.id,...detail}}));}
  hitAt(x,y){if(this.value.phase!=='idle')return null;return this.hotspots.find(hit=>{if(!hit.role||!this.group.isActiveTransform(hit.transform))return false;const data=this.group.nodes.get(hit.transform).data,p=inversePoint(multiply(objectTransform(this.group),this.group.world(hit.transform)),x,y),size=data.m_SizeDelta,pivot=data.m_Pivot;return p&&size&&pivot&&p.x>=-pivot.x*size.x&&p.x<=(1-pivot.x)*size.x&&p.y>=-pivot.y*size.y&&p.y<=(1-pivot.y)*size.y;})||null;}
  randomIndex(count){let x=this.value.random;x^=x<<13;x^=x>>>17;x^=x<<5;this.value.random=x>>>0;return Math.floor(this.value.random/4294967296*count);}
  selectVoice(){const v=this.value,role=this.roles.find(role=>role.id===v.roleId),pool=role?.levels.find(pool=>pool.level===(v.levels[role.id]||1));return pool?.voiceIds.length?pool.voiceIds[this.randomIndex(pool.voiceIds.length)]:'';}
  showDialogue(at){
    const v=this.value,level=v.levels[v.roleId]||1,count=level===3?2:level>=4?3:1;
    const name=`ani_love_${level}${count>1?'_'+(this.randomIndex(count)+1):''}`,animation=this.house.dialogueAnimations?.find(row=>row.name===name);
    v.dialogueAnimation=animation?{name,start:at,duration:animation.duration}:null;
    if(animation)this.emit('hot-spring-decoration-request',{name,clip:animation.clip,lateness:Math.max(0,v.clock-at)});
    if(v.voiceId)this.emit('voice-request',{voiceId:v.voiceId,lateness:Math.max(0,v.clock-at)});
    this.apply();
  }
  click(hit){const v=this.value;if(['continue','close'].includes(hit.id)){
    if(v.phase!=='dialogue')return {accepted:false,reason:'No active conversation'};
    if(hit.id==='continue'){
      v.voiceId=v.voiceId?'':this.selectVoice();
      if(v.dialogueAnimation&&v.clock-v.dialogueAnimation.start<v.dialogueAnimation.duration-1e-9)return {accepted:true,animation:'advance-dialogue-pending'};
      if(v.voiceId){this.showDialogue(v.clock);this.emit('interaction-change',{phase:v.phase,roleId:v.roleId});return {accepted:true,animation:'next-conversation'};}
    }
    v.from=this.pose();v.target=this.defaults();v.start=v.clock;v.phase='returning';v.voiceId='';v.dialogueAnimation=null;this.apply();this.emit('voice-stop-request');return {accepted:true,animation:'close-conversation'};
  }
    if(v.phase!=='idle')return {accepted:false,reason:'Finish the current conversation first'};
    if(!hit.role?.focus)return {accepted:false,reason:'Source focus configuration is unavailable'};
    v.from=this.pose();v.target={x:hit.role.focus.position[0],y:hit.role.focus.position[1],scale:hit.role.focus.zoom};v.start=v.clock;v.phase='focusing';v.roleId=hit.id;this.emit('sound-request',{name:'UI_Onsen_role',category:'a_sound_ui',lateness:0});return {accepted:true,animation:`focus-${hit.id}`};
  }
  advance(delta){if(delta<=0)return;const v=this.value;v.clock+=delta;this.apply();if(!['focusing','returning'].includes(v.phase)||v.clock-v.start<1-1e-9)return;
    if(v.phase==='returning'){v.phase='idle';v.roleId='';}else{v.phase='dialogue';v.voiceId=this.selectVoice();this.showDialogue(Math.min(v.clock,v.start+1));}
    this.emit('interaction-change',{phase:v.phase,roleId:v.roleId});
  }
}
