// Barycentric coordinates let the editor distinguish visible meshes from empty bounds.
export function trianglePoint(x,y,vertices,a,b,c){
  const ax=vertices[a*2],ay=vertices[a*2+1],bx=vertices[b*2],by=vertices[b*2+1],cx=vertices[c*2],cy=vertices[c*2+1];
  const det=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(!Number.isFinite(det)||Math.abs(det)<1e-10)return null;
  const u=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/det,v=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/det,w=1-u-v;
  return u>=-1e-7&&v>=-1e-7&&w>=-1e-7?[u,v,w]:null;
}
export function opaqueAt(stage,image,u,v){
  if(!image||!Number.isFinite(u)||!Number.isFinite(v)||!image.width||!image.height)return true;
  try{if(!stage.pointerSampler){stage.pointerSampler=document.createElement('canvas');stage.pointerSampler.width=stage.pointerSampler.height=1;}const context=stage.pointerSampler.getContext('2d',{willReadFrequently:true});context.clearRect(0,0,1,1);const x=Math.max(0,Math.min(image.width-1,Math.floor(u*image.width))),y=Math.max(0,Math.min(image.height-1,Math.floor(v*image.height)));context.drawImage(image,x,y,1,1,0,0,1,1);return context.getImageData(0,0,1,1).data[3]>4;}catch{return true;}
}
export function spineHit(stage,layer,x,y,runtime){
  for(const slot of [...layer.skeleton.drawOrder].reverse()){
    if(slot.bone?.active===false||slot.color?.a===0)continue;const attachment=slot.getAttachment();if(!attachment||attachment.color?.a===0)continue;
    let vertices,indices;
    if(attachment instanceof runtime.RegionAttachment){vertices=new Float32Array(8);attachment.computeWorldVertices(slot.bone,vertices,0,2);indices=[0,1,2,2,3,0];}
    else if(attachment instanceof runtime.MeshAttachment){vertices=new Float32Array(attachment.worldVerticesLength);attachment.computeWorldVertices(slot,0,attachment.worldVerticesLength,vertices,0,2);indices=attachment.triangles;}
    else continue;
    const uvs=attachment.uvs,image=attachment.region?.page?.texture?.getImage?.();
    for(let i=0;i<indices.length;i+=3){const a=indices[i],b=indices[i+1],c=indices[i+2],weights=trianglePoint(x,y,vertices,a,b,c);if(!weights)continue;
      if(!uvs||!image)return true;const u=weights[0]*uvs[2*a]+weights[1]*uvs[2*b]+weights[2]*uvs[2*c],v=weights[0]*uvs[2*a+1]+weights[1]*uvs[2*b+1]+weights[2]*uvs[2*c+1];if(opaqueAt(stage,image,u,v))return true;
    }
  }return false;
}
