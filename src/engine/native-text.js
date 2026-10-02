import {multiply,objectTransform,point} from './geometry.js';

const roundAdvance=value=>value%1===.5?Math.round(value/2)*2:Math.round(value);
export function nativeGradientVertexColors(data,alpha=1){
  if(![1,2].includes(data?.ModifyMode)||!Number.isFinite(alpha))throw new Error('Unsupported native text gradient');
  const color=value=>['r','g','b','a'].map(key=>{if(!Number.isFinite(value?.[key]))throw new Error('Invalid native text gradient color');return roundAdvance(Math.fround(Math.max(0,Math.min(1,value[key]))*255))/255*(key==='a'?alpha:1);}),top=color(data.colorTop),bottom=color(data.colorBottom);
  return (data.ModifyMode===1?[bottom,bottom,top,top]:[top,bottom,bottom,top]).map(value=>[...value]);
}
function textOpacity(group,slot,ownAlpha){
  let alpha=ownAlpha*group.opacity,node=slot.node,seen=new Set();while(node){if(seen.has(node.id))throw new Error('Cyclic native text hierarchy');seen.add(node.id);for(const canvas of group.nativeCanvasGroups||[])if(String(canvas.data.m_GameObject?.m_PathID)===String(node.data.m_GameObject?.m_PathID)&&canvas.data.m_Enabled!==0&&canvas.data.m_Enabled!==false){alpha*=canvas.data.m_Alpha;if(canvas.data.m_IgnoreParentGroups){node=null;break;}}if(node)node=group.nodes.get(String(node.data.m_Father?.m_PathID));}return alpha;
}
export function layoutNativeText(text,measure,font,size,pivot,spacing={x:0,y:0}){
  const data=font.settings,metrics=font.metrics;
  if(typeof text!=='string'||text.length>10000||/[<>]/.test(text)||data.m_BestFit||data.m_FontStyle!==0||data.m_HorizontalOverflow!==1||data.m_VerticalOverflow!==1||!Number.isInteger(data.m_Alignment)||data.m_Alignment<0||data.m_Alignment>8)throw new Error('Native text layout is unsupported');
  if(![data.m_FontSize,data.m_LineSpacing,metrics.m_FontSize,metrics.m_Ascent,metrics.m_Descent,metrics.m_LineSpacing,size.x,size.y,pivot.x,pivot.y,spacing.x,spacing.y].every(Number.isFinite)||data.m_FontSize<=0||metrics.m_FontSize<=0||size.x<0||size.y<0||metrics.m_Tracking!==1||metrics.m_CharacterSpacing!==0)throw new Error('Invalid original native text metrics');
  const scale=data.m_FontSize/metrics.m_FontSize,ascent=metrics.m_Ascent*scale,descent=metrics.m_Descent*scale,pitch=metrics.m_LineSpacing*scale*data.m_LineSpacing,rows=text.replace(/\r/g,'').split('\n').map(line=>{let x=0;const glyphs=Array.from(line).map(character=>{let advance=measure(character);if(!Number.isFinite(advance)||advance<0)throw new Error('Invalid native text glyph advance');if(metrics.m_ShouldRoundAdvanceValue)advance=roundAdvance(advance);const glyph={character,x};x+=advance;return glyph;});return {glyphs,width:x};});
  const top=(1-pivot.y)*size.y,bottom=-pivot.y*size.y,anchor=Math.floor(data.m_Alignment/3),horizontal=data.m_Alignment%3,height=ascent-descent+(rows.length-1)*pitch;
  const baseline=anchor===0?top-ascent:anchor===1?(top+bottom+height)/2-ascent:bottom+height-ascent;
  const glyphs=rows.flatMap((row,line)=>row.glyphs.map((glyph,index)=>({...glyph,x:-pivot.x*size.x+(size.x-row.width)*horizontal/2+glyph.x+index*spacing.x,y:baseline-line*(pitch+spacing.y),line})));
  return {glyphs,ascent,descent,height,width:Math.max(0,...rows.map(row=>row.width))};
}

export class NativeTextLayer {
  constructor(stage,group){this.stage=stage;this.group=group;this.fonts=new Map();this.slots=[];this.disposed=false;}
  async initialize(base,signal){
    try{
      for(const source of this.group.presentation.nativeFontAssets||[]){
        const response=await fetch(base+source.path,{signal});if(!response.ok)throw new Error('Original native text font is unavailable');const bytes=await response.arrayBuffer();if(bytes.byteLength!==source.bytes)throw new Error('Original native text font is incomplete');
        const family='mte-native-'+crypto.randomUUID(),face=new FontFace(family,bytes);await face.load();if(this.disposed||signal?.aborted)throw new DOMException('Native text loading cancelled','AbortError');document.fonts.add(face);this.fonts.set(source.serializedFile+'/'+source.assetId,{source,family,face});
      }
      for(const source of this.group.presentation.nativeText||[]){
        const font=this.fonts.get(source.fontReference?.serializedFile+'/'+source.fontReference?.assetId);if(!font)throw new Error('Original native text font reference is unavailable; refresh the resource pack');
        const canvas=document.createElement('canvas'),context=canvas.getContext('2d'),modifier=this.group.presentation.nativeBehaviours?.find(row=>row.class==='TextSpacing'&&row.gameObject===source.gameObject),node=this.group.nodes.get(source.transform);
        if(!node||source.data.m_Material?.m_PathID!=='0'&&source.data.m_Material?.m_PathID!==0)throw new Error('Native text material or transform is unsupported');
        const gradient=this.group.presentation.nativeBehaviours?.find(row=>row.class==='GraphicsGradientColor'&&row.gameObject===source.gameObject&&row.data.m_Enabled!==0&&row.data.m_Enabled!==false),slot={source,font,canvas,context,node,text:source.data.m_Text,color:{...source.data.m_Color},spacing:{x:modifier?.data.spacing_x||0,y:modifier?.data.spacing_y||0},modifier,gradient,used:false,texture:null,glyphTextures:new Map(),key:''};if(gradient)nativeGradientVertexColors(gradient.data);context.font=`${source.data.m_FontData.m_FontSize}px "${font.family}"`;layoutNativeText(slot.text,c=>context.measureText(c).width,{settings:source.data.m_FontData,metrics:font.source.metrics},node.data.m_SizeDelta,node.data.m_Pivot,slot.spacing);this.slots.push(slot);
      }
    }catch(error){this.reason=error.message;this.dispose();this.slots=[];if(error.name==='AbortError')throw error;}
  }
  draw(renderer,slot){
    const group=this.group;if(this.reason||this.disposed||slot.reason||!slot.used||slot.source.data.m_Enabled===0||slot.source.data.m_Enabled===false||!group.isActiveTransform(slot.source.transform)||!slot.text)return;
    const settings=slot.source.data.m_FontData;slot.context.font=`${settings.m_FontSize}px "${slot.font.family}"`;let flow;
    try{flow=layoutNativeText(slot.text,c=>slot.context.measureText(c).width,{settings,metrics:slot.font.source.metrics},slot.node.data.m_SizeDelta,slot.node.data.m_Pivot,slot.spacing);}catch(error){slot.reason=error.message;return;}
    if(slot.gradient){try{this.drawGradient(renderer,slot,flow);}catch(error){slot.reason=error.message;}return;}
    const ink=flow.glyphs.map(glyph=>{const m=slot.context.measureText(glyph.character),metric=(key,fallback)=>Number.isFinite(m[key])?m[key]:fallback;return {left:glyph.x-metric('actualBoundingBoxLeft',0),right:glyph.x+metric('actualBoundingBoxRight',m.width),top:glyph.y+metric('actualBoundingBoxAscent',flow.ascent),bottom:glyph.y-metric('actualBoundingBoxDescent',-flow.descent)};}),key=JSON.stringify([slot.text,slot.node.data.m_SizeDelta,slot.node.data.m_Pivot,slot.spacing,settings]),padding=4,left=Math.min(0,...ink.map(g=>g.left))-padding,right=Math.max(0,...ink.map(g=>g.right))+padding,top=Math.max(0,...ink.map(g=>g.top))+padding,bottom=Math.min(0,...ink.map(g=>g.bottom))-padding;
    if(key!==slot.key){const resolution=2;slot.canvas.width=Math.max(1,Math.ceil((right-left)*resolution));slot.canvas.height=Math.max(1,Math.ceil((top-bottom)*resolution));slot.context.scale(resolution,resolution);slot.context.font=`${settings.m_FontSize}px "${slot.font.family}"`;slot.context.fillStyle='white';slot.context.textBaseline='alphabetic';for(const glyph of flow.glyphs)slot.context.fillText(glyph.character,glyph.x-left,top-glyph.y);if(slot.texture)slot.texture.update(false);else slot.texture=new window.spine.webgl.GLTexture(this.stage.gl,slot.canvas);slot.key=key;}
    const alpha=textOpacity(group,slot,slot.color.a);
    const matrix=multiply(objectTransform(group),group.world(slot.source.transform)),quad=[];for(const [x,y,u,v] of [[left,top-slot.canvas.height/2,0,1],[left+slot.canvas.width/2,top-slot.canvas.height/2,1,1],[left+slot.canvas.width/2,top,1,0],[left,top,0,0]]){const p=point(matrix,x,y);quad.push(p.x,p.y,slot.color.r,slot.color.g,slot.color.b,alpha,u,v);if(renderer.twoColorTint)quad.push(0,0,0,0);}renderer.enableRenderer(renderer.batcher);const gl=renderer.context.gl;renderer.batcher.setBlendMode(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);renderer.batcher.draw(slot.texture,quad,[0,1,2,2,3,0]);
  }
  drawGradient(renderer,slot,flow){
    const matrix=multiply(objectTransform(this.group),this.group.world(slot.source.transform)),colors=nativeGradientVertexColors(slot.gradient.data,textOpacity(this.group,slot,1)),settings=slot.source.data.m_FontData,keys=new Set();
    for(const glyph of flow.glyphs){
      const key=JSON.stringify([glyph.character,settings.m_FontSize]);keys.add(key);let image=slot.glyphTextures.get(key);
      if(!image){
        const metrics=slot.context.measureText(glyph.character);if(!['actualBoundingBoxLeft','actualBoundingBoxRight','actualBoundingBoxAscent','actualBoundingBoxDescent'].every(key=>Number.isFinite(metrics[key])))throw new Error('Native gradient glyph bounds are unavailable');
        const left=Math.floor(-metrics.actualBoundingBoxLeft),right=Math.ceil(metrics.actualBoundingBoxRight),top=Math.ceil(metrics.actualBoundingBoxAscent),bottom=Math.floor(-metrics.actualBoundingBoxDescent);
        if(right<=left||top<=bottom)continue;
        const canvas=document.createElement('canvas'),resolution=2,padding=2;canvas.width=(right-left+padding*2)*resolution;canvas.height=(top-bottom+padding*2)*resolution;const context=canvas.getContext('2d');context.scale(resolution,resolution);context.font=`${settings.m_FontSize}px "${slot.font.family}"`;context.textBaseline='alphabetic';context.fillStyle='white';context.fillText(glyph.character,padding-left,padding+top);
        image={left,right,top,bottom,u0:padding/(right-left+padding*2),u1:(padding+right-left)/(right-left+padding*2),v0:padding/(top-bottom+padding*2),v1:(padding+top-bottom)/(top-bottom+padding*2),texture:new window.spine.webgl.GLTexture(this.stage.gl,canvas)};slot.glyphTextures.set(key,image);
      }
      const quad=[],vertices=[[image.left,image.bottom,image.u0,image.v1],[image.right,image.bottom,image.u1,image.v1],[image.right,image.top,image.u1,image.v0],[image.left,image.top,image.u0,image.v0]];
      for(let index=0;index<4;index++){const [x,y,u,v]=vertices[index],p=point(matrix,glyph.x+x,glyph.y+y);quad.push(p.x,p.y,...colors[index],u,v);if(renderer.twoColorTint)quad.push(0,0,0,0);}renderer.enableRenderer(renderer.batcher);const gl=renderer.context.gl;renderer.batcher.setBlendMode(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);renderer.batcher.draw(image.texture,quad,[0,1,2,2,3,0]);
    }
    for(const [key,image] of slot.glyphTextures)if(!keys.has(key)){image.texture.dispose();slot.glyphTextures.delete(key);}
  }
  dispose(){this.disposed=true;for(const slot of this.slots){slot.texture?.dispose();for(const image of slot.glyphTextures.values())image.texture.dispose();slot.glyphTextures.clear();}for(const font of this.fonts.values())document.fonts.delete(font.face);this.fonts.clear();}
}
