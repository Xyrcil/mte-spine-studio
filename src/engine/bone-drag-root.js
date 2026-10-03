import {BoneDragMotion,inSourceDragRange} from './bone-drag.js';
import {sourceOrder} from './interaction.js';
import {multiply,objectTransform,unityTransform,inversePoint,point,colliderContains} from './geometry.js';

const reference=value=>value?.m_FileID===0?String(value.m_PathID):null;
export function validateBoneDragState(value){
  if(value?.kind!=='bone-drag'||value.schema!==1||typeof value.writing!=='boolean')throw new Error('Invalid bone drag state');
  // The source-specific duration is checked again before applying a scene.
  const model=new BoneDragMotion({x:0,y:0},Number.MAX_VALUE);
  let pointer=null;if(value.pointer!==undefined&&value.pointer!==null){if(!Number.isFinite(value.pointer.x)||!Number.isFinite(value.pointer.y))throw new Error('Invalid bone drag pointer');pointer={x:value.pointer.x,y:value.pointer.y};}
  return {schema:1,kind:'bone-drag',writing:value.writing,pointer,motion:model.check(value.motion)};
}

export class BoneDragRoot {
  constructor(group,source){
    this.group=group;this.source=source;this.hotspots=[];
    const data=source.data,order=sourceOrder(group,source.gameObject);
    this.members=group.layers.filter(layer=>order.includes(layer.instance.transform)).sort((a,b)=>order.indexOf(a.instance.transform)-order.indexOf(b.instance.transform)).map(layer=>({layer,bone:layer.skeleton.findBone(data.dragBone)})).filter(row=>row.bone);
    this.target=reference(data.dragBoneTra);this.left=reference(data.dragRange_LeftTop);this.right=reference(data.dragRange_RightDown);
    if(!this.members.length||![this.target,this.left,this.right].every(id=>id&&group.nodes.has(id)))throw new Error('Bone drag source references are unavailable');
    const last=this.members.at(-1);last.layer.skeleton.updateWorldTransform();
    this.motion=new BoneDragMotion({x:last.bone.worldX,y:last.bone.worldY},data.ShowBackMoveTime);
    this.reset();
  }
  reset(){this.motion.reset();this.writing=false;this.applyPending=false;this.pointer=null;}
  enabled(){return this.group.visible&&this.group.isActiveTransform(this.group.transforms.get(this.source.gameObject)?.id);}
  parentMatrix(){const parent=reference(this.group.nodes.get(this.target)?.data.m_Father);return multiply(objectTransform(this.group),this.group.world(parent));}
  targetMatrix(){const node=this.group.nodes.get(this.target);return multiply(this.parentMatrix(),unityTransform({...node.data,m_LocalPosition:this.motion.current}));}
  rangePosition(id){const binding=this.group.controllers?.find(root=>root.transformBindings?.has(id)),matrix=binding?binding.matrixForTransform(id):multiply(objectTransform(this.group),this.group.world(id));return matrix&&point(matrix,0,0);}
  contains(x,y){if(!this.enabled()||!this.group.isActiveTransform(this.target))return false;const local=inversePoint(this.targetMatrix(),x,y);return Boolean(local&&(this.source.dragColliders||[]).some(collider=>colliderContains(collider,local.x,local.y)));}
  begin(){if(!this.enabled())return false;this.motion.begin();return true;}
  move(world){if(!this.enabled()||!this.motion.dragging)return false;if(!Number.isFinite(world?.x)||!Number.isFinite(world?.y))throw new Error('Invalid bone drag pointer');this.pointer={x:world.x,y:world.y};const left=this.rangePosition(this.left),right=this.rangePosition(this.right);if(!left||!right||!inSourceDragRange(world,left,right))return false;const local=inversePoint(this.parentMatrix(),world.x,world.y);if(!local)return false;this.motion.current=local;this.writing=true;this.applyPending=true;return true;}
  release(){if(!this.enabled())return;this.pointer=null;this.motion.release();this.writing=this.motion.returning;this.applyPending=true;}
  advance(delta){if(!this.enabled()||delta===0)return;this.applyPending=false;this.writing=false;const returning=this.motion.returning;this.motion.advance(delta);if(returning){this.applyPending=true;this.writing=this.motion.returning;}if(this.motion.dragging&&this.pointer)this.move(this.pointer);}
  apply(layer){if(!this.enabled()||!this.writing&&!this.applyPending)return;const member=this.members.find(row=>row.layer===layer);if(member){member.bone.x=this.motion.current.x;member.bone.y=this.motion.current.y;}}
  hitAt(){return null;}
  missingAnimations(){return [];}
  onEvent(){}
  snapshot(){return {schema:1,kind:'bone-drag',writing:this.writing,pointer:this.pointer&&{...this.pointer},motion:this.motion.snapshot()};}
  check(value){const checked=validateBoneDragState(value);this.motion.check(checked.motion);return checked;}
  restore(value){value=this.check(value);this.motion.restore(value.motion);this.writing=value.writing;this.pointer=value.pointer;this.applyPending=false;}
}
