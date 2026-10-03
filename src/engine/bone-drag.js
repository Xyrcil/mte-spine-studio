const position=value=>{if(!value||!Number.isFinite(value.x)||!Number.isFinite(value.y))throw new Error('Invalid bone drag position');return {x:value.x,y:value.y};};
export function inSourceDragRange(value,leftTop,rightBottom){
  value=position(value);leftTop=position(leftTop);rightBottom=position(rightBottom);
  return value.x>leftTop.x&&value.x<rightBottom.x&&value.y<leftTop.y&&value.y>rightBottom.y;
}

export class BoneDragMotion {
  constructor(center,duration){if(!Number.isFinite(duration)||duration<0)throw new Error('Invalid bone return duration');this.center=position(center);this.duration=duration;this.reset();}
  reset(){this.current={...this.center};this.dragging=false;this.returning=false;this.elapsed=0;this.from={...this.center};}
  begin(){this.dragging=true;}
  move(value,leftTop,rightBottom){if(!this.dragging||!inSourceDragRange(value,leftTop,rightBottom))return false;this.current=position(value);return true;}
  release(){this.dragging=false;this.from={...this.current};this.elapsed=0;this.returning=this.duration>0;if(!this.returning)this.current={...this.center};}
  advance(delta){if(!Number.isFinite(delta)||delta<0)throw new Error('Invalid bone drag delta');if(!this.returning||delta===0)return;this.elapsed=Math.min(this.duration,this.elapsed+delta);const t=this.elapsed/this.duration,ease=1-(1-t)**2;this.current={x:this.from.x+(this.center.x-this.from.x)*ease,y:this.from.y+(this.center.y-this.from.y)*ease};if(this.elapsed===this.duration){this.returning=false;this.current={...this.center};}}
  snapshot(){return {schema:1,current:{...this.current},from:{...this.from},dragging:this.dragging,returning:this.returning,elapsed:this.elapsed};}
  check(value){if(value?.schema!==1||typeof value.dragging!=='boolean'||typeof value.returning!=='boolean'||!Number.isFinite(value.elapsed)||value.elapsed<0||value.elapsed>this.duration||value.returning&&value.elapsed>=this.duration)throw new Error('Invalid bone drag checkpoint');return {schema:1,current:position(value.current),from:position(value.from),dragging:value.dragging,returning:value.returning,elapsed:value.elapsed};}
  restore(value){value=this.check(value);for(const field of ['current','from','dragging','returning','elapsed'])this[field]=value[field];}
}
