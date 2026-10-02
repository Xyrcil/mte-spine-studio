export function expandHotSpringPresentations(presentations,houses=[]){
  const result=[...presentations];
  for(const house of houses){
    const source=presentations.find(row=>row.id===house.bundle);if(!source)continue;
    const root=source.hierarchy.find(node=>node.type==='GameObject'&&node.data.m_Name===house.id),transforms=source.hierarchy.filter(node=>node.type.includes('Transform'));
    const rootTransform=transforms.find(node=>String(node.data.m_GameObject?.m_PathID)===root?.id);if(!rootTransform)continue;
    const nodes=new Map(source.hierarchy.map(node=>[node.id,node])),selected=new Set();
    const visit=id=>{if(selected.has(id))return;selected.add(id);const node=nodes.get(id);for(const child of node?.data.m_Children||[])visit(String(child.m_PathID));};visit(rootTransform.id);
    const gameObjects=new Set(transforms.filter(node=>selected.has(node.id)).map(node=>String(node.data.m_GameObject?.m_PathID)));
    const hierarchy=structuredClone(source.hierarchy.filter(node=>selected.has(node.id)||gameObjects.has(node.id)));
    for(const node of hierarchy)if(node.type==='GameObject'&&house.roleIds.includes(node.data.m_Name))node.data.m_IsActive=true;
    const animations=(source.visualAnimations||[]).filter(node=>node.type==='Animation'&&gameObjects.has(String(node.data.m_GameObject?.m_PathID))),clips=new Set();
    for(const node of animations)for(const pointer of [node.data.m_Animation,...(node.data.m_Animations||[])])if(pointer)clips.add(String(pointer.m_PathID));
    result.push({...source,id:`${source.id}/${house.id}`,resourceBundle:source.id,hotSpringHouse:structuredClone(house),standalone:false,hierarchy,
      instances:source.instances.filter(row=>selected.has(row.transform)),hotspots:source.hotspots.filter(row=>selected.has(row.transform)),controllers:source.controllers.filter(row=>gameObjects.has(row.gameObject)),
      effects:(source.effects||[]).filter(row=>selected.has(row.transform)),images:(source.images||[]).filter(row=>selected.has(row.transform)),canvasGroups:(source.canvasGroups||[]).filter(node=>gameObjects.has(String(node.data.m_GameObject?.m_PathID))),
      visualAnimations:[...animations,...(source.visualAnimations||[]).filter(node=>node.type==='AnimationClip'&&clips.has(node.id))],sortingGroups:(source.sortingGroups||[]).filter(node=>gameObjects.has(String(node.data.m_GameObject?.m_PathID)))});
  }
  return result;
}
