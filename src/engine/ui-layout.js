import {identity,multiply,unityTransform} from './geometry.js';

export function viewportRectLayout(nodes,id,root,canvas,seen=new Set()){
  if(![canvas.x,canvas.y].every(value=>Number.isFinite(value)&&value>0)||seen.has(id))throw new Error('Invalid viewport UI hierarchy');
  seen.add(id);const node=nodes.get(id),data=node?.data;
  if(!data)throw new Error('Viewport UI transform is unavailable');
  if(id!==root&&data.m_Father?.m_FileID)throw new Error('External viewport UI parent is unavailable');
  const parent=id===root?{size:canvas,pivot:{x:.5,y:.5},matrix:identity()}:viewportRectLayout(nodes,String(data.m_Father?.m_PathID),root,canvas,seen);
  const size={},position={},pivot=data.m_Pivot;
  for(const axis of ['x','y']){
    const min=data.m_AnchorMin?.[axis],max=data.m_AnchorMax?.[axis],delta=data.m_SizeDelta?.[axis],offset=data.m_AnchoredPosition?.[axis],p=pivot?.[axis];
    if(![min,max,delta,offset,p].every(Number.isFinite)||max<min)throw new Error('Invalid viewport UI anchors');
    size[axis]=parent.size[axis]*(max-min)+delta;
    position[axis]=parent.size[axis]*(min+(max-min)*p-parent.pivot[axis])+offset;
    if(!Number.isFinite(size[axis])||size[axis]<0||!Number.isFinite(position[axis]))throw new Error('Invalid viewport UI dimensions');
  }
  return {size,pivot,matrix:multiply(parent.matrix,unityTransform({...data,m_LocalPosition:{...data.m_LocalPosition,...position}}))};
}
