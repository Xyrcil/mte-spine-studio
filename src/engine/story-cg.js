const transitions={start:'stand',liliya:'liliya2',shake:'shake2'};
const commands={nextState:'liliya',shake:'shake'};

export function isStoryCg(presentation){return !presentation.standalone&&/^Spines\/storyCG\/[^/]+\//.test(presentation.id);}

export function validateStoryCgState(value){
  if(value?.kind!=='story-cg'||value.schema!==1||!Array.isArray(value.layers)||value.layers.length>1000)throw new Error('Invalid story CG state');
  const seen=new Set(),layers=value.layers.map(row=>{
    if(typeof row.id!=='string'||!row.id||row.id.length>512||seen.has(row.id)||![null,1,Math.fround(.7)].includes(row.speed)||!Array.isArray(row.listeners)||row.listeners.length>3||new Set(row.listeners).size!==row.listeners.length||row.listeners.some(name=>!Object.hasOwn(transitions,name)))throw new Error('Invalid story CG layer state');
    seen.add(row.id);return {id:row.id,speed:row.speed,listeners:[...row.listeners]};
  });return {kind:'story-cg',schema:1,layers};
}

export class StoryCgRoot {
  constructor(stage,group){
    this.stage=stage;this.group=group;this.source={id:'story-cg',data:{}};
    this.layers=group.layers.filter(layer=>layer.instance.renderType==='SkeletonAnimation');
    this.wq=group.presentation.id.split('/')[2].startsWith('WQ_1');
    this.reset();
  }
  reset(){
    this.states=new Map(this.layers.map(layer=>[layer.instance.id,{id:layer.instance.id,speed:null,listeners:[]} ]));
    const active=this.activeLayers();this.rebuildCommands();
    for(const layer of this.layers){
      const row=this.states.get(layer.instance.id),name=this.wq?'animation':'start';delete layer.storyTimeScale;
      if(!active.includes(layer))continue;
      if(!layer.skeleton.data.findAnimation(name)||!this.wq&&!layer.skeleton.data.findAnimation('stand'))continue;
      layer.state.setAnimation(0,name,this.wq);if(!this.wq)row.listeners.push('start');
    }
  }
  onEvent(layer,track,event){
    const row=this.states.get(layer.instance.id);if(!row)return;
    const token=event.stringValue;
    if(row.listeners.includes('start')){if(token==='slow')row.speed=Math.fround(.7);else if(token==='recover')row.speed=1;layer.storyTimeScale=row.speed??undefined;}
    for(const name of [...row.listeners])if(track.animation.name===name&&token===transitions[name]){
      layer.state.setAnimation(0,transitions[name],true);row.listeners.splice(row.listeners.indexOf(name),1);
    }
  }
  click(hit){
    const name=commands[hit.id];if(!name||!this.hotspots.some(row=>row.id===hit.id))return {accepted:false,reason:'Story command is unavailable'};
    for(const layer of this.layers.filter(layer=>layer.active&&this.group.isActiveTransform(layer.instance.transform))){const row=this.states.get(layer.instance.id);layer.state.setAnimation(0,name,false);if(!row.listeners.includes(name))row.listeners.push(name);}
    return {accepted:true,animation:name};
  }
  snapshot(){return {kind:'story-cg',schema:1,layers:[...this.states.values()].map(row=>({...row,listeners:[...row.listeners]}))};}
  check(value){
    const checked=validateStoryCgState(value),byId=new Map(this.layers.map(layer=>[layer.instance.id,layer]));
    if(checked.layers.length!==this.layers.length||checked.layers.some(row=>{const layer=byId.get(row.id);return !layer||this.wq&&(row.speed!==null||row.listeners.includes('start'))||row.listeners.some(name=>!layer.skeleton.data.findAnimation(name)||!layer.skeleton.data.findAnimation(transitions[name]));}))throw new Error('Story CG checkpoint does not match artwork');return checked;
  }
  restore(value){value=this.check(value);this.states=new Map(value.layers.map(row=>[row.id,row]));for(const layer of this.layers)layer.storyTimeScale=this.states.get(layer.instance.id).speed??undefined;this.rebuildCommands();}
  restoreLegacy(){
    for(const layer of this.layers){const row=this.states.get(layer.instance.id),track=layer.state.getCurrent(0),name=track?.animation.name;row.listeners=[];row.speed=null;
      if(Object.hasOwn(transitions,name)&&layer.skeleton.data.findAnimation(transitions[name])&&(!this.wq||name!=='start'))row.listeners.push(name);
      if(name==='start'&&row.listeners.length){const elapsed=track.getAnimationTime();for(const event of layer.entry?.animations.find(animation=>animation.name==='start')?.events||[])if(event.time<=elapsed){if(event.string==='slow')row.speed=Math.fround(.7);else if(event.string==='recover')row.speed=1;}}
      layer.storyTimeScale=row.speed??undefined;
    }this.rebuildCommands();
  }
  activeLayers(){return this.layers.filter(layer=>layer.active&&this.group.isActiveTransform(layer.instance.transform));}
  rebuildCommands(){const active=this.activeLayers();this.hotspots=Object.entries(commands).filter(([,name])=>active.length&&active.every(layer=>layer.skeleton.data.findAnimation(name)&&layer.skeleton.data.findAnimation(transitions[name]))).map(([id])=>({id,name:id==='shake'?'Shake scene':'Next story state',transform:active[0].instance.transform,colliders:[]}));}
  missingAnimations(){const names=this.wq?['animation']:['start','stand'];return this.layers.filter(layer=>layer.active&&this.group.isActiveTransform(layer.instance.transform)).flatMap(layer=>names.filter(name=>!layer.skeleton.data.findAnimation(name)).map(animation=>({hit:layer.instance.name,animation})));}
  advance(){}
  hitAt(){return null;}
}
