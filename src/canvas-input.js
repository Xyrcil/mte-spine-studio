export function worldAt(camera,rect,x,y){const width=Math.max(camera.width,camera.height*rect.width/rect.height),height=width*rect.height/rect.width;return {x:camera.x+((x-rect.left)/rect.width-.5)*width,y:camera.y+(.5-(y-rect.top)/rect.height)*height};}
export function panCamera(camera,rect,dx,dy){const width=Math.max(camera.width,camera.height*rect.width/rect.height);return {...camera,x:camera.x-dx*width/rect.width,y:camera.y+dy*width/rect.width};}
export function zoomCameraAt(camera,rect,x,y,factor){
  if(!Number.isFinite(factor)||factor<=0)throw new Error('Invalid camera zoom');
  factor=Math.max(.01/Math.min(camera.width,camera.height),Math.min(1e6/Math.max(camera.width,camera.height),factor));
  const before=worldAt(camera,rect,x,y),next={...camera,width:camera.width*factor,height:camera.height*factor},after=worldAt(next,rect,x,y);next.x+=before.x-after.x;next.y+=before.y-after.y;return next;
}

export function createCanvasInput(stage,editor,{getView,isRecording=()=>false,onInteraction=()=>{},getTool=()=> 'auto'}){
  const canvas=stage.canvas,pointers=new Map();let action,space=false,wheelTimer,wheelChanged=false;
  const canEdit=()=>!editor.busy&&getView()!=='export';
  const rect=()=>canvas.getBoundingClientRect();
  const commit=()=>{if(action?.changed)editor.changed();};
  const flushWheel=()=>{clearTimeout(wheelTimer);if(wheelChanged){wheelChanged=false;editor.changed();}};
  const clear=()=>{commit();action=null;const ids=[...pointers.keys()];pointers.clear();for(const id of ids)try{canvas.releasePointerCapture(id);}catch{}flushWheel();};
  const beginChange=()=>{if(action.changed)return true;if(!editor.before())return false;action.changed=true;return true;};
  const down=event=>{
    const editable=canEdit(),recording=getView()==='gallery'&&isRecording();if(!editable&&!recording||event.button>1)return;
    canvas.focus({preventScroll:true});event.preventDefault();flushWheel();pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});try{canvas.setPointerCapture(event.pointerId);}catch{}
    if(pointers.size>2){commit();action={kind:'blocked'};return;}
    if(action?.kind==='blocked'&&pointers.size>1)return;
    if(pointers.size===2){
      if(!editable){action={kind:'blocked'};return;}
      if(action?.group&&action.changed){action.group.x=action.object.x;action.group.y=action.object.y;}
      const [a,b]=[...pointers.values()];action={kind:'pinch',camera:{...stage.camera},rect:rect(),center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance:Math.max(2,Math.hypot(a.x-b.x,a.y-b.y)),changed:action?.changed||false};return;
    }
    const pan=event.button===1||event.altKey||space||getTool()==='pan';if(pan&&!editable){action={kind:'blocked'};return;}
    const group=!pan&&getView()==='studio'?stage.hitTest(event.clientX,event.clientY):null;if(group)editor.choose(group);
    action={kind:pan||getView()==='studio'&&!group?'pan':getView()==='gallery'?'tap':group?.locked?'blocked':'object',id:event.pointerId,x:event.clientX,y:event.clientY,camera:{...stage.camera},rect:rect(),group,object:group?{x:group.x,y:group.y}:null,changed:false,recording};
  };
  const move=event=>{
    if(!pointers.has(event.pointerId)||!action)return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(action.kind==='blocked')return;if(!canEdit()){if(Math.hypot(event.clientX-action.x,event.clientY-action.y)>6)action.kind='blocked';return;}
    if(action.kind==='pinch'){
      const [a,b]=[...pointers.values()];if(!a||!b)return;const center={x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance=Math.max(2,Math.hypot(a.x-b.x,a.y-b.y));if(!beginChange())return;
      const zoom=zoomCameraAt(action.camera,action.rect,action.center.x,action.center.y,action.distance/distance);stage.camera=panCamera(zoom,action.rect,center.x-action.center.x,center.y-action.center.y);return;
    }
    const dx=event.clientX-action.x,dy=event.clientY-action.y;if(!action.changed&&Math.hypot(dx,dy)<=6)return;
    if(action.kind==='tap')action.kind='pan';if(!beginChange())return;
    if(action.kind==='pan')stage.camera=panCamera(action.camera,action.rect,dx,dy);
    else if(action.kind==='object'){const moved=panCamera(action.camera,action.rect,dx,dy);action.group.x=action.object.x+action.camera.x-moved.x;action.group.y=action.object.y+action.camera.y-moved.y;}
  };
  const up=event=>{
    if(!pointers.has(event.pointerId))return;pointers.delete(event.pointerId);if(!action)return;
    if(event.type==='pointerup'&&action.kind==='tap'&&!action.changed&&Math.hypot(event.clientX-action.x,event.clientY-action.y)<=6&&getView()==='gallery'&&(!editor.busy||isRecording())){const bounds=rect();if(event.clientX>=bounds.left&&event.clientX<=bounds.right&&event.clientY>=bounds.top&&event.clientY<=bounds.bottom)onInteraction(stage.interact(event.clientX,event.clientY));}
    commit();action=pointers.size?{kind:'blocked'}:null;try{canvas.releasePointerCapture(event.pointerId);}catch{}
  };
  const wheel=event=>{event.preventDefault();if(!canEdit())return;const bounds=rect(),delta=event.deltaY*(event.deltaMode===1?40:event.deltaMode===2?bounds.height:1);if(!Number.isFinite(delta)||delta===0)return;if(!wheelChanged){if(!editor.before())return;wheelChanged=true;}stage.camera=zoomCameraAt(stage.camera,bounds,event.clientX,event.clientY,Math.exp(Math.max(-1000,Math.min(1000,delta))*.001));clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{wheelChanged=false;editor.changed();},150);};
  const keyDown=event=>{
    if(event.ctrlKey||event.metaKey)return;
    if(event.code==='Space'){space=true;event.preventDefault();return;}if(!canEdit())return;
    const bounds=rect(),directions={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]};if(!directions[event.key]&&!['+','=','-','Home'].includes(event.key))return;event.preventDefault();if(!editor.before())return;
    if(directions[event.key])stage.camera=panCamera(stage.camera,bounds,...directions[event.key]);else if(event.key==='Home')stage.fit();else stage.camera=zoomCameraAt(stage.camera,bounds,bounds.left+bounds.width/2,bounds.top+bounds.height/2,event.key==='-'?1.2:1/1.2);editor.changed();
  };
  const keyUp=event=>{if(event.code==='Space')space=false;},blur=()=>{space=false;clear();};
  const document=canvas.ownerDocument;
  const globalSpace=event=>{if(event.ctrlKey||event.metaKey||event.code!=='Space'||event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;if(event.target===canvas||canvas.matches(':hover')){space=true;event.preventDefault();}};
  document?.addEventListener('keydown',globalSpace);document?.addEventListener('keyup',keyUp);document?.defaultView?.addEventListener('blur',blur);
  canvas.tabIndex=0;canvas.setAttribute('aria-description','Drag to pan in Gallery. In Studio, drag objects or empty space. Pinch or scroll to zoom. Arrow keys pan; plus and minus zoom; Home fits the scene.');
  for(const [name,handler] of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['lostpointercapture',up],['wheel',wheel],['keydown',keyDown],['keyup',keyUp],['blur',blur]])canvas.addEventListener(name,handler,{passive:false});
  const resetEvents=['rendering-pausing','scene-ready','sequence-playing','sequence-loaded'];
  for(const name of resetEvents)stage.addEventListener(name,clear);
  return {clear,dispose(){clear();document?.removeEventListener('keydown',globalSpace);document?.removeEventListener('keyup',keyUp);document?.defaultView?.removeEventListener('blur',blur);for(const name of resetEvents)stage.removeEventListener(name,clear);for(const [name,handler] of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['lostpointercapture',up],['wheel',wheel],['keydown',keyDown],['keyup',keyUp],['blur',blur]])canvas.removeEventListener(name,handler);}};
}
