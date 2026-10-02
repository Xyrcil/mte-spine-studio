import {multiply,objectTransform,point} from './geometry.js';

const roundAdvance=value=>value%1===.5?Math.round(value/2)*2:Math.round(value);
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
        const gradient=this.group.presentation.nativeBehaviours?.find(row=>row.class==='GraphicsGradientColor'&&row.gameObject===source.gameObject&&row.data.m_Enabled!==0&&row.data.m_Enabled!==false),slot={source,font,canvas,context,node,text:source.data.m_Text,color:{...source.data.m_Color},spacing:{x:modifier?.data.spacing_x||0,y:modifier?.data.spacing_y||0},modifier,gradient,reason:gradient?'Native text vertex-gradient effect is not restored':undefined,used:false,texture:null,key:''};context.font=`${source.data.m_FontData.m_FontSize}px "${font.family}"`;layoutNativeText(slot.text,c=>context.measureText(c).width,{settings:source.data.m_FontData,metrics:font.source.metrics},node.data.m_SizeDelta,node.data.m_Pivot,slot.spacing);this.slots.push(slot);
      }
    }catch(error){this.reason=error.message;this.dispose();this.slots=[];if(error.name==='AbortError')throw error;}
  }
  draw(renderer,slot){
    const group=this.group;if(this.reason||this.disposed||slot.reason||!slot.used||slot.source.data.m_Enabled===0||slot.source.data.m_Enabled===false||!group.isActiveTransform(slot.source.transform)||!slot.text)return;
    const settings=slot.source.data.m_FontData;slot.context.font=`${settings.m_FontSize}px "${slot.font.family}"`;let flow;
    try{flow=layoutNativeText(slot.text,c=>slot.context.measureText(c).width,{settings,metrics:slot.font.source.metrics},slot.node.data.m_SizeDelta,slot.node.data.m_Pivot,slot.spacing);}catch(error){slot.reason=error.message;return;}
    const ink=flow.glyphs.map(glyph=>{const m=slot.context.measureText(glyph.character),metric=(key,fallback)=>Number.isFinite(m[key])?m[key]:fallback;return {left:glyph.x-metric('actualBoundingBoxLeft',0),right:glyph.x+metric('actualBoundingBoxRight',m.width),top:glyph.y+metric('actualBoundingBoxAscent',flow.ascent),bottom:glyph.y-metric('actualBoundingBoxDescent',-flow.descent)};}),key=JSON.stringify([slot.text,slot.node.data.m_SizeDelta,slot.node.data.m_Pivot,slot.spacing,settings]),padding=4,left=Math.min(0,...ink.map(g=>g.left))-padding,right=Math.max(0,...ink.map(g=>g.right))+padding,top=Math.max(0,...ink.map(g=>g.top))+padding,bottom=Math.min(0,...ink.map(g=>g.bottom))-padding;
    if(key!==slot.key){const resolution=2;slot.canvas.width=Math.max(1,Math.ceil((right-left)*resolution));slot.canvas.height=Math.max(1,Math.ceil((top-bottom)*resolution));slot.context.scale(resolution,resolution);slot.context.font=`${settings.m_FontSize}px "${slot.font.family}"`;slot.context.fillStyle='white';slot.context.textBaseline='alphabetic';for(const glyph of flow.glyphs)slot.context.fillText(glyph.character,glyph.x-left,top-glyph.y);if(slot.texture)slot.texture.update(false);else slot.texture=new window.spine.webgl.GLTexture(this.stage.gl,slot.canvas);slot.key=key;}
    let alpha=slot.color.a*group.opacity,node=slot.node,seen=new Set();while(node){if(seen.has(node.id))throw new Error('Cyclic native text hierarchy');seen.add(node.id);for(const canvas of group.nativeCanvasGroups||[])if(String(canvas.data.m_GameObject?.m_PathID)===String(node.data.m_GameObject?.m_PathID)&&canvas.data.m_Enabled!==0&&canvas.data.m_Enabled!==false){alpha*=canvas.data.m_Alpha;if(canvas.data.m_IgnoreParentGroups){node=null;break;}}if(node)node=group.nodes.get(String(node.data.m_Father?.m_PathID));}
    const matrix=multiply(objectTransform(group),group.world(slot.source.transform)),quad=[];for(const [x,y,u,v] of [[left,top-slot.canvas.height/2,0,1],[left+slot.canvas.width/2,top-slot.canvas.height/2,1,1],[left+slot.canvas.width/2,top,1,0],[left,top,0,0]]){const p=point(matrix,x,y);quad.push(p.x,p.y,slot.color.r,slot.color.g,slot.color.b,alpha,u,v);if(renderer.twoColorTint)quad.push(0,0,0,0);}renderer.enableRenderer(renderer.batcher);const gl=renderer.context.gl;renderer.batcher.setBlendMode(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);renderer.batcher.draw(slot.texture,quad,[0,1,2,2,3,0]);
  }
  dispose(){this.disposed=true;for(const slot of this.slots)slot.texture?.dispose();for(const font of this.fonts.values())document.fonts.delete(font.face);this.fonts.clear();}
}
