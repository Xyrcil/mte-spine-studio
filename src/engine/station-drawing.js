import {multiply,objectTransform,inversePoint,colliderContains} from './geometry.js';

export function expandStationDrawings(presentations,library,entries){
  const catalogue=library.stationDrawings,template=presentations.find(row=>row.id===catalogue?.template);
  const source=template?.nativeBehaviours?.find(row=>row.class==='StationDrawingAnim'&&row.data.m_Enabled);
  const instance=template?.unassignedInstances?.find(row=>row.gameObject===source?.gameObject);
  if(!source||!instance)return presentations;
  const result=[...presentations],names=new Map(library.characters.map(row=>[row.id,row.name]));
  for(const drawing of catalogue.drawings){
    const entry=entries.find(row=>row.id===drawing.skeleton?.id&&row.bundle===drawing.skeleton?.bundle);
    if(!entry||entry.status!=='parsed'||drawing.warnings.length)continue;
    const receiver=structuredClone(source),id=`${template.id}/station/${drawing.id}`;
    if(result.some(row=>row.id===id))continue;
    receiver.data.id=Number(drawing.id);
    const bound={...structuredClone(instance),skeletonId:entry.id,status:'parsed',animation:'stand',loop:true};
    // Initialize replaces the unassigned renderer materials with the selected atlas.
    delete bound.renderMaterials;delete bound.renderOrderStatus;delete bound.renderQueue;
    const queues=[...new Set((entry.materialBindings?.pages||[]).flatMap(page=>Object.values(page.materials).map(material=>material.renderQueue)))];
    if(queues.length===1)bound.renderQueue=queues[0];
    const roleId=drawing.gospelId||drawing.peopleId,appearanceId=`station-${drawing.id}`;
    const presentation={...structuredClone(template),id,path:entry.path,resourceBundle:entry.bundle,standalone:false,category:'story',instances:[bound],unassignedInstances:[],nativeBehaviours:[receiver],stationDrawing:structuredClone(drawing),appearanceId,label:[names.get(roleId),drawing.resource,'Station'].filter(Boolean).join(' · ')};
    result.push(presentation);
    if(!library.appearances.some(row=>row.id===appearanceId))library.appearances.push({id:appearanceId,bundle:id,characterId:roleId,characterName:names.get(roleId),name:drawing.resource+' · Station',kind:'story',status:'available',spineStatus:'available',displayKind:'spine',stationDrawingId:drawing.id});
  }
  return result;
}

export function validateStationDrawingState(value){
  if(value?.kind!=='station-drawing'||value.schema!==1||!Number.isInteger(value.random)||value.random<1||value.random>4294967295||!Number.isInteger(value.selected)||value.selected< -1||value.selected>10000)throw new Error('Invalid station drawing state');
  return {kind:'station-drawing',schema:1,random:value.random,selected:value.selected};
}

export class StationDrawingRoot {
  constructor(group,source){
    this.group=group;this.source=source;this.drawing=group.presentation.stationDrawing;
    this.layer=group.layers.find(layer=>layer.instance.gameObject===source.gameObject&&layer.instance.renderType==='SkeletonAnimation');
    if(!this.layer||!this.drawing||String(source.data.id)!==this.drawing.id)throw new Error('Station drawing binding is unavailable');
    this.hotspots=this.drawing.pairs.length?[{id:'station-touch',name:'Station touch',transform:source.transform,colliders:source.colliders,enabled:source.data.m_Enabled}]:[];
    if(this.missingAnimations().length)throw new Error('Station drawing animations are unavailable');
    this.reset();this.idle();
  }
  reset(){this.value={kind:'station-drawing',schema:1,random:0x12345678,selected:-1};}
  idle(){this.layer.state.setAnimation(0,'stand',true);if(this.drawing.defaultExpression)this.layer.state.setAnimation(1,this.drawing.defaultExpression,true);}
  active(){return this.group.visible&&this.layer.active&&this.group.isActiveTransform(this.source.transform);}
  hitAt(x,y){if(!this.active())return null;const local=inversePoint(multiply(objectTransform(this.group),this.group.world(this.source.transform)),x,y);return local?this.hotspots.find(hit=>hit.colliders.some(collider=>colliderContains(collider,local.x,local.y)))||null:null;}
  click(hit){
    if(hit.id!=='station-touch'||!this.hotspots.length||!this.active())return {accepted:false,reason:'Station interaction is unavailable'};
    if(this.value.selected!==-1)return {accepted:false,reason:'Station animation is playing'};
    let random=this.value.random;random^=random<<13;random^=random>>>17;random^=random<<5;this.value.random=random>>>0;
    const selected=Math.floor(this.value.random/4294967296*this.drawing.pairs.length),pair=this.drawing.pairs[selected];
    this.value.selected=selected;this.layer.state.setAnimation(0,pair.action,false);this.layer.state.setAnimation(1,pair.expression,true);
    return {accepted:true,animation:pair.action};
  }
  onComplete(layer,track){if(layer!==this.layer||this.value.selected===-1||track.animation.name!==this.drawing.pairs[this.value.selected].action)return;this.idle();this.value.selected=-1;}
  onEvent(){}
  advance(){}
  snapshot(){return {...this.value};}
  check(value){const checked=validateStationDrawingState(value);if(checked.selected>=this.drawing.pairs.length)throw new Error('Station drawing state does not match artwork');return checked;}
  restore(value){this.value=this.check(value);}
  restoreLegacy(){this.reset();const track=this.layer.state.getCurrent(0);if(track&&!track.loop)this.value.selected=this.drawing.pairs.findIndex(pair=>pair.action===track.animation.name);}
  missingAnimations(){const names=['stand',this.drawing.defaultExpression,...this.drawing.pairs.flatMap(pair=>[pair.action,pair.expression])].filter(Boolean);return [...new Set(names)].filter(name=>!this.layer.skeleton.data.findAnimation(name)).map(animation=>({hit:'Station touch',animation}));}
}
