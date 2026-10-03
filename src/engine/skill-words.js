export class SkillWordReveal {
  constructor(count){if(!Number.isInteger(count)||count<0||count>4096)throw new Error('Invalid skill word count');this.count=count;this.delay=Math.fround(Math.fround(.33)/(count+1));this.reset();}
  reset(){this.clock=0;this.step=0;this.nextUpdate=0;this.playing=false;}
  play(clock=this.clock){if(!Number.isFinite(clock)||clock<this.clock||this.playing)throw new Error('Invalid or concurrent skill word playback');this.clock=clock;this.step=1;this.nextUpdate=clock+this.delay;this.playing=true;}
  advance(delta){if(!Number.isFinite(delta)||delta<0||!Number.isFinite(this.clock+delta))throw new Error('Invalid skill word time');if(delta===0)return;this.clock=Math.round((this.clock+delta)*1e12)/1e12;if(!this.playing||this.clock+1e-12<this.nextUpdate)return;if(this.step===this.count+1)this.playing=false;else{this.step++;this.nextUpdate=this.clock+this.delay;}}
  alpha(index){if(!Number.isInteger(index)||index<0||index>=this.count)throw new Error('Invalid skill letter index');return index<this.step-1?1:index===this.step-1?.5:0;}
  snapshot(){return {schema:1,count:this.count,clock:this.clock,step:this.step,nextUpdate:this.nextUpdate,playing:this.playing};}
  check(value){if(value?.schema!==1||value.count!==this.count||!Number.isFinite(value.clock)||value.clock<0||!Number.isInteger(value.step)||value.step<0||value.step>this.count+1||!Number.isFinite(value.nextUpdate)||value.nextUpdate<0||typeof value.playing!=='boolean'||value.playing&&(value.step===0||value.nextUpdate<value.clock-1e-9||value.nextUpdate>value.clock+this.delay+1e-9))throw new Error('Invalid skill word checkpoint');return {schema:1,count:this.count,clock:value.clock,step:value.step,nextUpdate:value.nextUpdate,playing:value.playing};}
  restore(value){value=this.check(value);for(const key of ['clock','step','nextUpdate','playing'])this[key]=value[key];}
}

export function validateSkillWordsState(value){if(value?.kind!=='skill-words')throw new Error('Invalid skill word state');return {kind:'skill-words',...new SkillWordReveal(value.count).check(value)};}

export function skillLetterWidths(widths,parentWidth,spacing=0){
  if(!Array.isArray(widths)||widths.some(width=>!Number.isFinite(width)||width<0)||!Number.isFinite(parentWidth)||parentWidth<0||!Number.isFinite(spacing))throw new Error('Invalid skill letter layout');
  const preferred=widths.reduce((sum,width)=>sum+width,0)+Math.max(0,widths.length-1)*spacing,minimum=Math.max(0,widths.length-1)*spacing,t=preferred===minimum?0:Math.max(0,Math.min(1,(parentWidth-minimum)/(preferred-minimum)));let x=-parentWidth/2;
  return widths.map(width=>{const size=width*t,result={x:x+size/2,width:size};x+=size+spacing;return result;});
}

export class SkillWordsRoot {
  constructor(group){
    this.group=group;this.source={id:'skill-words',data:{}};this.hotspots=[];this.rows=[];const descriptor=group.presentation.skillWords,text=descriptor?.text;
    if(typeof text!=='string'||text.length>4096)throw new Error('Original skill word text is unavailable');this.text=text;this.reveal=new SkillWordReveal(text.length);
    const receiver=group.presentation.nativeBehaviours.find(row=>row.class==='FightSkillUIShow'&&row.id===descriptor.receiverId);if(!receiver)throw new Error('Original skill word receiver is unavailable');
    this.root=group.transforms.get(receiver.gameObject)?.id;
    for(const field of ['igEnB','igEn']){
      const pointer=receiver.data[field],generator=group.presentation.nativeBehaviours.find(row=>row.id===String(pointer?.m_PathID)&&row.class==='ItemGen'),layout=group.presentation.nativeBehaviours.find(row=>row.class==='HorizontalLayoutGroup'&&row.gameObject===generator?.gameObject),parent=group.transforms.get(generator?.gameObject),template=group.nativeTextLayer.slots.find(slot=>slot.source.gameObject===String(generator?.data.prefab?.m_PathID));
      if(!generator||generator.data.prefab?.m_FileID||!generator.data.UsePrefab||!layout||!parent||!template||template.node.data.m_Children?.length)throw new Error('Original skill letter generator is unsupported');
      const data=layout.data;if(data.m_ChildAlignment!==3||data.m_ChildForceExpandWidth||data.m_ChildForceExpandHeight||!data.m_ChildControlWidth||!data.m_ChildControlHeight||data.m_ChildScaleWidth||data.m_ChildScaleHeight||Object.values(data.m_Padding).some(value=>value!==0))throw new Error('Original skill letter layout is unsupported');
      const items=[],widths=text.split('').map(character=>{const settings=template.source.data.m_FontData;template.context.font=`${settings.m_FontSize}px "${template.font.family}"`;const width=template.context.measureText(character).width;return template.font.source.metrics.m_ShouldRoundAdvanceValue?(width%1===.5?Math.round(width/2)*2:Math.round(width)):width;});
      for(let index=0;index<text.length;index++){
        const suffix=`#skill-word-${index}`,source=structuredClone(template.source),node=index===0?template.node:structuredClone(template.node),go=index===0?group.nodes.get(source.gameObject):structuredClone(group.nodes.get(template.source.gameObject));
        if(index){go.id+=suffix;node.id+=suffix;node.data.m_GameObject.m_PathID=go.id;source.id+=suffix;source.gameObject=go.id;source.transform=node.id;source.data.m_GameObject.m_PathID=go.id;group.nodes.set(go.id,go);group.nodes.set(node.id,node);group.transforms.set(go.id,node);parent.data.m_Children.push({m_FileID:0,m_PathID:node.id});}
        go.data.m_Name=`txt${index}`;go.data.m_IsActive=true;node.data.m_AnchorMin={x:0,y:1};node.data.m_AnchorMax={x:0,y:1};source.data.m_Text=text[index];const slot=index===0?template:group.nativeTextLayer.createSlot(source,template.font,node,template.modifier,template.gradient);slot.source=source;slot.text=text[index];if(index)group.nativeTextLayer.slots.push(slot);
        const canvas=index===0?group.nativeCanvasGroups.find(row=>String(row.data.m_GameObject?.m_PathID)===go.id):structuredClone(group.nativeCanvasGroups.find(row=>String(row.data.m_GameObject?.m_PathID)===template.source.gameObject));if(!canvas)throw new Error('Original skill letter CanvasGroup is unavailable');if(index){canvas.id+=suffix;canvas.data.m_GameObject.m_PathID=go.id;group.nativeCanvasGroups.push(canvas);}items.push({slot,node,canvas});
      }
      if(!text.length){group.nodes.get(template.source.gameObject).data.m_IsActive=false;template.used=false;}
      this.rows.push({field,items,widths,parent,layout:data});
    }
    const back=this.rows[0],front=this.rows[1],fitter=group.presentation.nativeBehaviours.find(row=>row.class==='ContentSizeFitter'&&row.gameObject===String(back.parent.data.m_GameObject.m_PathID)),ignored=group.presentation.nativeBehaviours.find(row=>row.class==='LayoutElement'&&row.gameObject===String(front.parent.data.m_GameObject.m_PathID));
    if(!fitter||fitter.data.m_HorizontalFit!==2||fitter.data.m_VerticalFit!==0||!ignored?.data.m_IgnoreLayout||String(front.parent.data.m_Father.m_PathID)!==back.parent.id)throw new Error('Original paired skill letter rows are unsupported');
    const siblings=back.parent.data.m_Children,index=siblings.findIndex(pointer=>String(pointer.m_PathID)===front.parent.id);if(index<0)throw new Error('Original skill letter row hierarchy is unavailable');siblings.push(...siblings.splice(index,1));this.apply();
  }
  get value(){return {kind:'skill-words',...this.reveal.snapshot()};}
  get model(){return this.group.nativeAnimations.find(row=>row.model)?.model;}
  apply(){const width=this.rows[0].widths.reduce((sum,width)=>sum+width,0)+Math.max(0,this.text.length-1)*this.rows[0].layout.m_Spacing;this.rows[0].parent.data.m_SizeDelta.x=width;for(const row of this.rows){const layout=skillLetterWidths(row.widths,width,row.layout.m_Spacing);for(let index=0;index<row.items.length;index++){const {slot,node,canvas}=row.items[index],item=layout[index];node.data.m_SizeDelta={x:item.width,y:0};node.data.m_AnchoredPosition={x:item.x+width/2,y:0};node.data.m_LocalPosition={...node.data.m_LocalPosition,x:item.x,y:0};canvas.data.m_Alpha=this.reveal.alpha(index);slot.used=Boolean(this.model);}}}
  play(){this.reveal.play(this.model?.time??this.reveal.clock);this.startedThisFrame=Boolean(this.group.presentation.skillDisplay);this.apply();}
  advance(delta){if(delta<0||!Number.isFinite(delta))throw new Error('Invalid skill word time');if(!this.group.visible||!this.group.isActiveTransform(this.root)||!this.model)return;if(this.startedThisFrame){if(delta>0)this.startedThisFrame=false;}else this.reveal.advance(this.group.presentation.skillDisplay?delta:Math.max(0,this.model.time-this.reveal.clock));this.apply();}
  reset(){this.startedThisFrame=false;this.reveal.reset();this.apply();}
  snapshot(){return {kind:'skill-words',...this.reveal.snapshot()};}
  check(value){if(value?.kind!=='skill-words')throw new Error('Invalid skill word state');return this.reveal.check(value);}
  restore(value){this.check(value);this.startedThisFrame=false;this.reveal.restore(value);this.apply();}
  onEvent(){}
  hitAt(){return null;}
}
