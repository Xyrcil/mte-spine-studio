export function resolveSkillDisplay(library,roleId,skillId){
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
  return {roleId,skillId,firstCharacter:skill.name.slice(0,1),remainingName:skill.name.slice(1),englishName:skill.englishName,portrait:portraits.size===1?structuredClone([...portraits.values()][0]):null,transform,warnings};
}
