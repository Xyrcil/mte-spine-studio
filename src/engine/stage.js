const s = () => window.spine;
const identity = () => [1, 0, 0, 1, 0, 0];
export function multiply(a, b) {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
export function unityTransform(data) {
  const q = data.m_LocalRotation || {x:0,y:0,z:0,w:1};
  const scale = data.m_LocalScale || {x:1,y:1};
  const p = data.m_LocalPosition || {x:0,y:0};
  return [(1-2*(q.y*q.y+q.z*q.z))*scale.x, 2*(q.x*q.y+q.w*q.z)*scale.x, 2*(q.x*q.y-q.w*q.z)*scale.y, (1-2*(q.x*q.x+q.z*q.z))*scale.y, p.x, p.y];
}

export class Stage extends EventTarget {
  constructor(canvas) {
    super();
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', {alpha:true, antialias:true, preserveDrawingBuffer:true});
    if (!this.gl) throw new Error('WebGL is unavailable');
    this.renderer = new (s().webgl.SceneRenderer)(canvas, this.gl);
    this.groups = [];
    this.paused = false;
    this.speed = 1;
    this.background = '#191b20';
    this.camera = {x:0,y:0,width:20,height:20};
    this.previous = performance.now();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.frame = requestAnimationFrame(time => this.tick(time));
  }
  resize() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    this.canvas.height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
  }
  async add(presentation, entries, signal) {
    const manager = new (s().webgl.AssetManager)(this.gl);
    const group = {id:crypto.randomUUID(), presentation, manager, layers:[], x:0, y:0, scale:1, visible:true};
    try {
      const base = `${import.meta.env.BASE_URL}assets/${presentation.path}/`;
      const byId = new Map(entries.map(entry => [entry.id, entry]));
      const tree = new Map(presentation.hierarchy.map(node => [node.id, node]));
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
        group.layers.push({instance, entry, atlas, source:skeleton, transform:world(instance.transform), active:true});
      }
      const deadline = performance.now() + 60000;
      while (!manager.isLoadingComplete()) {
        if (signal?.aborted) throw new DOMException('Loading cancelled', 'AbortError');
        if (performance.now() > deadline) throw new Error('Resource loading timed out');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      if (signal?.aborted) throw new DOMException('Loading cancelled', 'AbortError');
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
        layer.state.addListener({event:(track,event) => this.dispatchEvent(new CustomEvent('animation-event', {detail:{group:group.id, layer:layer.instance.id, track:track.trackIndex, name:event.data.name, time:event.time}}))});
        const name = layer.instance.animation;
        if (name && data.findAnimation(name)) layer.state.setAnimation(0, name, layer.instance.loop);
      }
      group.layers.sort((a,b) => a.instance.sortingOrder-b.instance.sortingOrder);
      this.groups.push(group);
      this.evaluate(0);
      this.fit();
      return group;
    } catch (error) {
      manager.dispose();
      throw error;
    }
  }
  evaluate(delta) {
    for (const group of this.groups) for (const layer of group.layers) {
      const sk = layer.skeleton;
      layer.state.update(delta * (layer.instance.timeScale ?? 1));
      layer.state.apply(sk);
      sk.updateWorldTransform();
      const m = multiply([group.scale,0,0,group.scale,group.x,group.y], layer.transform);
      for (const bone of sk.bones) {
        const a=bone.a,b=bone.b,c=bone.c,d=bone.d,x=bone.worldX,y=bone.worldY;
        bone.a=m[0]*a+m[2]*c; bone.b=m[0]*b+m[2]*d;
        bone.c=m[1]*a+m[3]*c; bone.d=m[1]*b+m[3]*d;
        bone.worldX=m[0]*x+m[2]*y+m[4]; bone.worldY=m[1]*x+m[3]*y+m[5];
      }
    }
  }
  fit() {
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const group of this.groups) for (const layer of group.layers) {
      const offset=new (s().Vector2)(), size=new (s().Vector2)();
      layer.skeleton.getBounds(offset,size,[]);
      if (![offset.x,offset.y,size.x,size.y].every(Number.isFinite)) continue;
      minX=Math.min(minX,offset.x); minY=Math.min(minY,offset.y);
      maxX=Math.max(maxX,offset.x+size.x); maxY=Math.max(maxY,offset.y+size.y);
    }
    if (Number.isFinite(minX)) this.camera={x:(minX+maxX)/2,y:(minY+maxY)/2,width:Math.max(1,maxX-minX)*1.15,height:Math.max(1,maxY-minY)*1.15};
  }
  draw() {
    const {gl,renderer,canvas}=this;
    gl.viewport(0,0,canvas.width,canvas.height);
    const hex=this.background.replace('#','');
    gl.clearColor(parseInt(hex.slice(0,2),16)/255,parseInt(hex.slice(2,4),16)/255,parseInt(hex.slice(4,6),16)/255,1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const aspect=canvas.width/canvas.height, width=Math.max(this.camera.width,this.camera.height*aspect);
    renderer.camera.viewportWidth=width; renderer.camera.viewportHeight=width/aspect;
    renderer.camera.position.x=this.camera.x; renderer.camera.position.y=this.camera.y;
    renderer.begin();
    for (const group of this.groups) if (group.visible) for (const layer of group.layers) if (layer.active) renderer.drawSkeleton(layer.skeleton,false);
    renderer.end();
  }
  tick(time) {
    const delta=Math.min((time-this.previous)/1000,.1); this.previous=time;
    this.evaluate(this.paused ? 0 : delta*this.speed); this.draw();
    this.frame=requestAnimationFrame(next => this.tick(next));
  }
  remove(id) {
    const index=this.groups.findIndex(group=>group.id===id);
    if (index<0) return;
    this.groups[index].manager.dispose(); this.groups.splice(index,1);
  }
  dispose() {
    cancelAnimationFrame(this.frame); this.resizeObserver.disconnect();
    for (const group of this.groups) group.manager.dispose();
    this.renderer.dispose();
  }
}
