import {multiply,inversePoint,objectTransform,unityTransform,colliderContains} from './geometry.js';
import {interactionEffects,eventLateness} from './interaction-audio.js';

const DEFAULT_ANIMATIONS={1:'click_01',2:'click_02',3:'click_03',4:'stand_down',6:'click_01_down',7:'click_tail',8:'kaoji_01',9:'door_down',10:'click_lleg_1',11:'click_rleg_1',12:'rope_down',13:'click_03_head_1',14:'click_03_down',15:'stand_up1',16:'click_03_dleg_1',17:'game_down1',18:'card_A',19:'card_B',20:'card_C',21:'card_None',22:'card_None',50:'click_03'};
const STATIC_BONES=new Set(['HitArea_tail','HitArea_lleg','HitArea_rope','HitArea_rleg','HitArea_head','HitArea_dleg','HitArea_chicken1','HitArea_chicken2','HitArea_chicken3','HitArea_chicken4','HitArea_door2','HitArea_door3','HitArea_chest1','HitArea_chest2','HitArea_chest3','HitArea_chest4','HitArea_hand','HitArea_game','HitArea_game2','HitArea_cardA','HitArea_cardB','HitArea_cardC']);
export function sourceOrder(group,gameObject){
  const root=group.transforms.get(gameObject),order=[];
  const visit=(id,seen=new Set())=>{if(seen.has(id))throw new Error('Cyclic scene hierarchy');seen.add(id);order.push(id);for(const child of group.nodes.get(id)?.data.m_Children||[])visit(String(child.m_PathID),seen);};
  if(root)visit(root.id);return order;
}
export function validateInteraction(value){
  if(!value||value.schema!==1)throw new Error('Unsupported interaction state');
  const result={schema:1};
  for(const key of ['playing','isBig','stockingDown','cardStage','cardClickable']){if(typeof value[key]!=='boolean')throw new Error(`Invalid interaction ${key}`);result[key]=value[key];}
  for(const [key,min,max] of [['event',0,102],['track',0,31],['state',0,3],['selectedCard',-1,2],['wins',0,3],['rounds',0,3],['random',0,4294967295]]){const n=value[key];if(!Number.isInteger(n)||n<min||n>max)throw new Error(`Invalid interaction ${key}`);result[key]=n;}
  if(typeof value.clock!=='number'||!Number.isFinite(value.clock)||value.clock<0)throw new Error('Invalid interaction clock');result.clock=value.clock;
  if(typeof value.animation!=='string'||value.animation.length>512)throw new Error('Invalid interaction animation');result.animation=value.animation;
  result.names={};for(const key of Object.keys(DEFAULT_ANIMATIONS)){if(typeof value.names?.[key]!=='string'||value.names[key].length>512)throw new Error('Invalid interaction animation mapping');result.names[key]=value.names[key];}
  if(!value.variants||typeof value.variants!=='object'||Array.isArray(value.variants)||Object.keys(value.variants).length>1000)throw new Error('Invalid interaction variants');
  result.variants=Object.fromEntries(Object.entries(value.variants).map(([key,v])=>{if(key.length>512||typeof v!=='boolean')throw new Error('Invalid interaction variant');return [key,v];}));
  if(!Array.isArray(value.tasks)||value.tasks.length>64)throw new Error('Invalid interaction tasks');
  result.tasks=value.tasks.map(task=>{if(!['approach','card-reveal','card-result','card-return'].includes(task.kind)||typeof task.due!=='number'||!Number.isFinite(task.due)||task.due<0)throw new Error('Invalid interaction task');const copy={kind:task.kind,due:task.due};if(task.kind==='card-result'){if(![0,1,2].includes(task.card))throw new Error('Invalid card result');copy.card=task.card;}if(task.kind==='card-return'){if(typeof task.finished!=='boolean')throw new Error('Invalid card return');copy.finished=task.finished;}return copy;});
  return result;
}
export class InteractionRoot {
  constructor(stage,group,source){
    this.stage=stage;this.group=group;this.source=source;
    const order=sourceOrder(group,source.gameObject);
    this.layers=group.layers.filter(layer=>order.includes(layer.instance.transform)&&group.isActiveTransform(layer.instance.transform)).sort((a,b)=>order.indexOf(a.instance.transform)-order.indexOf(b.instance.transform));
    this.primary=this.layers[0];this.sounds=new Map((source.data.OtherSoundList||[]).map(row=>[row.Key,row.Value]));
    this.hotspots=group.presentation.hotspots.filter(hit=>hit.controller===source.id).sort((a,b)=>order.indexOf(a.transform)-order.indexOf(b.transform));
    this.bindings=new Map();
    for(const hit of this.hotspots){
      const dynamic=source.data.openStaticLoadName===0||source.data.openStaticLoadName===false;
      if(!(dynamic?!hit.name.includes('move'):STATIC_BONES.has(hit.name)))continue;
      for(const layer of this.layers){const bone=layer.skeleton.findBone(hit.name);if(bone)this.bindings.set(hit.id,{layer,bone});}
    }
    this.reset();
    for(const pointer of source.data.bg_list||[]){const layer=this.layers.find(layer=>layer.instance.transform===String(pointer.m_PathID));if(layer?.skeleton.data.findAnimation('animation_bg'))layer.state.setAnimation(1,'animation_bg',true);}
  }
  reset(){this.value={schema:1,playing:false,event:0,track:0,animation:'',names:{...DEFAULT_ANIMATIONS},variants:{},isBig:false,state:this.source.data.aniState||0,stockingDown:false,cardStage:false,cardClickable:true,selectedCard:-1,wins:0,rounds:0,clock:0,random:0x12345678,tasks:[]};}
  missingVariants(){return this.hotspots.filter(hit=>[5,102].includes(hit.event)&&hit.animation&&!this.source.data.rolePetType&&!this.layers.some(layer=>layer.skeleton.data.findAnimation(`${hit.animation}_02`))).map(hit=>({hit:hit.name,animation:`${hit.animation}_02`}));}
  missingAnimations(){
    const rows=[...this.hotspots.filter(hit=>hit.animation&&!this.layers.some(layer=>layer.skeleton.data.findAnimation(hit.animation))).map(hit=>({hit:hit.name,animation:hit.animation})),...this.missingVariants()];
    return rows.filter((row,index)=>rows.findIndex(other=>other.animation===row.animation)===index);
  }
  snapshot(){return structuredClone(this.value);}
  restore(value){this.value=structuredClone(value);}
  matrix(hit){
    const {group}=this,binding=this.bindings.get(hit.id);
    if(!binding)return multiply(objectTransform(group),group.world(hit.transform));
    const native=inversePoint(multiply(objectTransform(group),binding.layer.transform),binding.bone.worldX,binding.bone.worldY);
    if(!native)return null;
    const node=group.nodes.get(hit.transform),parent=String(node?.data.m_Father?.m_PathID||'0');
    return multiply(multiply(objectTransform(group),group.world(parent)),unityTransform({...node.data,m_LocalPosition:native}));
  }
  hitAt(x,y){
    return this.hotspots.find(hit=>{
      if(!hit.event||!this.group.isActiveTransform(hit.transform))return false;
      const matrix=this.matrix(hit),local=matrix&&inversePoint(matrix,x,y);
      return local&&hit.colliders.some(collider=>colliderContains(collider,local.x,local.y));
    })||null;
  }
  emit(type,detail){this.stage.dispatchEvent(new CustomEvent(type,{detail:{group:this.group.id,controller:this.source.id,...detail}}));}
  sound(name,category='a_sound_ui',lateness=0){if(name)this.emit('sound-request',{name,category,lateness});}
  play(name,track=0,loop=false,mix){
    let count=0,duration=0;
    for(const layer of this.layers){const animation=layer.skeleton.data.findAnimation(name);if(!animation)continue;const entry=layer.state.setAnimation(track,name,loop);if(mix!==undefined)entry.mixDuration=mix;count++;duration=animation.duration;}
    return {count,duration};
  }
  clear(track){if(track>0)for(const layer of this.layers)layer.state.clearTrack(track);}
  schedule(kind,delay,extra={}){this.value.tasks.push({kind,due:this.value.clock+delay,...extra});}
  unlocked(){Object.assign(this.value,{playing:false,event:0,animation:''});}
  click(hit){
    const v=this.value,event=hit.event;
    if(v.playing||!v.cardClickable||this.primary?.state.getCurrent(0)?.animation.name==='start')return {accepted:false,reason:'Animation is still playing'};
    if((v.isBig&&[6,7,8,9,10,11,12,17,18,19,20,21].includes(event))||(!v.isBig&&[13,14,15,16].includes(event))||(v.state===2&&event===17)||(v.state!==3&&[18,19,20].includes(event))||(hit.animation==='click_03'&&v.names[50]==='click_03_2'))return {accepted:false,reason:'Interaction is unavailable in this state'};
    let name=v.names[event]||hit.animation,track=hit.track||0;
    if(![...Object.keys(DEFAULT_ANIMATIONS).map(Number),5,100,101,102].includes(event))return {accepted:false,reason:`Unsupported interaction ${event}`};
    if([5,102].includes(event)&&hit.animation){name=v.variants[hit.animation]&&!this.source.data.rolePetType?`${hit.animation}_02`:hit.animation;}
    if(v.state===1){const variant=v.names[6]==='click_01_down_02'?2:1;if(event===8){name=`stand_down${variant}`;track=0;}else if(/^game_down/.test(name))name=`game_down${variant}`;else if(/^stand_up/.test(name))name=`stand_up${variant}`;}
    if(v.state===2&&name==='kaoji_04')name='kaoji_01';
    if(name==='rope_up'){this.clear(track);v.names[12]='rope_down';return {accepted:true,animation:name};}
    if([5,102].includes(event)&&hit.animation)v.variants[hit.animation]=!v.variants[hit.animation];
    const dismissCard=v.cardStage&&v.cardClickable;
    if(!dismissCard&&(!name||!this.layers.some(layer=>layer.skeleton.data.findAnimation(name))))return {accepted:false,reason:`Animation unavailable: ${name||'(empty)'}`};
    const effects=[...new Set([...interactionEffects(event,String(this.source.data.skin_id||''),v),this.sounds.get(hit.animation)].filter(Boolean))];
    for(const sound of effects)this.sound(sound);
    if(dismissCard){v.cardStage=false;for(const track of [2,3,4])this.clear(track);this.emit('voice-request',{event,skinId:String(this.source.data.skin_id||''),explicit:hit.audio||'',animation:name,effects});this.emit('interaction-change',{hit:hit.id,animation:''});return {accepted:true,animation:''};}
    if(event===102)this.clear(track);
    if(event===8&&v.state===1){v.isBig=true;v.names[8]='kaoji_01';}
    if(/^caidan_siwa[234]_1$/.test(name))v.stockingDown=true;
    if(/^caidan_siwa[234]_2$/.test(name))v.stockingDown=false;
    Object.assign(v,{playing:true,event,track,animation:name});
    const result=this.play(name,track,false,[1,2,3].includes(event)?.25:name==='animation_game'?1:undefined);
    this.emit('voice-request',{event,skinId:String(this.source.data.skin_id||''),explicit:hit.audio||'',animation:name,effects});
    if(event===8)this.schedule('approach',result.duration);
    this.emit('interaction-change',{hit:hit.id,event,track,animation:name});return {accepted:true,animation:name};
  }
  onEvent(layer,track,event){
    if(layer!==this.primary)return;
    const name=event.data.name,v=this.value;
    if(name.includes('sound_'))this.sound(name.replaceAll('sound_','').replace('301619402_caidan_Rshoes02','301619402_caidan_Rshoes_02'),'a_sound_ui',eventLateness(layer,track,event));
    if(!v.playing)return;
    for(const effect of this.source.data.OtherEffectList||[])if(effect.Key===name)this.emit('effect-request',{object:String(effect.Obj?.m_PathID||'0'),duration:effect.Time});
    if(name!=='end'&&name!=='card'&&!name.includes('changeto'))return;
    const eventId=v.event,variant=v.names[6]==='click_01_down_02'?2:1;
    let idle=null;
    switch(eventId){
      case 1:case 2:case 3:this.clear(v.track);idle=v.names[4]==='stand_up'||v.names[50]==='click_03_2'?'animation2':'animation';break;
      case 4:{const down=v.animation==='stand_down';idle=down?'animation2':'animation';v.names[4]=down?'stand_up':'stand_down';for(const id of [1,2,3])v.names[id]=`click_0${id}${down?'_2':''}`;break;}
      case 50:idle=v.animation==='click_03'?'animation2':'animation';if(v.animation==='click_03'){v.names[1]='click_01_2';v.names[2]='click_02_2';v.names[50]='click_03_2';}break;
      case 12:v.names[12]='rope_up';break;
      case 7:case 10:case 11:this.clear(v.track);idle=`animation1_${variant}`;break;
      case 6:case 14:{const next=variant===1?2:1;idle=`animation${eventId===6?1:3}_${next}`;this.clothing(next);break;}
      case 9:v.state=v.animation==='door_down'?1:2;v.names[9]=v.state===1?'door_down_02':'door_down';break;
      case 13:case 16:this.clear(v.track);idle=`animation3_${variant}`;break;
      case 15:v.isBig=false;idle=`animation1_${variant}`;break;
      case 17:v.state=/^game_down/.test(v.names[17])?3:1;if(v.state===1)for(const track of [2,3,4])this.clear(track);v.names[17]=`game_${v.state===3?'up':'down'}${variant}`;idle=`animation${v.state===3?4:1}_${variant}`;break;
      case 18:case 19:case 20:v.selectedCard=eventId-18;v.cardStage=true;v.cardClickable=false;this.schedule('card-reveal',track.animation.duration);break;
      case 21:this.clear(v.track);idle=`animation${v.state===3?4:1}_${variant}`;break;
      case 100:case 102:this.clear(v.track);idle=name.startsWith('changeto_')?name.slice(9):v.animation==='animation_game'?`animation4${v.stockingDown?'_2':''}`:'animation';break;
      case 101:this.clear(v.track);break;
    }
    if(idle){this.play(idle,0,true);v.track=0;}
    this.unlocked();this.emit('interaction-change',{animation:idle||'',event:0});
  }
  clothing(variant){const second=variant===2;this.value.names[6]=`click_01_down${second?'_02':''}`;this.value.names[14]=`click_03_down${second?'_02':''}`;this.value.names[10]=`click_lleg_${variant}`;this.value.names[11]=`click_rleg_${variant}`;this.value.names[13]=`click_03_head_${variant}`;this.value.names[16]=`click_03_dleg_${variant}`;}
  advance(delta){
    if(delta<=0)return;
    const v=this.value;v.clock+=delta;
    for(const task of [...v.tasks])if(task.due<=v.clock){v.tasks.splice(v.tasks.indexOf(task),1);this.runTask(task);}
  }
  randomCard(){let x=this.value.random;x^=x<<13;x^=x>>>17;x^=x<<5;this.value.random=x>>>0;return Math.floor(this.value.random/4294967296*3);}
  runTask(task){
    const v=this.value,variant=v.names[6]==='click_01_down_02'?2:1,skin=this.source.data.skin_id;
    if(task.kind==='approach'){
      v.isBig=/^stand_down/.test(v.animation);if(!v.isBig)this.clear(v.track);
      v.names[8]=({kaoji_01:'kaoji_02',kaoji_02:'kaoji_03',kaoji_03:'kaoji_04'})[v.animation]||'kaoji_01';
      this.play(`animation${v.isBig?3:1}_${variant}`,0,true);v.track=0;this.unlocked();
    }else if(task.kind==='card-reveal'){
      const card=this.randomCard();this.sound(`${skin}01_cm_qipao`);v.animation=`qipao_${'ABC'[card]}`;v.track=3;const result=this.play(v.animation,3,false);v.playing=true;this.schedule('card-result',result.duration,{card});
    }else if(task.kind==='card-result'){
      v.rounds++;if(task.card===v.selectedCard)v.wins++;
      const finished=v.wins>=2||v.rounds>=3,won=v.wins>=2;
      const name=finished?`game_${won?'win':'lose'}_${variant}`:task.card===v.selectedCard?'exp_win':'exp_lose';
      if(finished){this.sound(`${skin}01_cm_game_${won?'win':'lose'}`);v.rounds=0;v.wins=0;}
      v.animation=name;v.track=finished?0:2;const result=this.play(name,v.track,!finished,finished?undefined:1);v.playing=true;this.schedule('card-return',result.duration,{finished});
    }else if(task.kind==='card-return'){
      if(v.track>0&&v.rounds===0){this.clear(v.track);for(const track of [3,4])this.clear(track);}
      this.play(`animation${v.state===3?4:1}_${variant}`,0,true,v.rounds?1:undefined);v.track=0;v.cardClickable=true;this.unlocked();
    }
    this.emit('interaction-change',{event:v.event,animation:v.animation});
  }
}
