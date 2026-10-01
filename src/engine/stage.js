import {validateScene} from './scene.js';
import {identity,multiply,unityTransform,objectTransform,point} from './geometry.js';
import {InteractionRoot} from './interaction.js';
import {captureAnimation,capturePose,assertCheckpoint,restoreAnimation,restorePose} from './animation-state.js';
import {initializeAnimation} from './initial-animation.js';
import {createParticleLayers,drawParticleLayer,particleOrder,preflightParticles,hierarchyOrder,compareDraws,particleQueue} from './particle-layer.js';
import {createNativeVisuals,drawNativeImage,preflightNativeAnimations} from './native-visuals.js';
import {MaskedParticleRenderer} from './masked-particles.js';
export {multiply,unityTransform,objectTransform} from './geometry.js';
const s = () => window.spine;
const APPLIED_FIELDS=['animation','trackTime','mixTime','mixDuration','alpha','loop','timeScale','animationStart','animationEnd'];

export class Stage extends EventTarget {
  constructor(canvas,options={}) {
    super();
    this.canvas = canvas;
    this.options=options;
    this.gl = canvas.getContext('webgl', {alpha:true, antialias:true, preserveDrawingBuffer:true});
    if (!this.gl) throw new Error('WebGL is unavailable');
    this.renderer = new (s().webgl.SceneRenderer)(canvas, this.gl);
    this.groups = [];
    this.imageAssets=new Map();
    this.paused = false;
    this.speed = 1;
    this.background = '#191b20';
    this.camera = {x:0,y:0,width:20,height:20};
    this.previous = performance.now();
    this.contextEpoch=0;this.contextLost=false;this.recoveryPending=false;this.disposed=false;
    this.contextAbort=new AbortController();
    this.onContextLost=event=>{
      event.preventDefault();this.contextEpoch++;
      this.contextLost=true;this.recoveryPending=true;this.dispatchEvent(new CustomEvent('rendering-pausing'));
      if(!this.recoverySnapshot){this.recoverySnapshot=this.captureScene?.()||this.snapshot();if(this.loadingRestorePaused!==undefined)this.recoverySnapshot.paused=this.loadingRestorePaused;this.recoveryInputs={presentations:this.groups.filter(group=>group.kind==='spine').map(group=>group.presentation),entries:this.groups.flatMap(group=>group.layers.map(layer=>layer.entry))};}
      this.contextAbort.abort();this.paused=true;this.dispatchEvent(new CustomEvent('rendering-lost'));
    };
    this.onContextRestored=async()=>{this.contextLost=false;this.contextAbort=new AbortController();if(options.manual)return;try{await this.recoveryPromise;}catch{}if(this.recoveryPending&&!this.contextLost&&!this.disposed)this.recoverRendering().catch(()=>{});};
    canvas.addEventListener('webglcontextlost',this.onContextLost);canvas.addEventListener('webglcontextrestored',this.onContextRestored);
    if(!options.manual){this.resizeObserver = new ResizeObserver(() => this.resize());this.resizeObserver.observe(canvas);this.frame = requestAnimationFrame(time => this.tick(time));}
  }
  resize() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    this.canvas.height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
  }
  async add(presentation, entries, signal,detached=false) {
    if(this.contextLost||this.disposed)throw new DOMException('Rendering context is unavailable','AbortError');
    const contextEpoch=this.contextEpoch;
    const manager = new (s().webgl.AssetManager)(this.gl);
    this.activeLoads=(this.activeLoads||0)+1;
    const group = {id:crypto.randomUUID(),kind:'spine', name:presentation.label||presentation.id, presentation, manager, layers:[], x:0, y:0, scale:1, rotation:0, opacity:1, flipX:false, flipY:false, locked:false, visible:true};
    try {
      const base = `${import.meta.env.BASE_URL}assets/${presentation.path}/`;
      const byId = new Map(entries.map(entry => [entry.id, entry]));
      const tree = new Map(structuredClone(presentation.hierarchy).map(node => [node.id, node]));
      const world = (id, seen = new Set()) => {
        if (!id || id === '0') return identity();
        if (seen.has(id)) throw new Error('Cyclic transform hierarchy');
        seen.add(id);
        const node = tree.get(id);
        if (!node) return identity();
        return multiply(world(String(node.data.m_Father?.m_PathID || '0'), seen), unityTransform(node.data));
      };
      const isActive = (id, seen = new Set()) => {
        if (!id || id === '0') return true;
        if (seen.has(id)) throw new Error('Cyclic transform hierarchy');
        seen.add(id);
        const transform = tree.get(id);
        if (!transform) return true;
        const go = tree.get(String(transform.data.m_GameObject?.m_PathID));
        return Boolean(go?.data.m_IsActive ?? true) && isActive(String(transform.data.m_Father?.m_PathID || '0'), seen);
      };
      group.nodes=tree;group.transforms=new Map([...tree.values()].filter(node=>node.type.includes('Transform')).map(node=>[String(node.data.m_GameObject?.m_PathID),node]));group.world=world;group.isActiveTransform=isActive;
      const instances = presentation.instances.filter(instance => isActive(instance.transform));
      for (const instance of instances) {
        const entry = byId.get(instance.skeletonId);
        if (!entry || entry.status !== 'parsed') throw new Error(`Missing skeleton ${instance.name}`);
        if (!entry.version.startsWith('3.8.')) throw new Error(`Unsupported Spine version ${entry.version}`);
        const atlas = `${base}${entry.id}/${entry.atlases[0].atlas}`;
        const skeleton = `${base}${entry.skeleton}`;
        if (entry.skeleton.endsWith('.json')) manager.loadText(skeleton);
        else manager.loadBinary(skeleton);
        manager.loadTextureAtlas(atlas);
        group.layers.push({instance, entry, atlas, source:skeleton, transform:world(instance.transform), active:instance.active!==false});
      }
      group.effects=createParticleLayers(group,base,manager);
      if(group.effects.some(effect=>effect.maskedProfile))group.maskedRenderer=new MaskedParticleRenderer(this.gl);
      createNativeVisuals(group,base,manager);
      const deadline = performance.now() + 60000;
      while (!manager.isLoadingComplete()) {
        if(this.contextLost||this.disposed||contextEpoch!==this.contextEpoch)throw new DOMException('Rendering context is unavailable','AbortError');
        if(manager.hasErrors())throw new Error(JSON.stringify(manager.getErrors()));
        if (signal?.aborted) throw new DOMException('Loading cancelled', 'AbortError');
        if (performance.now() > deadline) throw new Error('Resource loading timed out');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      if (signal?.aborted) throw new DOMException('Loading cancelled', 'AbortError');
      if(this.contextLost||this.disposed||contextEpoch!==this.contextEpoch)throw new DOMException('Rendering context is unavailable','AbortError');
      if (manager.hasErrors()) throw new Error(JSON.stringify(manager.getErrors()));
      for (const layer of group.layers) {
        const loader = new (s().AtlasAttachmentLoader)(manager.get(layer.atlas));
        const reader = layer.entry.skeleton.endsWith('.json') ? new (s().SkeletonJson)(loader) : new (s().SkeletonBinary)(loader);
        reader.scale = layer.entry.scale;
        const data = reader.readSkeletonData(layer.entry.skeleton.endsWith('.json') ? JSON.parse(manager.get(layer.source)) : manager.get(layer.source));
        layer.skeleton = new (s().Skeleton)(data);
        if (layer.instance.skin) layer.skeleton.setSkinByName(layer.instance.skin);
        layer.skeleton.scaleX = layer.instance.flipX ? -1 : 1;
        layer.skeleton.scaleY = layer.instance.flipY ? -1 : 1;
        const mix = new (s().AnimationStateData)(data);
        mix.defaultMix = layer.entry.defaultMix;
        layer.entry.mixes.fromAnimation.forEach((name,index) => mix.setMix(name, layer.entry.mixes.toAnimation[index], layer.entry.mixes.duration[index]));
        layer.state = new (s().AnimationState)(mix);
        layer.state.addListener({event:(track,event) => {
          if(this.suppressEvents)return;
          for(const root of group.controllers||[])root.onEvent(layer,track,event);
          this.dispatchEvent(new CustomEvent('animation-event', {detail:{group:group.id, layer:layer.instance.id, track:track.trackIndex, name:event.data.name, time:event.time,int:event.intValue,float:event.floatValue,string:event.stringValue}}));
        }});
        initializeAnimation(layer,{interactive:presentation.controllers.length>0});
      }
      group.layers.sort((a,b) => a.instance.sortingOrder-b.instance.sortingOrder);
      group.controllers=presentation.controllers.filter(source=>source.data.m_Enabled!==0).map(source=>new InteractionRoot(this,group,source));
      if(!detached){this.groups.push(group);this.evaluate(0);this.fit();}
      return group;
    } catch (error) {
      group.maskedRenderer?.dispose();
      manager.dispose();
      throw error;
    }finally{this.activeLoads--;}
  }
  evaluate(delta) {
    if(this.sequencePlayer){
      try{this.sequencePlayer.advance(delta,value=>this.evaluateFrame(value));}
      catch(error){this.sequencePlayer=null;this.paused=true;this.dispatchEvent(new CustomEvent('sequence-error',{detail:error.message}));}
    }else this.evaluateFrame(delta);
    if(delta>0)this.dispatchEvent(new CustomEvent('simulation-step',{detail:{delta}}));
  }
  evaluateFrame(delta) {
    for(const group of this.groups)if(group.visible)for(const native of group.nativeAnimations||[])if(native.model&&native.source.data.m_Enabled!==0&&native.source.data.m_Enabled!==false&&group.isActiveTransform(group.transforms.get(String(native.source.data.m_GameObject.m_PathID))?.id))native.model.advance(delta);
    if(delta>0)for(const group of this.groups)if(group.visible)for(const effect of group.effects||[])if(effect.model&&group.isActiveTransform(effect.source.transform))effect.model.advance(delta);
    for(const group of this.groups)for(const root of group.controllers||[])root.advance(delta);
    for (const group of this.groups.filter(group=>group.kind==='spine')) for (const layer of group.layers) {
      const sk = layer.skeleton;
      const dirty=layer.state.animationsChanged!==layer.appliedChanged||!layer.appliedTracks||layer.appliedTracks.length!==layer.state.tracks.length||layer.state.tracks.some((track,index)=>track?APPLIED_FIELDS.some(key=>layer.appliedTracks[index]?.[key]!==track[key]):layer.appliedTracks[index]!==null);
      if(delta!==0||dirty){layer.state.update(delta * (layer.instance.timeScale ?? 1));layer.state.apply(sk);this.recordApplied(layer);}
      this.transformLayer(group,layer);
    }
  }
  recordApplied(layer){layer.appliedChanged=layer.state.animationsChanged;layer.appliedTracks=Array.from(layer.state.tracks,track=>track?Object.fromEntries(APPLIED_FIELDS.map(key=>[key,track[key]])):null);}
  transformLayer(group,layer){
      const sk=layer.skeleton;sk.updateWorldTransform();
      const m = multiply(objectTransform(group), layer.transform);
      for (const bone of sk.bones) {
        const a=bone.a,b=bone.b,c=bone.c,d=bone.d,x=bone.worldX,y=bone.worldY;
        bone.a=m[0]*a+m[2]*c; bone.b=m[0]*b+m[2]*d;
        bone.c=m[1]*a+m[3]*c; bone.d=m[1]*b+m[3]*d;
        bone.worldX=m[0]*x+m[2]*y+m[4]; bone.worldY=m[1]*x+m[3]*y+m[5];
      }
  }
  setImageAssets(entries){this.imageAssets=new Map(entries.flatMap(entry=>entry.sprites.map(sprite=>[sprite.path,sprite])));}
  async addPortrait(asset,name,appearanceId,signal,detached=false){
    const sprite=this.imageAssets.get(asset);if(!sprite)throw new Error(`Portrait unavailable: ${asset}`);
    const group=await this.addImage(`${import.meta.env.BASE_URL}assets/${asset}`,name,true);
    if(signal?.aborted){this.release(group);throw new DOMException('Loading cancelled','AbortError');}
    group.asset=asset;if(appearanceId!==undefined)group.appearanceId=appearanceId;
    const density=sprite.pixelsPerUnit>0?sprite.pixelsPerUnit:100;group.width=sprite.width/density;group.height=sprite.height/density;
    if(!detached){this.groups.push(group);this.fit();}return group;
  }
  async addImage(src,name='Background image',detached=false) {
    const contextEpoch=this.contextEpoch,image=new Image(),signal=this.contextAbort?.signal;let timer,cancel;
    this.activeLoads=(this.activeLoads||0)+1;
    try{image.src=src;await Promise.race([image.decode(),new Promise((_resolve,reject)=>{cancel=()=>{image.src='';reject(new DOMException('Rendering context is unavailable','AbortError'));};signal?.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>{image.src='';reject(new Error('Image loading timed out'));},60000);if(signal?.aborted)cancel();})]);
    if(this.contextLost||this.disposed||contextEpoch!==this.contextEpoch)throw new DOMException('Rendering context is unavailable','AbortError');
    const width=this.camera.width,height=width*image.naturalHeight/image.naturalWidth;
    const texture=new (s().webgl.GLTexture)(this.gl,image);
    const group={id:crypto.randomUUID(),kind:'image',src,name,texture,width,height,x:this.camera.x,y:this.camera.y,scale:1,rotation:0,opacity:1,flipX:false,flipY:false,visible:true,locked:false,layers:[]};
    if(!detached)this.groups.unshift(group);return group;
    }finally{clearTimeout(timer);if(cancel)signal?.removeEventListener('abort',cancel);this.activeLoads--;}
  }
  snapshot(name='Untitled scene') {
    if(this.recoveryPending&&this.recoverySnapshot)return {...structuredClone(this.recoverySnapshot),name};
    return {schema:1,name,background:this.background,camera:{...this.camera},speed:this.speed,paused:this.paused,...(this.sequence?{sequence:structuredClone(this.sequence)}:{}),...(this.captureAudio?{audio:this.captureAudio()}:{}),objects:this.groups.map(group=>{
      const row={id:group.id,kind:group.kind,name:group.name,x:group.x,y:group.y,scale:group.scale,rotation:group.rotation,opacity:group.opacity,flipX:group.flipX,flipY:group.flipY,visible:group.visible,locked:group.locked};
      if(group.kind==='image')return {...row,...(group.asset?{asset:group.asset}:{src:group.src}),...(group.appearanceId!==undefined?{appearanceId:group.appearanceId}:{}),width:group.width,height:group.height};
      return {...row,bundle:group.presentation.id,...(group.nativeAnimations?.some(native=>native.model)?{nativeAnimations:group.nativeAnimations.filter(native=>native.model).map(native=>native.model.snapshot())}:{}),...(group.effects?.length?{effects:group.effects.filter(effect=>effect.model).map(effect=>effect.model.snapshot())}:{}),interactions:(group.controllers||[]).map(root=>({id:root.source.id,state:root.snapshot()})),layers:group.layers.map(layer=>({id:layer.instance.id,active:layer.active,animationState:captureAnimation(layer.state),pose:capturePose(layer.skeleton),tracks:layer.state.tracks.flatMap((track,index)=>track?[{index,name:track.animation.name,time:track.trackTime,loop:track.loop,timeScale:track.timeScale}]:[])}))};
    })};
  }
  async restore(scene,presentations,entries,signal) {
    if(this.contextLost||this.disposed)throw new Error('Rendering context is unavailable');
    const contextEpoch=this.contextEpoch;
    scene=validateScene(scene);
    const old=[...this.groups],camera={...this.camera},previousPaused=this.paused;this.paused=true;
    this.loadingRestorePaused=previousPaused;
    const created=[];
    try {
      for(const row of scene.objects){
        if(row.kind==='image'&&row.asset&&!this.imageAssets.has(row.asset))throw new Error(`Portrait unavailable: ${row.asset}`);
        const group=old.find(group=>group.id===row.id && group.kind===row.kind && (row.kind==='image'?row.asset?group.asset===row.asset:!group.asset&&group.src===row.src:group.presentation.id===row.bundle));
        if(group){created.push(group);continue;}
        if(row.kind==='image')created.push(row.asset?await this.addPortrait(row.asset,row.name,row.appearanceId,signal,true):await this.addImage(row.src,row.name,true));
        else {
          const presentation=presentations.find(item=>item.id===row.bundle);if(!presentation)throw new Error(`Scene asset unavailable: ${row.bundle}`);
          created.push(await this.add(presentation,entries.filter(entry=>entry.bundle===row.bundle),signal,true));
        }
      }
      if(signal?.aborted)throw new DOMException('Loading cancelled','AbortError');
      if(contextEpoch!==this.contextEpoch)throw new DOMException('Rendering was interrupted while loading','AbortError');
      scene.objects.forEach((row,index)=>{
        const group=created[index];
        if(group.kind==='image')return;
        preflightParticles(group,row.effects);
        preflightNativeAnimations(group,row.nativeAnimations);
        if(row.layers.length!==group.layers.length)throw new Error('Scene layer count does not match asset');
        for(const state of row.layers){const layer=group.layers.find(layer=>layer.instance.id===state.id);if(!layer)throw new Error(`Scene layer unavailable: ${state.id}`);for(const track of state.tracks)if(track.name!=='<empty>'&&!layer.skeleton.data.findAnimation(track.name))throw new Error(`Scene animation unavailable: ${track.name}`);assertCheckpoint(layer,state.animationState,state.pose);}
        for(const state of row.interactions||[])if(!group.controllers?.some(root=>root.source.id===state.id))throw new Error(`Scene interaction unavailable: ${state.id}`);
      });
      scene.objects.forEach((row,index)=>{const group=created[index];for(const key of ['id','name','x','y','scale','rotation','opacity','flipX','flipY','visible','locked'])group[key]=row[key];if(group.kind==='image'){group.width=row.width;group.height=row.height;group.appearanceId=row.appearanceId;}});
      this.suppressEvents=true;
      try{scene.objects.forEach((row,index)=>{const group=created[index];if(group.kind==='spine')for(const saved of row.layers){const layer=group.layers.find(layer=>layer.instance.id===saved.id);layer.active=saved.active;if(saved.animationState){restoreAnimation(layer.state,saved.animationState);restorePose(layer.skeleton,saved.pose);}else{layer.state.clearTracks();layer.skeleton.setToSetupPose();for(const track of saved.tracks){const entry=track.name==='<empty>'?layer.state.setEmptyAnimation(track.index,0):layer.state.setAnimation(track.index,track.name,track.loop);entry.trackTime=track.time;entry.timeScale=track.timeScale;}layer.state.update(0);layer.state.apply(layer.skeleton);}this.recordApplied(layer);this.transformLayer(group,layer);}});}finally{this.suppressEvents=false;}
      scene.objects.forEach((row,index)=>{for(const root of created[index].controllers||[]){const state=row.interactions?.find(state=>state.id===root.source.id);if(state)root.restore(state.state);else root.reset();}});
      scene.objects.forEach((row,index)=>{for(const effect of created[index].effects||[])if(effect.model){const saved=row.effects?.find(saved=>saved.id===effect.source.id);if(saved)effect.model.restore(saved);else effect.model=effect.make(effect.model.seed);}});
      scene.objects.forEach((row,index)=>{for(const native of created[index].nativeAnimations||[])if(native.model){const saved=row.nativeAnimations?.find(saved=>saved.id===native.source.id)||{...native.model.snapshot(),time:0,playing:Boolean(native.source.data.m_PlayAutomatically)};native.model.restore(saved);}});
      for(const group of old)if(!created.includes(group))this.release(group);
      this.groups=created;this.camera={...scene.camera};this.background=scene.background;this.speed=scene.speed;this.paused=scene.paused;
      this.draw();
    }catch(error){for(const group of created)if(!old.includes(group))this.release(group);this.groups=old;this.camera=camera;this.paused=previousPaused;throw error;}finally{delete this.loadingRestorePaused;}
    this.applyAudio?.(scene.audio);
    this.sequence=scene.sequence;this.dispatchEvent(new CustomEvent('sequence-loaded'));
  }
  recoverRendering(){
    if(this.recoveryPromise)return this.recoveryPromise;
    if(!this.recoveryPending)return Promise.resolve();
    if(this.contextLost||this.gl.isContextLost())return Promise.reject(new Error('The browser has not restored rendering yet. Save the scene and retry later.'));
    const epoch=this.contextEpoch;
    this.recoveryPromise=(async()=>{
      this.dispatchEvent(new CustomEvent('rendering-recovering'));
      while(this.activeLoads){await new Promise(resolve=>setTimeout(resolve,20));if(epoch!==this.contextEpoch||this.disposed)throw new Error('Rendering was interrupted during recovery');}
      for(const group of this.groups)this.release(group);this.groups=[];this.renderer.dispose();this.renderer=new (s().webgl.SceneRenderer)(this.canvas,this.gl);
      await this.restore(this.recoverySnapshot,this.recoveryInputs.presentations,this.recoveryInputs.entries);
      if(this.disposed||this.contextLost||epoch!==this.contextEpoch)throw new Error('Rendering was interrupted during recovery');
      this.previous=performance.now();this.recoveryPending=false;this.recoverySnapshot=null;this.recoveryInputs=null;this.dispatchEvent(new CustomEvent('rendering-recovered'));
    })().catch(error=>{if(!this.contextLost&&!this.disposed)this.dispatchEvent(new CustomEvent('rendering-recovery-error',{detail:error.message}));throw error;}).finally(()=>this.recoveryPromise=null);
    return this.recoveryPromise;
  }
  release(group){group.maskedRenderer?.dispose();if(group.kind==='image')group.texture.dispose();else group.manager.dispose();}
  screenToWorld(clientX,clientY){const rect=this.canvas.getBoundingClientRect(),aspect=rect.width/rect.height,width=Math.max(this.camera.width,this.camera.height*aspect);return {x:this.camera.x+((clientX-rect.left)/rect.width-.5)*width,y:this.camera.y+(.5-(clientY-rect.top)/rect.height)*width/aspect};}
  interact(clientX,clientY){
    if(this.recoveryPending)return {accepted:false,reason:'Rendering is recovering'};
    if(this.paused)return {accepted:false,reason:'Playback is paused'};
    const {x,y}=this.screenToWorld(clientX,clientY);
    for(const group of [...this.groups].reverse())if(group.visible)for(const root of group.controllers||[]){const hit=root.hitAt(x,y);if(hit)return this.triggerInteraction(group.id,root.source.id,hit.id);}
    return {accepted:false,reason:'No interaction region here'};
  }
  triggerInteraction(groupId,controllerId,hitId,{replay=false}={}){
    if(this.recoveryPending)return {accepted:false,reason:'Rendering is recovering'};
    if(this.sequencePlayer&&!replay)return {accepted:false,reason:'Stop sequence playback before interacting'};
    const group=this.groups.find(group=>group.id===groupId&&group.visible);
    const root=group?.controllers?.find(root=>root.source.id===controllerId);
    const hit=root?.hotspots.find(hit=>hit.id===hitId&&group.isActiveTransform(hit.transform));
    if(!hit)return {accepted:false,reason:'Interaction target is unavailable'};
    const result={...root.click(hit),group:groupId,controller:controllerId,hit:hitId};
    if(result.accepted&&!replay)this.dispatchEvent(new CustomEvent('interaction-invoked',{detail:result}));
    return result;
  }
  hitTest(clientX,clientY){
    const {x,y}=this.screenToWorld(clientX,clientY);
    for(const group of [...this.groups].reverse())if(group.visible){
      if(group.kind==='image'){
        const m=objectTransform(group),det=m[0]*m[3]-m[1]*m[2],dx=x-m[4],dy=y-m[5],localX=(m[3]*dx-m[2]*dy)/det,localY=(-m[1]*dx+m[0]*dy)/det;
        if(Math.abs(localX)<=group.width/2&&Math.abs(localY)<=group.height/2)return group;
      }else for(const layer of group.layers.filter(layer=>layer.active)){
        const offset=new (s().Vector2)(),size=new (s().Vector2)();layer.skeleton.getBounds(offset,size,[]);
        if(x>=offset.x&&x<=offset.x+size.x&&y>=offset.y&&y<=offset.y+size.y)return group;
      }
    }return null;
  }
  fit() {
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const group of this.groups.filter(group=>group.visible&&group.kind==='image'))for(const x of [-group.width/2,group.width/2])for(const y of [-group.height/2,group.height/2]){const p=point(objectTransform(group),x,y);minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
    for (const group of this.groups.filter(group=>group.visible&&group.kind==='spine')) for (const layer of group.layers.filter(layer=>layer.active)) {
      const offset=new (s().Vector2)(), size=new (s().Vector2)();
      layer.skeleton.getBounds(offset,size,[]);
      if (![offset.x,offset.y,size.x,size.y].every(Number.isFinite)) continue;
      minX=Math.min(minX,offset.x); minY=Math.min(minY,offset.y);
      maxX=Math.max(maxX,offset.x+size.x); maxY=Math.max(maxY,offset.y+size.y);
    }
    if (Number.isFinite(minX)) this.camera={x:(minX+maxX)/2,y:(minY+maxY)/2,width:Math.max(1,maxX-minX)*1.15,height:Math.max(1,maxY-minY)*1.15};
  }
  draw() {
    if(this.contextLost||this.disposed)return;
    const {gl,renderer,canvas}=this;
    gl.viewport(0,0,canvas.width,canvas.height);
    const hex=this.background.replace('#','');
    gl.disable(gl.SCISSOR_TEST);
    if(this.options.transparent)gl.clearColor(0,0,0,0);else gl.clearColor(parseInt(hex.slice(0,2),16)/255,parseInt(hex.slice(2,4),16)/255,parseInt(hex.slice(4,6),16)/255,1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if(this.options.clip){const clip=this.options.clip;gl.enable(gl.SCISSOR_TEST);gl.scissor(clip.x,clip.y,clip.width,clip.height);}
    const aspect=canvas.width/canvas.height, width=Math.max(this.camera.width,this.camera.height*aspect);
    renderer.camera.viewportWidth=width; renderer.camera.viewportHeight=width/aspect;
    renderer.camera.position.x=this.camera.x; renderer.camera.position.y=this.camera.y;
    renderer.begin();
    for (const group of this.groups) if(group.visible) {
      if(group.kind==='image'){
        const width=group.width*group.scale*(group.flipX?-1:1),height=group.height*group.scale*(group.flipY?-1:1);
        renderer.drawTextureRotated(group.texture,group.x-width/2,group.y-height/2,width,height,width/2,height/2,group.rotation,new (s().Color)(1,1,1,group.opacity),false);
      }else{
        const draws=[...group.layers.map(layer=>({order:layer.instance.sortingOrder,queue:layer.instance.renderQueue,path:hierarchyOrder(group,layer.instance.transform),layer})),...(group.effects||[]).map(effect=>({order:particleOrder(group,effect.source),queue:particleQueue(effect.source),path:hierarchyOrder(group,effect.source.transform),effect})),...(group.nativeImages||[]).filter(image=>image.used).map(image=>({order:0,path:hierarchyOrder(group,image.source.transform),image}))].sort(compareDraws);
        for(const draw of draws)if(draw.image)drawNativeImage(renderer,group,draw.image);else if(draw.effect)drawParticleLayer(renderer,group,draw.effect,this.options.maskCamera);else if(draw.layer.active){draw.layer.skeleton.color.a=group.opacity;renderer.drawSkeleton(draw.layer.skeleton,false);}
      }
    }
    renderer.end();
    gl.disable(gl.SCISSOR_TEST);
  }
  tick(time) {
    const delta=Math.min((time-this.previous)/1000,.1); this.previous=time;
    if(!this.recoveryPending){this.evaluate(this.paused ? 0 : delta*this.speed);this.draw();}
    this.frame=requestAnimationFrame(next => this.tick(next));
  }
  remove(id) {
    const index=this.groups.findIndex(group=>group.id===id);
    if (index<0) return;
    this.release(this.groups[index]); this.groups.splice(index,1);
  }
  dispose() {
    this.contextAbort.abort();
    this.disposed=true;this.canvas.removeEventListener('webglcontextlost',this.onContextLost);this.canvas.removeEventListener('webglcontextrestored',this.onContextRestored);
    cancelAnimationFrame(this.frame); this.resizeObserver?.disconnect();
    for (const group of this.groups) this.release(group);
    this.renderer.dispose();
  }
}
