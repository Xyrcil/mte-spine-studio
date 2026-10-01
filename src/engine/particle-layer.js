import {ParticleSystem,validateParticleCheckpoint} from './particles.js';
import {multiply,objectTransform} from './geometry.js';

export function createParticleLayers(group,base,manager){
  const urls=new Set();
  const result=(group.presentation.effects||[]).map(source=>{
    const transform=(value,position)=>{const m=multiply(objectTransform(group),group.world(source.transform));return [m[0]*value[0]+m[2]*value[1]+(position?m[4]:0),m[1]*value[0]+m[3]*value[1]+(position?m[5]:0),value[2]];};
    let model,reason;const make=seed=>new ParticleSystem(source,{seed,transform});
    try{model=make();}catch(error){reason=error.message;}
    const material=source.materials?.[0];
    if(!reason&&(source.status!=='extracted'||material?.shader!=='Legacy Shaders/Particles/Alpha Blended'||source.renderer?.m_RenderMode!==0||!source.sprites?.length))reason='Particle material or renderer is not supported yet';
    const textures=reason?[]:source.sprites.map(sprite=>base+sprite.path);for(const url of textures)urls.add(url);
    return {source,model,reason,textures,material,make};
  });
  for(const url of urls)manager.loadTexture(url);
  return result;
}

export function particleOrder(group,source){
  const sorts=group.presentation.sortingGroups||[],seen=new Set();let id=source.gameObject;
  while(id&&id!=='0'){
    if(seen.has(id))throw new Error('Cyclic particle sorting hierarchy');seen.add(id);
    const sort=sorts.find(row=>row.data.m_Enabled!==0&&row.data.m_Enabled!==false&&String(row.data.m_GameObject?.m_PathID)===id);
    if(sort)return sort.data.m_SortingOrder;
    const transform=group.transforms.get(id),parent=group.nodes.get(String(transform?.data.m_Father?.m_PathID||'0'));
    id=String(parent?.data.m_GameObject?.m_PathID||'0');
  }
  return source.renderer?.m_SortingOrder||0;
}

export function hierarchyOrder(group,transform){
  const path=[],seen=new Set();let node=group.nodes.get(transform);
  while(node){if(seen.has(node.id))throw new Error('Cyclic draw hierarchy');seen.add(node.id);const parent=group.nodes.get(String(node.data.m_Father?.m_PathID||'0'));if(!parent)break;path.unshift((parent.data.m_Children||[]).findIndex(pointer=>String(pointer.m_PathID)===node.id));node=parent;}
  return path;
}
export function compareHierarchy(a,b){for(let index=0;index<Math.min(a.length,b.length);index++)if(a[index]!==b[index])return a[index]-b[index];return a.length-b.length;}

export function drawParticleLayer(renderer,group,layer){
  if(layer.reason||!layer.model||!group.isActiveTransform(layer.source.transform)||layer.source.renderer?.m_Enabled===false||layer.source.renderer?.m_Enabled===0)return;
  const tint=Object.fromEntries(layer.material.properties.m_Colors||[])._TintColor||{r:1,g:1,b:1,a:1};
  const scale=Math.abs(group.scale),pivot=layer.source.renderer.m_Pivot||{x:0,y:0};
  const gl=renderer.context.gl;renderer.batcher.setBlendMode(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  for(const particle of layer.model.view()){
    const texture=group.manager.get(layer.textures[particle.frame]);if(!texture)continue;
    const width=particle.size[0]*scale*(particle.flipU?-1:1),height=particle.size[1]*scale*(particle.flipV?-1:1);
    const color=new window.spine.Color(particle.color[0]*tint.r*2,particle.color[1]*tint.g*2,particle.color[2]*tint.b*2,particle.color[3]*tint.a*2*group.opacity);
    renderer.drawTextureRotated(texture,particle.position[0]-width*(.5+pivot.x),particle.position[1]-height*(.5+pivot.y),width,height,width*(.5+pivot.x),height*(.5+pivot.y),particle.rotation[2]*180/Math.PI,color,false);
  }
}

export function preflightParticles(group,rows){
  if(rows===undefined)return;
  if(!Array.isArray(rows)||rows.length!==(group.effects||[]).filter(layer=>layer.model).length)throw new Error('Scene particle count does not match asset');
  const seen=new Set();
  for(const row of rows){if(seen.has(row.id))throw new Error('Duplicate scene particle source');seen.add(row.id);const layer=group.effects.find(layer=>layer.source.id===row.id);if(!layer?.model)throw new Error(`Particle source unavailable: ${row.id}`);validateParticleCheckpoint(row,{id:row.id,limit:layer.model.limit});}
}
