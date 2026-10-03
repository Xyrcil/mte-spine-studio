export const identity=()=>[1,0,0,1,0,0];
export function multiply(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
export function point(matrix,x,y){return {x:matrix[0]*x+matrix[2]*y+matrix[4],y:matrix[1]*x+matrix[3]*y+matrix[5]};}
export function inversePoint(matrix,x,y){const det=matrix[0]*matrix[3]-matrix[1]*matrix[2];if(Math.abs(det)<1e-12)return null;const dx=x-matrix[4],dy=y-matrix[5];return {x:(matrix[3]*dx-matrix[2]*dy)/det,y:(-matrix[1]*dx+matrix[0]*dy)/det};}
export function objectTransform(group){const angle=(group.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),x=group.scale*(group.flipX?-1:1),y=group.scale*(group.flipY?-1:1);return [c*x,s*x,-s*y,c*y,group.x,group.y];}
export function sourcePreviewCamera(view,aspect){
  const camera=view?.camera,position=view?.position,scale=view?.scale;
  if(![aspect,camera?.x,camera?.y,camera?.halfHeight,camera?.referenceAspect,position?.x,position?.y,scale?.x,scale?.y,view?.offset].every(Number.isFinite)||aspect<=0||camera.halfHeight<=0||camera.referenceAspect<=0||scale.x<=0||scale.y<=0)throw new Error('Invalid source preview configuration');
  if(Math.abs(scale.x-scale.y)>1e-6)throw new Error('Nonuniform source preview scaling is not supported');
  const maximum=2340/1080;if(camera.referenceAspect>=maximum)throw new Error('Invalid source preview reference ratio');const wide=Math.max(0,Math.min(1,(aspect-camera.referenceAspect)/(maximum-camera.referenceAspect))),offset=1+(view.offset-1)*wide;
  const height=2*camera.halfHeight*Math.max(1,camera.referenceAspect/aspect)/scale.y;
  const result={x:(camera.x-position.x*offset)/scale.x,y:(camera.y-position.y)/scale.y,width:height*aspect,height};if(!Object.values(result).every(Number.isFinite))throw new Error('Source preview dimensions are not finite');return result;
}
export function sourcePreviewSettings(view){
  const result={camera:{x:view?.camera?.x,y:view?.camera?.y,halfHeight:view?.camera?.halfHeight,referenceAspect:view?.camera?.referenceAspect},position:{x:view?.position?.x,y:view?.position?.y},scale:{x:view?.scale?.x,y:view?.scale?.y},offset:view?.offset};
  sourcePreviewCamera(result,16/9);return result;
}
export function unityTransform(data){const q=data.m_LocalRotation||{x:0,y:0,z:0,w:1},scale=data.m_LocalScale||{x:1,y:1},p=data.m_LocalPosition||{x:0,y:0};return [(1-2*(q.y*q.y+q.z*q.z))*scale.x,2*(q.x*q.y+q.w*q.z)*scale.x,2*(q.x*q.y-q.w*q.z)*scale.y,(1-2*(q.x*q.x+q.z*q.z))*scale.y,p.x,p.y];}
export function polygonContains(points,x,y){
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[j],b=points[i],cross=(x-a.x)*(b.y-a.y)-(y-a.y)*(b.x-a.x);
    if(Math.abs(cross)<1e-8&&x>=Math.min(a.x,b.x)&&x<=Math.max(a.x,b.x)&&y>=Math.min(a.y,b.y)&&y<=Math.max(a.y,b.y))return true;
    if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }return inside;
}
export function colliderContains(collider,x,y){
  const data=collider.data;if(data.m_Enabled===0||data.m_Enabled===false)return false;
  x-=data.m_Offset?.x||0;y-=data.m_Offset?.y||0;
  if(collider.type==='BoxCollider2D')return Math.abs(x)<=data.m_Size.x/2&&Math.abs(y)<=data.m_Size.y/2;
  if(collider.type==='PolygonCollider2D')return (data.m_Points?.m_Paths||[]).some(path=>polygonContains(path,x,y));
  return false;
}
