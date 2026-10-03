import {nativeImageBounds} from './native-visuals.js';

export function skillPortraitSize(portrait,referencePixelsPerUnit){
  if(!portrait?.path||!portrait.rect||!portrait.contentRect||![portrait.rect.width,portrait.rect.height,portrait.pixelsPerUnit,referencePixelsPerUnit].every(value=>Number.isFinite(value)&&value>0))throw new Error('Original skill portrait size is unavailable; refresh the resource pack');
  nativeImageBounds({x:1,y:1},{x:.5,y:.5},portrait);
  const ratio=portrait.pixelsPerUnit/referencePixelsPerUnit;
  return {x:portrait.rect.width/ratio,y:portrait.rect.height/ratio};
}

export function prepareSkillArtwork(presentation){
  const descriptor=presentation.skillArtwork;if(!descriptor)return presentation;
  const prepared=structuredClone(presentation),receiver=prepared.nativeBehaviours?.find(row=>row.class==='FightSkillUIShow'&&row.id===descriptor.receiverId);
  if(!receiver)throw new Error('Original skill artwork receiver is unavailable');
  const size=skillPortraitSize(descriptor.portrait,descriptor.referencePixelsPerUnit),transform=descriptor.transform;
  if(!transform||!['position','scale'].every(field=>['x','y','z'].every(key=>Number.isFinite(transform[field]?.[key]))))throw new Error('Original skill artwork transform is unavailable');
  const views=['imgRole','imgRoleU'].map(field=>{
    const pointer=receiver.data[field],image=prepared.images?.find(row=>row.id===String(pointer?.m_PathID)),node=prepared.hierarchy?.find(row=>row.id===image?.transform);
    if(pointer?.m_FileID!==0||!image||node?.type!=='RectTransform')throw new Error('Original skill artwork image reference is unavailable');
    return {image,node};
  });
  const lower=views[0].node.data;
  if(!['x','y'].every(key=>Number.isFinite(lower.m_AnchoredPosition?.[key])&&Number.isFinite(lower.m_LocalPosition?.[key])&&lower.m_AnchorMin?.[key]===lower.m_AnchorMax?.[key]))throw new Error('Original skill portrait anchors are unsupported');
  lower.m_AnchoredPosition=Object.fromEntries(['x','y'].map(key=>[key,lower.m_AnchoredPosition[key]+transform.position[key]-lower.m_LocalPosition[key]]));
  lower.m_LocalPosition=structuredClone(transform.position);lower.m_LocalScale=structuredClone(transform.scale);
  lower.m_AnchorMax=structuredClone(lower.m_AnchorMin);
  for(const {image,node} of views){image.sprite=structuredClone(descriptor.portrait);image.assetPath=descriptor.portrait.path;image.status='extracted';node.data.m_SizeDelta={...size};}
  if(descriptor.emblem){
    const emblemSize=skillPortraitSize(descriptor.emblem.sprite,descriptor.referencePixelsPerUnit),scale=descriptor.emblem.scale;
    if(!Number.isFinite(scale)||scale<=0)throw new Error('Original skill emblem scale is unavailable');
    for(const field of ['logoB','logo']){
      const pointer=receiver.data[field],image=prepared.images?.find(row=>row.id===String(pointer?.m_PathID)),node=prepared.hierarchy?.find(row=>row.id===image?.transform);
      if(pointer?.m_FileID!==0||!image||node?.type!=='RectTransform')throw new Error('Original skill emblem image reference is unavailable');
      image.sprite=structuredClone(descriptor.emblem.sprite);image.assetPath=descriptor.emblem.sprite.path;image.status='extracted';node.data.m_SizeDelta={x:emblemSize.x*scale,y:emblemSize.y*scale};
      if(field==='logoB')node.data.m_AnchorMax=structuredClone(node.data.m_AnchorMin);
    }
  }
  return prepared;
}

export function resolveSkillEmblem(source,roleId,appearanceId=roleId){
  const role=source.roles.find(row=>row.id===roleId),appearance=source.roles.find(row=>row.id===appearanceId);
  const family=row=>{const seen=new Set();while(row?.parentId){if(seen.has(row.id))throw new Error('Cyclic skill role relationship');seen.add(row.id);row=source.roles.find(parent=>parent.id===row.parentId);if(!row)throw new Error('Original skill parent role is unavailable');}return row?.id;};
  if(!role||!appearance||family(role)!==family(appearance))throw new Error('This appearance is not configured for the selected role');
  const selected=role.emblemScale===.7?role:appearance,resource=selected.emblemResource,matches=(source.emblems||[]).filter(row=>row.resource===resource);
  if(matches.length!==1)return {emblem:null,warning:matches.length?'Original skill emblem reference is ambiguous':'Original skill emblem is unavailable'};
  return {emblem:{resource,sprite:structuredClone(matches[0].sprite),scale:selected.emblemScale},warning:null};
}

export function resolveSkillDisplay(library,roleId,skillId,appearanceId=roleId){
  const source=library.skillDisplay;
  if(source?.sourceVersion!=='legacy')throw new Error('Original skill display data is unavailable; refresh the resource pack');
  const role=source.roles.find(row=>row.id===roleId),skill=source.skills.find(row=>row.id===skillId);
  if(!role?.skillIds.includes(skillId))throw new Error('This skill is not configured for the selected role');
  if(!skill||typeof skill.name!=='string'||!skill.name||typeof skill.englishName!=='string')throw new Error('Original skill text is unavailable');
  const stand=source.stands.find(row=>row.id===roleId),resource=`UI/Image/lihui/${roleId}_lihui`,matches=library.appearances.filter(row=>row.portraitResource===resource&&row.portrait),portraits=new Map(matches.map(row=>[row.portrait.id,row.portrait])),warnings=[];
  if(portraits.size!==1)warnings.push(portraits.size?'Original skill portrait reference is ambiguous':'Original skill portrait is unavailable');
  if(stand?.status!=='available')warnings.push('Original skill stand configuration is unavailable');
  let transform=null;
  if(stand?.status==='available'){
    if(!['x','y','z'].every(key=>Number.isFinite(stand.position?.[key])&&Number.isFinite(stand.scale?.[key])))throw new Error('Invalid original skill stand transform');
    transform={position:{x:stand.position.x*538,y:(stand.position.y-.09)*538,z:0},scale:Object.fromEntries(['x','y','z'].map(key=>[key,stand.scale[key]*5.4]))};
  }
  const {emblem,warning}=resolveSkillEmblem(source,roleId,appearanceId);if(warning)warnings.push(warning);
  return {roleId,skillId,appearanceId,firstCharacter:skill.name.slice(0,1),remainingName:skill.name.slice(1),englishName:skill.englishName,portrait:portraits.size===1?structuredClone([...portraits.values()][0]):null,transform,emblem,warnings};
}
