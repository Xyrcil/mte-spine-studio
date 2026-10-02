import {compileAnimationCurve} from './particle-values.js';
import {multiply,objectTransform,point} from './geometry.js';
import {PackedAnimation} from './packed-animation.js';
import {viewportRectLayout} from './ui-layout.js';

export function validateNativeAnimation(value){
  if(value?.schema!==1||typeof value.id!=='string'||value.id.length>512||typeof value.clip!=='string'||value.clip.length>512||typeof value.time!=='number'||!Number.isFinite(value.time)||value.time<0||typeof value.playing!=='boolean')throw new Error('Invalid native animation checkpoint');
  return {schema:1,id:value.id,clip:value.clip,time:value.time,playing:value.playing};
}
function resolvePath(group,root,path){
  let node=group.transforms.get(root);
  for(const name of path?path.split('/'):[]){
    const matches=(node?.data.m_Children||[]).map(ref=>group.nodes.get(String(ref.m_PathID))).filter(child=>group.nodes.get(String(child?.data.m_GameObject?.m_PathID))?.data.m_Name===name);
    if(matches.length!==1)throw new Error(`Native animation target unavailable: ${path}`);node=matches[0];
  }
  if(!node)throw new Error(`Native animation root unavailable: ${root}`);return node;
}

export function compileNativeVectorCurve(curve){
  return 'xyz'.split('').map(key=>compileAnimationCurve({...curve,m_Curve:(curve?.m_Curve||[]).map(row=>({...row,...Object.fromEntries(['value','inSlope','outSlope','inWeight','outWeight'].map(field=>[field,typeof row[field]==='object'?row[field]?.[key]:row[field]]))}))}));
}

export class NativeAnimation {
  constructor(group,source,clip){
    this.source=source;this.clip=clip;this.time=0;this.playing=Boolean(source.data.m_PlayAutomatically);this.group=group;
    const data=clip?.data;if(!data?.m_Legacy||data.m_Compressed||(data.m_Events||[]).length||['m_RotationCurves','m_CompressedRotationCurves','m_PPtrCurves'].some(key=>data[key]?.length))throw new Error('Native animation channels or events are not supported yet');
    this.wrap=data.m_WrapMode||source.data.m_WrapMode;if(this.wrap!==2)throw new Error('Native animation wrap mode is not supported yet');
    this.duration=0;
    this.channels=(data.m_FloatCurves||[]).map(row=>{
      const node=resolvePath(group,String(source.data.m_GameObject.m_PathID),row.path);let target,key;
      if(row.classID===224&&/^m_AnchoredPosition\.[xy]$/.test(row.attribute)){target=node;key=row.attribute.at(-1);if(!Number.isFinite(target.data.m_LocalPosition?.[key])||!Number.isFinite(target.data.m_AnchoredPosition?.[key]))throw new Error('Native animated position is unavailable');}
      else if(row.classID===114&&/^m_Color\.[rgba]$/.test(row.attribute)){target=group.nativeImages.find(image=>image.source.gameObject===String(node.data.m_GameObject.m_PathID)&&image.source.data.m_Script?.m_PathID===row.script?.m_PathID);key=row.attribute.at(-1);if(!target||target.reason)throw new Error('Native animation image is not supported yet');}
      else if(row.classID===225&&row.attribute==='m_Alpha'){target=group.nativeCanvasGroups.find(canvas=>String(canvas.data.m_GameObject?.m_PathID)===String(node.data.m_GameObject.m_PathID));key='m_Alpha';if(!target)throw new Error('Native animation CanvasGroup is unavailable');}
      else if(row.classID===1&&row.attribute==='m_IsActive'){target=group.nodes.get(String(node.data.m_GameObject.m_PathID));key='m_IsActive';if(!target)throw new Error('Native animation GameObject is unavailable');}
      else throw new Error(`Native animation property is not supported yet: ${row.attribute}`);
      const keys=row.curve?.m_Curve||[];this.duration=Math.max(this.duration,...keys.map(key=>key.time));return {target,key,transform:node.id,kind:row.classID===224?'position':row.classID===225?'canvasAlpha':row.classID===1?'active':'color',offset:row.classID===224?target.data.m_LocalPosition[key]-target.data.m_AnchoredPosition[key]:0,sample:compileAnimationCurve(row.curve)};
    });
    for(const [field,kind] of [['m_ScaleCurves','scale'],['m_PositionCurves','localPosition'],['m_EulerCurves','rotation']])for(const row of data[field]||[]){
      const target=resolvePath(group,String(source.data.m_GameObject.m_PathID),row.path),samples=compileNativeVectorCurve(row.curve),keys=row.curve.m_Curve;
      if(kind==='rotation'&&keys.some(row=>['x','y'].some(key=>[row.value?.[key],row.inSlope?.[key],row.outSlope?.[key]].some(value=>typeof value!=='number'||Math.abs(value)>1e-8))))throw new Error('Non-planar native rotation is unsupported');
      this.duration=Math.max(this.duration,...keys.map(key=>key.time));
      for(let component=0;component<3;component++)if(kind!=='rotation'||component===2){const key='xyz'[component],data=target.data;if(!Number.isFinite((kind==='scale'?data.m_LocalScale:data.m_LocalPosition)?.[key]))throw new Error('Native animated transform is unavailable');const offset=kind==='localPosition'&&component<2&&data.m_AnchoredPosition?data.m_LocalPosition[key]-data.m_AnchoredPosition[key]:null;if(offset!==null&&!Number.isFinite(offset))throw new Error('Native anchored position offset is unavailable');this.channels.push({target,key,transform:target.id,kind,sample:samples[component],offset});}
    }
    if(!this.channels.length||!Number.isFinite(this.duration)||this.duration<=0)throw new Error('Invalid native animation duration');
  }
  advance(delta){if(typeof delta!=='number'||!Number.isFinite(delta)||delta<0||!Number.isFinite(this.time+delta))throw new Error('Invalid native animation delta');if(this.playing)this.time=Math.round((this.time+delta)*1e12)/1e12;this.apply();}
  apply(){const time=this.time%this.duration,values=this.channels.map(channel=>channel.sample(time));if(values.some(value=>!Number.isFinite(value)))throw new Error('Native animation produced a nonfinite value');for(let i=0;i<this.channels.length;i++){const channel=this.channels[i],value=values[i],data=channel.target.data;
    if(channel.kind==='color')channel.target.color[channel.key]=value;
    else if(channel.kind==='position'){data.m_LocalPosition[channel.key]=channel.offset+value;data.m_AnchoredPosition[channel.key]=value;}
    else if(channel.kind==='scale')data.m_LocalScale={...data.m_LocalScale,[channel.key]:value};
    else if(channel.kind==='localPosition'){data.m_LocalPosition={...data.m_LocalPosition,[channel.key]:value};if(channel.offset!==null)data.m_AnchoredPosition={...data.m_AnchoredPosition,[channel.key]:value-channel.offset};}
    else if(channel.kind==='rotation'){const half=value*Math.PI/360;data.m_LocalRotation={x:0,y:0,z:Math.sin(half),w:Math.cos(half)};}
    else if(channel.kind==='active')data.m_IsActive=value>=.5;
    else if(channel.kind==='canvasAlpha')data.m_Alpha=value;
  }}
  snapshot(){return {schema:1,id:this.source.id,clip:this.clip.id,time:this.time,playing:this.playing};}
  restore(value){value=validateNativeAnimation(value);if(value.id!==this.source.id||value.clip!==this.clip.id)throw new Error('Native animation source does not match checkpoint');this.time=value.time;this.playing=value.playing;this.apply();}
}

export function createNativeVisuals(group,base,manager,assetBase=base){
  group.nativeCanvasGroups=structuredClone(group.presentation.canvasGroups||[]);
  group.nativeImages=(group.presentation.images||[]).map(source=>{
    const node=group.nodes.get(source.transform),data=node?.data;
    let reason=source.status!=='extracted'||!source.sprite||source.material||source.data.m_Type!==0||source.data.m_PreserveAspect||source.data.m_UseSpriteMesh||!data||data.m_AnchorMin?.x!==data.m_AnchorMax?.x||data.m_AnchorMin?.y!==data.m_AnchorMax?.y?'Native image layout or material is not supported yet':undefined;
    if(!reason&&source.sprite.contentRect)try{nativeImageBounds({x:1,y:1},{x:.5,y:.5},source.sprite);}catch(error){reason=error.message;}
    return {source,color:{...source.data.m_Color},texture:source.assetPath?assetBase+source.assetPath:base+source.sprite?.path,reason,used:Boolean(source.viewportDecoration)};
  });
  group.nativeAnimations=(group.presentation.visualAnimations||[]).filter(row=>row.type==='Animation').map(source=>{
    const clip=group.presentation.visualAnimations.find(row=>row.type==='AnimationClip'&&row.id===String(source.data.m_Animation?.m_PathID));
    try{const model=clip?.data.packedCurves?.channels?.length&&!clip.data.m_Legacy?new PackedAnimation(group,source,clip):new NativeAnimation(group,source,clip);if(model instanceof PackedAnimation)model.playing=Boolean(source.data.m_PlayAutomatically);model.apply();for(const channel of model.channels){if(channel.kind==='color')channel.target.used=true;else if(channel.transform)for(const image of group.nativeImages){let node=group.nodes.get(image.source.transform),seen=new Set();while(node&&!seen.has(node.id)){seen.add(node.id);if(node.id===channel.transform){image.used=true;break;}node=group.nodes.get(String(node.data.m_Father?.m_PathID));}}}return {source,model};}catch(error){return {source,reason:error.message};}
  });
  const urls=new Set(group.nativeImages.filter(image=>image.used&&!image.reason).map(image=>image.texture));for(const url of urls)manager.loadTexture(url);
}
export function preflightNativeAnimations(group,rows){
  if(rows===undefined)return;
  const models=(group.nativeAnimations||[]).filter(row=>row.model),seen=new Set();if(rows.length!==models.length)throw new Error('Native animation count does not match asset');
  for(const row of rows){validateNativeAnimation(row);const model=models.find(layer=>layer.source.id===row.id)?.model;if(seen.has(row.id)||!model||model.clip.id!==row.clip)throw new Error('Native animation source does not match checkpoint');seen.add(row.id);}
}
export function viewportDecorationMatrix(view,scaler){
  if(scaler?.m_UiScaleMode!==1||scaler.m_ScreenMatchMode!==1||![view.width,view.height,scaler.m_ReferenceResolution?.x,scaler.m_ReferenceResolution?.y].every(value=>Number.isFinite(value)&&value>0))throw new Error('Unsupported viewport decoration scale');
  const scale=Math.min(view.width/scaler.m_ReferenceResolution.x,view.height/scaler.m_ReferenceResolution.y);return [scale,0,0,scale,view.x,view.y];
}
export function nativeImageBounds(size,pivot,sprite){
  const rect=sprite?.rect,content=sprite?.contentRect;
  const bounds={left:-pivot.x*size.x,bottom:-pivot.y*size.y,right:(1-pivot.x)*size.x,top:(1-pivot.y)*size.y};
  if(!content)return bounds;
  if(!rect||![rect.width,rect.height,content.x,content.y,content.width,content.height].every(Number.isFinite)||rect.width<=0||rect.height<=0||content.width<=0||content.height<=0||content.x<0||content.y<0||content.x+content.width>rect.width+1e-3||content.y+content.height>rect.height+1e-3)throw new Error('Invalid native sprite content bounds');
  const round=value=>value%1===.5?Math.round(value/2)*2:Math.round(value),width=round(rect.width),height=round(rect.height);
  if(width<=0||height<=0)throw new Error('Invalid native sprite size');
  bounds.left+=size.x*content.x/width;bounds.bottom+=size.y*content.y/height;
  bounds.right-=size.x*(rect.width-content.x-content.width)/width;bounds.top-=size.y*(rect.height-content.y-content.height)/height;return bounds;
}
export function drawNativeImage(renderer,group,image,viewport){
  if(!image.used||image.reason||image.source.data.m_Enabled===0||image.source.data.m_Enabled===false||!group.isActiveTransform(image.source.transform))return;
  const texture=group.manager.get(image.texture);if(!texture)return;
  const node=group.nodes.get(image.source.transform);let size=node.data.m_SizeDelta,pivot=node.data.m_Pivot,m;
  if(image.source.viewportRoot){const source=image.source.viewportPanel?group.presentation.hotSpringHouse.dialoguePanel:group.presentation.hotSpringHouse.decoration,viewportMatrix=viewportDecorationMatrix(viewport,source.scaler),layout=viewportRectLayout(group.nodes,node.id,image.source.viewportRoot,{x:viewport.width/viewportMatrix[0],y:viewport.height/viewportMatrix[0]});size=layout.size;pivot=layout.pivot;m=multiply(viewportMatrix,layout.matrix);}
  else m=multiply(image.source.viewportDecoration?viewportDecorationMatrix(viewport,group.presentation.hotSpringHouse.decoration.scaler):objectTransform(group),group.world(node.id));let alpha=group.opacity*image.color.a,current=node,seen=new Set();
  while(current){if(seen.has(current.id))throw new Error('Cyclic native image hierarchy');seen.add(current.id);const id=String(current.data.m_GameObject?.m_PathID);for(const canvas of group.nativeCanvasGroups||group.presentation.canvasGroups||[])if(String(canvas.data.m_GameObject?.m_PathID)===id&&canvas.data.m_Enabled!==0&&canvas.data.m_Enabled!==false){alpha*=canvas.data.m_Alpha;if(canvas.data.m_IgnoreParentGroups){current=null;break;}}if(current)current=group.nodes.get(String(current.data.m_Father?.m_PathID));}
  const bounds=nativeImageBounds(size,pivot,image.source.sprite),quad=[],vertices=[[bounds.left,bounds.bottom,0,1],[bounds.right,bounds.bottom,1,1],[bounds.right,bounds.top,1,0],[bounds.left,bounds.top,0,0]];
  for(const [x,y,u,v] of vertices){const p=point(m,x,y);quad.push(p.x,p.y,image.color.r,image.color.g,image.color.b,alpha,u,v);if(renderer.twoColorTint)quad.push(0,0,0,0);}
  renderer.enableRenderer(renderer.batcher);const gl=renderer.context.gl;renderer.batcher.setBlendMode(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);renderer.batcher.draw(texture,quad,[0,1,2,2,3,0]);
}
