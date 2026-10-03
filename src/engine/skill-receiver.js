export function validateSkillDisplayState(value){
  if(value?.kind!=='skill-display'||typeof value.ended!=='boolean')throw new Error('Invalid skill display checkpoint');
  return {kind:'skill-display',ended:value.ended};
}

export class SkillDisplayRoot {
  constructor(stage,group){
    this.stage=stage;this.group=group;this.source={id:'skill-display',data:{}};this.hotspots=[];this.ended=false;
    this.receiver=group.presentation.nativeBehaviours?.find(row=>row.class==='FightSkillUIShow'&&row.id===group.presentation.skillDisplay?.receiverId);
    if(!this.receiver||this.receiver.data.spine?.m_FileID!==0)throw new Error('Original skill event receiver is unavailable');
    this.spineId=String(this.receiver.data.spine.m_PathID);
    const animation=group.presentation.visualAnimations?.find(row=>row.type==='Animation'&&String(row.data.m_GameObject?.m_PathID)===this.receiver.gameObject);
    if(!animation)throw new Error('Original skill animation is unavailable');this.animationId=animation.id;
    group.nativeEventHandlers=new Map([[this.receiver.gameObject,new Map([['PlaySpine',()=>this.playSpine()],['PlayWord',()=>this.words.play()],['End',()=>this.end()]])]]);
    // Legacy Default/Default playback resolves to Once in this standalone context.
    group.nativeWrapDefaults=new Map([[animation.id,1]]);
  }
  get layer(){return this.group.layers.find(layer=>layer.instance.id===this.spineId);}
  get model(){return this.group.nativeAnimations?.find(row=>row.source.id===this.animationId)?.model;}
  get words(){const root=this.group.controllers?.find(row=>row.source.id==='skill-words');if(!root)throw new Error('Original skill word receiver is unavailable');return root;}
  initialize(){if(!this.layer?.skeleton.data.findAnimation('animation')||!this.model)throw new Error('Original skill playback is unavailable');this.words;}
  playSpine(){this.layer.state.setAnimation(0,'animation',false);}
  end(){this.ended=true;if(!this.stage.suppressEvents)this.stage.dispatchEvent(new CustomEvent('skill-display-ended',{detail:{group:this.group.id}}));}
  play(){this.reset();this.words.reset();this.model.play();}
  reset(){this.ended=false;}
  advance(){}
  snapshot(){return {kind:'skill-display',ended:this.ended};}
  check(value){return validateSkillDisplayState(value);}
  restore(value){this.ended=this.check(value).ended;}
  onEvent(){}
  hitAt(){return null;}
}
