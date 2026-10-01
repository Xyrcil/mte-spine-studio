export function createSoundPanel(stage,audio,library,editor,message){
  const panel=document.createElement('section');panel.id='sound-panel';
  panel.innerHTML=`<h2>Scene sound</h2><label class="check-label"><input id="ambient-enabled" type="checkbox">Enable ambient audio</label><label class="check-label"><input id="sound-muted" type="checkbox">Mute all sound</label><label>Ambient volume <input id="ambient-volume" type="range" min="0" max="1" step=".05" value=".5"></label><div id="ambient-tracks"></div>`;
  document.querySelector('.inspector').append(panel);
  const resources=[...audio.byName.entries()].flatMap(([name,entries])=>entries.filter(entry=>entry.category==='a_sound_bgm').map(entry=>({name,category:entry.category})));
  function refresh(){
    document.querySelector('#ambient-enabled').checked=audio.ambientEnabled;document.querySelector('#sound-muted').checked=audio.muted;document.querySelector('#ambient-volume').value=audio.ambientVolume;
    const list=document.querySelector('#ambient-tracks');list.replaceChildren();
    for(const group of stage.groups){
      const setting=audio.ambientSetting(group),row=document.createElement('section'),title=document.createElement('p');title.textContent=group.name;row.append(title);
      const label=document.createElement('label');label.textContent='Ambient resource';const select=document.createElement('select');select.setAttribute('aria-label',`Ambient resource for ${group.name}`);select.append(new Option('No ambient sound',''));
      const choices=[...(setting?.name?[{name:setting.name,category:setting.category}]:[]),...resources],seen=new Set();for(const choice of choices){const key=`${choice.category}/${choice.name}`;if(seen.has(key))continue;seen.add(key);select.append(new Option(choice.name,key));}select.value=setting?.enabled?`${setting.category}/${setting.name}`:'';
      select.onchange=()=>editor.mutate(()=>{const value=select.value,slash=value.indexOf('/'),category=value.slice(0,slash),name=value.slice(slash+1),info=value?audio.soundInfo(name,category):null;audio.configureAmbient(group.id,{name:info?.name||'',category:info?.category||'a_sound_ui',loop:info?.loop||false,gain:1,time:0,enabled:Boolean(value),ended:false});});label.append(select);row.append(label);
      if(setting?.enabled){
        const loopLabel=document.createElement('label');loopLabel.className='check-label';const loop=document.createElement('input');loop.type='checkbox';loop.checked=setting.loop;loop.onchange=()=>editor.mutate(()=>audio.configureAmbient(group.id,{...audio.ambientSnapshot().find(track=>track.id===group.id),loop:loop.checked,ended:false}));loopLabel.append(loop,document.createTextNode('Repeat this sound'));row.append(loopLabel);
        const gainLabel=document.createElement('label');gainLabel.textContent='Object sound volume';const gain=document.createElement('input');gain.type='range';gain.min='0';gain.max='1';gain.step='.05';gain.value=setting.gain;gain.onchange=()=>editor.mutate(()=>audio.configureAmbient(group.id,{...audio.ambientSnapshot().find(track=>track.id===group.id),gain:Number(gain.value)}));gainLabel.append(gain);row.append(gainLabel);
        const restart=document.createElement('button');restart.textContent='Restart ambient';restart.onclick=()=>editor.mutate(()=>{audio.unlocked=true;audio.configureAmbient(group.id,{...audio.ambientSnapshot().find(track=>track.id===group.id),time:0,ended:false});});row.append(restart);
        const note=document.createElement('small');note.textContent=`${setting.loop?'Looping':'One-shot'}${group.visible?'':' · Object hidden'}${audio.ambients.get(group.id)?.ended?' · Finished':''}`;row.append(note);
      }
      list.append(row);
    }
  }
  const sync=()=>{audio.paused=stage.paused;audio.syncAmbients(stage.groups,library.appearances);if(stage.paused)audio.pause();refresh();};
  document.querySelector('#ambient-enabled').onchange=event=>{const enabled=event.target.checked;editor.mutate(()=>{audio.enableAmbients(enabled).catch(error=>message(error.message));});};
  document.querySelector('#sound-muted').onchange=event=>{const muted=event.target.checked;editor.mutate(()=>audio.setMuted(muted));};
  document.querySelector('#ambient-volume').onchange=event=>{const volume=Number(event.target.value);editor.mutate(()=>audio.setAmbientVolume(volume));};
  stage.captureAudio=()=>audio.snapshot();stage.applyAudio=value=>{audio.restore(value,stage.groups,library.appearances,stage.paused);refresh();};
  stage.addEventListener('scene-change',sync);audio.addEventListener('ambient-state',refresh);sync();
  return {refresh,sync};
}
