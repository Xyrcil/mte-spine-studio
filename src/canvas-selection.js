import {backgroundMatrix} from './engine/background-layers.js';

export function createCanvasSelection(stage,editor,{enabled=true,getView}){
  const canvas=stage.canvas,svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('canvas-selection');svg.setAttribute('aria-hidden','true');canvas.after(svg);
  const ids=new Set();let primary='',marquee=null,last=0,frame;
  function selected(){return stage.groups.filter(group=>ids.has(group.id));}
  function select(group,extend=false){
    if(!enabled)return;
    if(!extend)ids.clear();
    if(group){if(extend&&ids.has(group.id))ids.delete(group.id);else ids.add(group.id);}
    const active=group&&ids.has(group.id)?group:selected().at(-1);primary=active?.id||'';editor.choose(active);draw();
  }
  function screen(x,y){const rect=canvas.getBoundingClientRect(),width=Math.max(stage.camera.width,stage.camera.height*rect.width/rect.height);return {x:rect.left+((x-stage.camera.x)/width+.5)*rect.width,y:rect.top+(.5-(y-stage.camera.y)/width*rect.width/rect.height)*rect.height};}
  function box(group){const bounds=stage.objectBounds(group);if(!bounds)return null;const a=screen(bounds.minX,bounds.maxY),b=screen(bounds.maxX,bounds.minY);return {left:a.x,top:a.y,right:b.x,bottom:b.y};}
  function selectionBox(){const boxes=selected().map(box).filter(Boolean);return boxes.length?{left:Math.min(...boxes.map(b=>b.left)),top:Math.min(...boxes.map(b=>b.top)),right:Math.max(...boxes.map(b=>b.right)),bottom:Math.max(...boxes.map(b=>b.bottom))}:null;}
  function rectElement(x,y,width,height,className){const r=document.createElementNS(svg.namespaceURI,'rect');for(const [key,value] of Object.entries({x,y,width,height}))r.setAttribute(key,value);r.setAttribute('class',className);svg.append(r);}
  function draw(){
    svg.replaceChildren();if(!enabled||getView()!=='studio'||document.body.dataset.uiHidden==='true')return;
    const bounds=canvas.getBoundingClientRect(),groups=selected();for(const group of groups){const b=box(group);if(b)rectElement(b.left-bounds.left,b.top-bounds.top,b.right-b.left,b.bottom-b.top,'selection-box');}
    const b=selectionBox();if(b&&groups.some(group=>!group.locked)){
      for(const [x,y] of [[b.left,b.top],[b.right,b.top],[b.left,b.bottom],[b.right,b.bottom]])rectElement(x-bounds.left-4,y-bounds.top-4,8,8,'selection-handle');
      const line=document.createElementNS(svg.namespaceURI,'line');line.setAttribute('x1',(b.left+b.right)/2-bounds.left);line.setAttribute('y1',b.top-bounds.top);line.setAttribute('x2',(b.left+b.right)/2-bounds.left);line.setAttribute('y2',b.top-bounds.top-24);line.setAttribute('class','selection-line');svg.append(line);
      const circle=document.createElementNS(svg.namespaceURI,'circle');circle.setAttribute('cx',(b.left+b.right)/2-bounds.left);circle.setAttribute('cy',b.top-bounds.top-24);circle.setAttribute('r','5');circle.setAttribute('class','selection-handle');svg.append(circle);
    }
    if(marquee){const x=Math.min(marquee.x,marquee.endX)-bounds.left,y=Math.min(marquee.y,marquee.endY)-bounds.top;rectElement(x,y,Math.abs(marquee.endX-marquee.x),Math.abs(marquee.endY-marquee.y),'selection-marquee');}
  }
  function tick(time){
    if(time-last>48){last=time;for(const id of [...ids])if(!stage.groups.some(group=>group.id===id))ids.delete(id);const current=editor.selected()?.id||'';if(current!==primary){primary=current;if(current&&!ids.has(current)){ids.clear();ids.add(current);}else if(!current)ids.clear();}if(ids.size||marquee)draw();else if(svg.childNodes.length)svg.replaceChildren();}
    frame=requestAnimationFrame(tick);
  }
  if(enabled)frame=requestAnimationFrame(tick);
  function handleAt(x,y){const b=selectionBox();if(!b||!selected().some(g=>!g.locked))return null;const dist=(a,c)=>Math.hypot(x-a,y-c);if(dist((b.left+b.right)/2,b.top-24)<=11)return 'rotate';if([[b.left,b.top],[b.right,b.top],[b.left,b.bottom],[b.right,b.bottom]].some(([a,c])=>dist(a,c)<=11))return 'scale';return null;}
  function movable(){const groups=selected();return groups.filter(group=>!group.locked&&!(group.parentId&&ids.has(group.parentId))).map(group=>{const matrix=backgroundMatrix(group,stage.groups);return {group,x:group.x,y:group.y,scale:group.scale,rotation:group.rotation,worldX:matrix[4],worldY:matrix[5]};});}
  function beginTransform(kind,x,y){const b=selectionBox();if(!b)return null;const center=stage.screenToWorld((b.left+b.right)/2,(b.top+b.bottom)/2),pointer=stage.screenToWorld(x,y);return {kind,center,initial:Math.max(.001,Math.hypot(pointer.x-center.x,pointer.y-center.y)),angle:Math.atan2(pointer.y-center.y,pointer.x-center.x),members:movable()};}
  function transform(action,x,y){const p=stage.screenToWorld(x,y),angle=Math.atan2(p.y-action.center.y,p.x-action.center.x)-action.angle,factor=Math.max(.01,Math.min(100,Math.hypot(p.x-action.center.x,p.y-action.center.y)/action.initial));
    for(const row of action.members){const dx=row.worldX-action.center.x,dy=row.worldY-action.center.y;let targetX=row.worldX,targetY=row.worldY;if(action.kind==='scale'){targetX=action.center.x+dx*factor;targetY=action.center.y+dy*factor;row.group.scale=Math.max(.01,Math.min(1000,row.scale*factor));}else{targetX=action.center.x+dx*Math.cos(angle)-dy*Math.sin(angle);targetY=action.center.y+dx*Math.sin(angle)+dy*Math.cos(angle);row.group.rotation=row.rotation+angle*180/Math.PI;}const local=stage.objectDragDelta(row.group,targetX-row.worldX,targetY-row.worldY);row.group.x=row.x+local.x;row.group.y=row.y+local.y;}
  }
  function move(members,dx,dy){for(const row of members){const local=stage.objectDragDelta(row.group,dx,dy);row.group.x=row.x+local.x;row.group.y=row.y+local.y;}}
  function startMarquee(x,y){marquee={x,y,endX:x,endY:y};draw();}
  function moveMarquee(x,y){if(marquee){marquee.endX=x;marquee.endY=y;draw();}}
  function endMarquee(){if(!marquee)return;const r={left:Math.min(marquee.x,marquee.endX),right:Math.max(marquee.x,marquee.endX),top:Math.min(marquee.y,marquee.endY),bottom:Math.max(marquee.y,marquee.endY)};for(const group of stage.groups){const b=box(group);if(b&&b.left<=r.right&&b.right>=r.left&&b.top<=r.bottom&&b.bottom>=r.top)ids.add(group.id);}marquee=null;const group=selected().at(-1);primary=group?.id||'';editor.choose(group);draw();}
  return {select,getSelected:selected,clear(){ids.clear();primary='';editor.choose(undefined);draw();},has:group=>ids.has(group.id),handleAt,beginTransform,transform,movable,move,startMarquee,moveMarquee,endMarquee,clearMarquee(){marquee=null;draw();},dispose(){cancelAnimationFrame(frame);svg.remove();}};
}
