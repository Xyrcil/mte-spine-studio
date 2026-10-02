import {viewportRectLayout} from './ui-layout.js';
import {viewportDecorationMatrix} from './native-visuals.js';
import {multiply,point} from './geometry.js';

export function advanceDialogueTypewriter(state,clock,rate,count){
  if(!Number.isFinite(clock)||!Number.isFinite(rate)||rate<=0||!Number.isInteger(count)||count<0)throw new Error('Invalid dialogue typewriter timing');
  if(clock+1e-9<state.nextUpdate||state.typed>=count)return;
  state.typed=Math.min(count,Math.max(state.typed,Math.ceil(Math.max(0,clock-state.start)*rate-1e-9)));state.nextUpdate=clock+1/rate;
}

export function layoutDialogueGlyphs(text,measure,width,wrap,rules=null){
  if(typeof text!=='string'||text.length>10000||!Number.isFinite(width)||width<0)throw new Error('Invalid dialogue text layout');
  if(rules&&(typeof rules.leading!=='string'||typeof rules.following!=='string'))throw new Error('Invalid dialogue line-breaking rules');
  const leading=new Set(rules?.leading||''),following=new Set(rules?.following||''),rows=[];let index=0;
  for(const character of text){
    if(character==='\r')continue;
    const advance=character==='\n'?0:measure(character);if(!Number.isFinite(advance)||advance<0)throw new Error('Invalid dialogue glyph advance');
    rows.push({character,index:index++,advance});
  }
  const glyphs=[];let line=0,start=0,maxWidth=0;
  while(start<rows.length){
    let x=0,end=start,breakAt=-1,firstWord=true;
    while(end<rows.length){
      const row=rows[end],c=row.character,code=c.codePointAt(0),space=/\s/u.test(c);
      if(c==='\n')break;
      if(wrap&&width>0&&end>start&&!space&&x+row.advance>width){if(breakAt>start)end=breakAt;break;}
      x+=row.advance;end++;
      const whitespaceBreak=(space||code===8203||code===45||code===173)&&![160,8199,8209,8239,8288].includes(code);
      const cjk=(code>11904&&code<40959)||(code>63744&&code<64255)||(code>65072&&code<65103)||(code>65280&&code<65519);
      if(whitespaceBreak||(cjk&&!leading.has(c)&&!following.has(rows[end]?.character))){breakAt=end;firstWord=false;}
      else if(firstWord&&!leading.has(c))breakAt=end;
    }
    x=0;for(let i=start;i<end;i++){const row=rows[i];glyphs.push({character:row.character,index:row.index,x,line});x+=row.advance;}
    maxWidth=Math.max(maxWidth,x);
    if(rows[end]?.character==='\n'){start=end+1;line++;}
    else{start=end;if(start<rows.length)line++;}
  }
  return {glyphs,characters:index,lines:line+1,width:maxWidth};
}

export class DialogueTextLayer {
  constructor(stage,group){this.stage=stage;this.group=group;this.fonts=new Map();this.slots=[];this.disposed=false;}
  async initialize(base,signal){
    const panel=this.group.presentation.hotSpringHouse?.dialoguePanel;if(!panel)return;
    try{
      for(const source of panel.fonts||[]){
        if(!source.lineBreaking)throw new Error('Original dialogue line-breaking rules are unavailable; refresh the resource pack');
        const response=await fetch(base+source.path,{signal});if(!response.ok)throw new Error('Original dialogue font is unavailable');
        const bytes=await response.arrayBuffer();if(bytes.byteLength!==source.bytes)throw new Error('Original dialogue font is incomplete');
        const family='mte-dialogue-'+crypto.randomUUID(),face=new FontFace(family,bytes);await face.load();
        if(this.disposed||signal?.aborted)throw new DOMException('Dialogue font loading cancelled','AbortError');document.fonts.add(face);this.fonts.set(source.assetId,{source,family,face});
      }
      for(const source of panel.texts){
        const name=this.group.nodes.get(source.gameObject)?.data.m_Name,font=this.fonts.get(String(source.data.m_fontAsset?.m_PathID));
        if(!font||!['tv_name','tv_content'].includes(name)||source.data.m_fontStyle||source.data.m_enableAutoSizing||source.data.m_HorizontalAlignment!==1||![256,512].includes(source.data.m_VerticalAlignment)||source.data.m_characterSpacing||source.data.m_wordSpacing)throw new Error('Original dialogue text settings are unsupported');
        const canvas=document.createElement('canvas'),context=canvas.getContext('2d');this.slots.push({source,name,font,canvas,context,texture:null,key:''});
      }
      if(this.slots.length!==2)throw new Error('Original dialogue text fields are unavailable');
    }catch(error){this.reason=error.message;for(const font of this.fonts.values())document.fonts.delete(font.face);this.fonts.clear();this.slots=[];if(error.name==='AbortError')throw error;}
  }
  draw(renderer,viewport){
    if(this.reason||this.disposed)return;const group=this.group,root=group.controllers.find(root=>root.source.id==='hot-spring'),display=root?.dialogueDisplay();if(root?.value.phase!=='dialogue'||!display)return;
    const panel=group.presentation.hotSpringHouse.dialoguePanel,vm=viewportDecorationMatrix(viewport,panel.scaler),canvasSize={x:viewport.width/vm[0],y:viewport.height/vm[0]};
    for(const slot of this.slots){
      const source=slot.source,data=source.data,text=slot.name==='tv_name'?display.name:display.text;if(!text)continue;
      if(/[<>]|\\[.,^<>]/.test(text)){this.reason='Original dialogue text markup is unsupported';return;}
      const node=group.nodes.get(source.transform),fontSize=data.m_fontSize,fontScale=fontSize/slot.font.source.face.m_PointSize*slot.font.source.face.m_Scale;
      slot.context.font=`${fontSize}px "${slot.font.family}"`;
      if(slot.name==='tv_name')node.data.m_SizeDelta.x=slot.context.measureText(text).width;
      const layout=viewportRectLayout(group.nodes,node.id,panel.rootTransform,canvasSize),margin=data.m_margin||{x:0,y:0,z:0,w:0},width=Math.max(0,layout.size.x-margin.x-margin.z),flow=layoutDialogueGlyphs(text,character=>slot.context.measureText(character).width,width,Boolean(data.m_enableWordWrapping),slot.font.source.lineBreaking);
      const face=slot.font.source.face,ascent=face.m_AscentLine*fontScale,descent=face.m_DescentLine*fontScale,pitch=face.m_LineHeight*fontScale+(data.m_lineSpacing||0)*fontSize*.01,height=ascent-descent+(flow.lines-1)*pitch;
      const left=-layout.pivot.x*layout.size.x+margin.x,top=data.m_VerticalAlignment===256?(1-layout.pivot.y)*layout.size.y-margin.y:(.5-layout.pivot.y)*layout.size.y+height/2;
      const visible=slot.name==='tv_name'?flow.characters:display.visibleCharacters??0,key=JSON.stringify([text,visible,width,fontSize,height]);
      if(key!==slot.key){
        const resolution=4;slot.canvas.width=Math.max(1,Math.ceil((flow.width+4)*resolution));slot.canvas.height=Math.max(1,Math.ceil((height+4)*resolution));slot.context.scale(resolution,resolution);slot.context.font=`${fontSize}px "${slot.font.family}"`;slot.context.textBaseline='alphabetic';slot.context.fillStyle='white';
        for(const glyph of flow.glyphs)if(glyph.index<visible)slot.context.fillText(glyph.character,glyph.x+2,ascent+2+glyph.line*pitch);
        if(slot.texture)slot.texture.update(false);else slot.texture=new window.spine.webgl.GLTexture(this.stage.gl,slot.canvas);slot.key=key;
      }
      if(!slot.texture)continue;const matrix=multiply(vm,layout.matrix),w=slot.canvas.width/4,h=slot.canvas.height/4,color=data.m_fontColor||data.m_Color,quad=[];
      for(const [x,y,u,v] of [[left-2,top+2-h,0,1],[left-2+w,top+2-h,1,1],[left-2+w,top+2,1,0],[left-2,top+2,0,0]]){const p=point(matrix,x,y);quad.push(p.x,p.y,color.r,color.g,color.b,color.a*group.opacity,u,v);if(renderer.twoColorTint)quad.push(0,0,0,0);}
      renderer.enableRenderer(renderer.batcher);const gl=renderer.context.gl;renderer.batcher.setBlendMode(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);renderer.batcher.draw(slot.texture,quad,[0,1,2,2,3,0]);
    }
  }
  dispose(){this.disposed=true;for(const slot of this.slots)slot.texture?.dispose();for(const font of this.fonts.values())document.fonts.delete(font.face);this.fonts.clear();}
}
