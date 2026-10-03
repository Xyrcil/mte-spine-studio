import {History,validateScene,saveLocalScene,loadLocalScene,listLocalScenes,deleteLocalScene} from './engine/scene.js';

export function createEditor(stage,message,onSelection){
  const history=new History(),container=document.querySelector('#layers');
  let selectedId,name='Untitled scene',catalog=[],entries=[],busy=false,timer,saveQueue=Promise.resolve();
  const snapshot=()=>stage.snapshot(name);
  stage.captureScene=snapshot;
  const controls=document.createElement('section');controls.className='scene-controls';
  controls.innerHTML=`<label>Scene name <input id="scene-name" value="Untitled scene" maxlength="512"></label><div class="actions"><button id="undo">Undo</button><button id="redo">Redo</button></div><div class="actions"><button id="save-scene">Save locally</button><button id="download-scene">Export scene</button><button id="import-scene">Import scene</button></div><label>Saved scenes <select id="saved-scenes"><option value="">Choose a scene</option></select></label><div class="actions"><button id="load-scene">Load</button><button id="delete-scene">Delete saved</button></div><button id="add-background">Add background image</button><input id="scene-file" type="file" accept="application/json,.json" hidden><input id="background-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>`;
  document.querySelector('.inspector h2').after(controls);
  const selected=()=>stage.groups.find(group=>group.id===selectedId);
  const isBusy=()=>busy||stage.recoveryPending||Boolean(stage.sequenceBusy)||Boolean(stage.resourceImportBusy)||Boolean(stage.packReloadRequired);
  const before=()=>{if(isBusy())return false;history.push(snapshot());return true;};
  function changed(detail){stage.dispatchEvent(new CustomEvent('scene-change',{detail}));refresh();clearTimeout(timer);timer=setTimeout(()=>{const scene=snapshot();saveQueue=saveQueue.catch(()=>{}).then(()=>saveLocalScene(scene)).catch(error=>message(`Autosave failed: ${error.message}`));},350);}
  function mutate(action){if(!before())return;action();changed();}
  const input=(label,type,value,change,options={})=>{
    const wrapper=document.createElement('label');wrapper.textContent=label;
    const field=document.createElement('input');field.type=type;if(type==='checkbox')field.checked=value;else field.value=value;
    Object.assign(field,options);field.onchange=()=>{const result=type==='checkbox'?field.checked:type==='number'?Number(field.value):field.value;if(type==='number'&&(!Number.isFinite(result)||!field.checkValidity())){refresh();return;}mutate(()=>change(result));};
    wrapper.append(field);return wrapper;
  };
  const button=(title,action)=>{const node=document.createElement('button');node.textContent=title;node.onclick=()=>mutate(action);return node;};
  function choose(group){selectedId=group?.id;refresh();onSelection?.(group);}
  function refresh(){
    container.replaceChildren();
    for(const group of [...stage.groups].reverse()){
      const row=document.createElement('div');row.className=`layer ${group.id===selectedId?'selected':''}`;
      const title=document.createElement('button');title.textContent=group.name;title.setAttribute('aria-pressed',String(group.id===selectedId));title.onclick=()=>choose(group);
      row.append(title,button('Remove',()=>{stage.remove(group.id);if(group.id===selectedId)selectedId=stage.groups.at(-1)?.id;}));container.append(row);
    }
    const group=selected();
    if(group){const panel=document.createElement('section');panel.className='object-controls';
      panel.append(input('Object name','text',group.name,value=>group.name=value,{maxLength:512}));
      if(group.kind==='spine'&&!group.presentation.standalone&&group.layers.some(layer=>layer.authoredActive===false)){
        const title=document.createElement('h3');title.textContent='Skeleton layers';panel.append(title);
        for(const layer of group.layers)panel.append(input(`${layer.instance.name} (${layer.instance.id})`,'checkbox',layer.active,value=>stage.setLayerActive(group,layer.instance.id,value)));
        const note=document.createElement('p');note.textContent='Changing active layers restarts this object’s interactions. Source-hidden layers are optional.';panel.append(note);
      }
      if(group.kind==='spine'&&group.presentation.standalone){
        const active=group.layers.find(layer=>layer.active)||group.layers[0],skeletonLabel=document.createElement('label');skeletonLabel.textContent='Skeleton variant';
        const skeleton=document.createElement('select');skeleton.id='skeleton-preview';for(const layer of group.layers)skeleton.append(new Option(layer.instance.name,layer.instance.id));skeleton.value=active.instance.id;
        skeleton.onchange=()=>mutate(()=>{for(const layer of group.layers)layer.active=layer.instance.id===skeleton.value;stage.evaluate(0);stage.fit();});skeletonLabel.append(skeleton);panel.append(skeletonLabel);
        const animationLabel=document.createElement('label');animationLabel.textContent='Animation preview';const animation=document.createElement('select');animation.id='animation-preview';
        for(const item of active.skeleton.data.animations)animation.append(new Option(item.name,item.name));animation.value=active.state.getCurrent(0)?.animation.name||'';
        animation.onchange=()=>mutate(()=>active.state.setAnimation(0,animation.value,true));animationLabel.append(animation);panel.append(animationLabel);
      }
      for(const [key,label,step,min,max] of [['x','X','.1'],['y','Y','.1'],['scale','Scale','.05','.01'],['rotation','Rotation','1'],['opacity','Opacity','.05','0','1']])panel.append(input(label,'number',group[key],value=>group[key]=value,{step,...(min?{min}:{}),...(max?{max}:{})}));
      for(const [key,label] of [['visible','Visible'],['locked','Locked'],['flipX','Mirror horizontally'],['flipY','Mirror vertically']])panel.append(input(label,'checkbox',group[key],value=>group[key]=value));
      const reorder=direction=>{const index=stage.groups.indexOf(group),target=index+direction;if(target<0||target>=stage.groups.length)return;[stage.groups[index],stage.groups[target]]=[stage.groups[target],stage.groups[index]];};
      panel.append(button('Move forward',()=>reorder(1)),button('Move backward',()=>reorder(-1)));
      const duplicate=document.createElement('button');duplicate.textContent='Duplicate';duplicate.onclick=async()=>{
        if(isBusy())return;const previous=snapshot(),scene=structuredClone(previous),copy=structuredClone(scene.objects.find(row=>row.id===group.id));copy.id=crypto.randomUUID();copy.name+=' copy';copy.x+=1;scene.objects.push(copy);const sound=scene.audio?.ambientTracks.find(track=>track.id===group.id);if(sound)scene.audio.ambientTracks.push({...sound,id:copy.id});if(scene.audio?.effectTracks)scene.audio.effectTracks=[...scene.audio.effectTracks,...scene.audio.effectTracks.filter(track=>track.group===group.id).map(track=>({...track,group:copy.id}))].slice(-12);
        for(const effect of copy.effects||[])if(group.effects?.find(layer=>layer.source.id===effect.id)?.source.data.moveWithTransform===0)for(const particle of effect.state.particles)particle.position[0]+=1;
        try{await restore(scene);history.push(previous);choose(stage.groups.at(-1));changed();}catch(error){message(error.message);}
      };panel.append(duplicate);container.append(panel);
    }
    document.querySelector('#undo').disabled=busy||!history.past.length;document.querySelector('#redo').disabled=busy||!history.future.length;
    document.querySelector('#background').value=stage.background;document.querySelector('#speed').value=stage.speed;document.querySelector('#pause').textContent=stage.paused?'Play':'Pause';document.querySelector('#scene-name').value=name;
  }
  async function restore(scene,signal){
    if(stage.sequenceBusy)throw new Error('Stop the interaction sequence before loading a scene');
    if(stage.recoveryPending)throw new Error('Wait for rendering recovery before loading a scene');
    if(busy)throw new Error('Scene loading is already in progress');clearTimeout(timer);busy=true;refresh();
    try{const checked=validateScene(scene);await stage.restore(checked,catalog,entries,signal);name=checked.name;selectedId=stage.groups.at(-1)?.id;onSelection?.(selected());}
    catch(error){changed();throw error;}
    finally{busy=false;refresh();stage.dispatchEvent(new CustomEvent('scene-ready'));}
  }
  async function recall(scene){const previous=snapshot();await restore(scene);history.push(previous);changed();message('Scene loaded');}
  async function savedList(){const select=document.querySelector('#saved-scenes');select.replaceChildren(new Option('Choose a scene',''));for(const key of await listLocalScenes())select.append(new Option(key,key));}
  document.querySelector('#scene-name').onchange=event=>mutate(()=>name=event.target.value||'Untitled scene');
  for(const operation of ['undo','redo'])document.querySelector(`#${operation}`).onclick=async()=>{
    const list=operation==='undo'?history.past:history.future,target=list.at(-1);if(busy||!target)return;
    const current=snapshot();try{await restore(target);history[operation](current);changed();}catch(error){message(error.message);}
  };
  document.querySelector('#save-scene').onclick=async()=>{try{await saveLocalScene(snapshot(),name);await savedList();message(`Saved ${name}`);}catch(error){message(error.message);}};
  document.querySelector('#download-scene').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`${name.replace(/[^a-z0-9_-]/gi,'_')||'scene'}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  document.querySelector('#import-scene').onclick=()=>document.querySelector('#scene-file').click();
  document.querySelector('#scene-file').onchange=async event=>{const file=event.target.files[0];event.target.value='';if(!file)return;try{if(file.size>64*1024*1024)throw new Error('Scene file exceeds 64 MB');await recall(JSON.parse(await file.text()));}catch(error){message(`Import failed: ${error.message}`);}};
  document.querySelector('#load-scene').onclick=async()=>{try{const key=document.querySelector('#saved-scenes').value;if(!key)return;const scene=await loadLocalScene(key);if(scene)await recall(scene);}catch(error){message(error.message);}};
  document.querySelector('#delete-scene').onclick=async()=>{try{const key=document.querySelector('#saved-scenes').value;if(key){await deleteLocalScene(key);await savedList();message(`Deleted local scene ${key}`);}}catch(error){message(error.message);}};
  document.querySelector('#add-background').onclick=()=>document.querySelector('#background-file').click();
  document.querySelector('#background-file').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if(!file||isBusy())return;
    const previous=snapshot();busy=true;refresh();
    try{if(file.size>20*1024*1024)throw new Error('Background exceeds 20 MB');const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});if(!/^data:image\/(png|jpeg|webp|gif);base64,/.test(src))throw new Error('Unsupported image format');const group=await stage.addImage(src,file.name);history.push(previous);selectedId=group.id;changed();}
    catch(error){message(error.message);}finally{busy=false;refresh();}
  };
  return {selected,choose,before,changed,refresh,mutate,snapshot,restore,get busy(){return isBusy();},async init(presentations,runtime){catalog=presentations;entries=runtime;try{await savedList();const scene=await loadLocalScene();if(scene){await restore(scene);message('Recovered last scene');return true;}}catch(error){message(`Scene recovery failed: ${error.message}`);}return false;}};
}
