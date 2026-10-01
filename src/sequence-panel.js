import {InteractionRecorder,InteractionPlayer,validateSequence,retimeSequenceAction,removeSequenceAction,previewSequenceAt} from './engine/interaction-sequence.js';

export function createSequencePanel(stage,editor,message){
  const recorder=new InteractionRecorder(stage);let loading=false,previewController,actionPage=0,timelineKey='';
  const panel=document.createElement('section');panel.id='sequence-panel';panel.className='scene-controls';
  panel.innerHTML='<h2>Interaction sequence</h2><p>Record clicks in Gallery. Replay restores the recorded starting scene. Changing click times can change which interactions are accepted; replay edited sequences to check them.</p><div class="actions"><button id="sequence-record">Record</button><button id="sequence-stop">Stop</button><button id="sequence-replay">Replay</button></div><label>Duration (s)<input id="sequence-duration" type="number" min="0" max="86400" step="any" required></label><label>Preview time (s)<input id="sequence-position" type="number" min="0" step="any" value="0" required></label><div class="actions"><button id="sequence-preview">Preview (silent)</button><button id="sequence-cancel-preview" disabled>Cancel preview</button></div><p>Preview is paused and muted, with active speech and click sounds cleared. Replay starts from the beginning with the recorded sound settings.</p><ol id="sequence-actions" aria-label="Recorded clicks"></ol><div class="actions"><button id="sequence-previous">Previous clicks</button><button id="sequence-next">Next clicks</button></div><output id="sequence-page"></output><div class="actions"><button id="sequence-save">Export sequence</button><button id="sequence-load">Import sequence</button></div><output id="sequence-status" aria-live="polite"></output><input id="sequence-file" type="file" accept="application/json,.json" hidden>';
  document.querySelector('.inspector').append(panel);
  const field=name=>panel.querySelector(`#sequence-${name}`);
  function refresh(){
    const active=recorder.active||Boolean(stage.sequencePlayer),busy=active||loading||stage.recoveryPending;
    stage.sequenceBusy=active;
    field('record').disabled=busy||editor.busy;field('replay').disabled=busy||!stage.sequence;field('stop').disabled=!active;field('load').disabled=busy;field('save').disabled=active||loading||!stage.sequence;
    field('duration').disabled=busy||editor.busy||!stage.sequence;field('position').disabled=busy||editor.busy||!stage.sequence;field('preview').disabled=busy||editor.busy||!stage.sequence;field('cancel-preview').disabled=!previewController;
    if(document.activeElement!==field('duration'))field('duration').value=stage.sequence?.duration??'';
    field('position').max=stage.sequence?.duration??0;
    updateTimeline(busy||editor.busy);
    field('status').textContent=recorder.active?`Recording · ${recorder.actions.length} clicks`:stage.sequencePlayer?'Replaying':stage.sequence?`${stage.sequence.actions.length} clicks · ${stage.sequence.duration.toFixed(2)} s${stage.sequence.initial.audio?'':' · No recorded sound settings; replay uses current preferences'}`:'No sequence recorded';
    for(const selector of ['.library','#layers','.scene-controls:not(#sequence-panel)','#sound-panel','#voice-panel','#background','#speed','#fit']){const node=document.querySelector(selector);if(node)node.inert=(selector==='.scene-controls:not(#sequence-panel)'?active||loading:busy)||(selector==='.library'&&!document.querySelector('#export-panel').hidden);}
    for(const tab of document.querySelectorAll('[data-view]'))tab.disabled=busy;
  }
  function changeSequence(transform){
    if(loading||recorder.active||stage.sequencePlayer||editor.busy||!stage.sequence)return;
    try{const checked=transform(stage.sequence);if(!editor.before())return;stage.sequence=checked;editor.changed();refresh();message('Sequence updated. Replay to check the edited interactions.');}catch(error){timelineKey='';field('duration').value=stage.sequence.duration;refresh();message(error.message);}
  }
  function updateTimeline(busy){
    const sequence=stage.sequence,actions=sequence?.actions||[],pages=Math.max(1,Math.ceil(actions.length/25));actionPage=Math.min(actionPage,pages-1);
    const key=JSON.stringify([actionPage,actions,sequence?.initial.objects.map(object=>[object.id,object.name])]);
    if(key!==timelineKey){
      timelineKey=key;field('actions').replaceChildren();field('actions').start=actionPage*25+1;
      for(let index=actionPage*25;index<Math.min(actions.length,(actionPage+1)*25);index++){
        const action=actions[index],row=document.createElement('li'),title=document.createElement('p'),label=document.createElement('label'),input=document.createElement('input'),remove=document.createElement('button');row.className='sequence-action';
        title.textContent=`Click ${index+1} · ${sequence.initial.objects.find(object=>object.id===action.group)?.name||action.group} · ${action.animation||'reset'}`;label.textContent='Time (s)';input.type='number';input.min='0';input.max='86400';input.step='any';input.required=true;input.value=action.at;input.setAttribute('aria-label',`Click ${index+1} time (s)`);
        input.onchange=()=>{if(input.checkValidity())changeSequence(sequence=>retimeSequenceAction(sequence,index,Number(input.value)));else{message('Enter a valid click time');timelineKey='';refresh();}};
        remove.textContent='Delete click';remove.setAttribute('aria-label',`Delete click ${index+1}`);remove.onclick=()=>changeSequence(sequence=>removeSequenceAction(sequence,index));label.append(input);row.append(title,label,remove);field('actions').append(row);
      }
    }
    for(const control of field('actions').querySelectorAll('input,button'))control.disabled=busy;
    field('previous').disabled=busy||actionPage===0;field('next').disabled=busy||actionPage>=pages-1;field('page').textContent=actions.length?`Clicks ${actionPage*25+1}–${Math.min(actions.length,(actionPage+1)*25)} of ${actions.length}`:'No recorded clicks';
  }
  field('duration').onchange=()=>{if(field('duration').checkValidity())changeSequence(sequence=>validateSequence({...sequence,duration:Number(field('duration').value)}));else{field('duration').value=stage.sequence?.duration??'';message('Enter a duration between 0 and 86400 seconds');}};
  field('previous').onclick=()=>{actionPage--;refresh();};field('next').onclick=()=>{actionPage++;refresh();};
  field('cancel-preview').onclick=()=>previewController?.abort();
  field('preview').onclick=async()=>{
    if(!stage.sequence||loading||editor.busy)return;if(!field('position').checkValidity()){message('Enter a preview time within the sequence duration');return;}
    const sequence=validateSequence(stage.sequence),target=Number(field('position').value),previous=editor.snapshot(),inputs={presentations:stage.groups.filter(group=>group.kind==='spine').map(group=>group.presentation),entries:stage.groups.flatMap(group=>group.layers.map(layer=>layer.entry))};
    if(!editor.before())return;loading=true;previewController=new AbortController();stage.dispatchEvent(new CustomEvent('sequence-paused'));message('Preparing silent sequence preview…');refresh();
    try{await previewSequenceAt(stage,sequence,target,{restore:(scene,signal)=>editor.restore(scene,signal),signal:previewController.signal,onProgress:(at,total)=>{field('status').textContent=`Preparing preview · ${at.toFixed(2)} / ${total.toFixed(2)} s`;}});editor.changed();message(`Silent sequence preview at ${target.toFixed(3)} s`);}
    catch(error){stage.sequenceBusy=false;if(stage.recoveryPending){stage.recoverySnapshot=previous;stage.recoveryInputs=inputs;}else{try{await editor.restore(previous);}catch(restoreError){message(`Scene recovery failed: ${restoreError.message}`);return;}}editor.changed();message(error.name==='AbortError'?'Sequence preview cancelled; previous scene restored':error.message);}
    finally{previewController=null;loading=false;refresh();}
  };
  function stopped(){stage.sequencePlayer=null;stage.sequenceBusy=false;stage.paused=true;stage.dispatchEvent(new CustomEvent('sequence-paused'));editor.changed();refresh();}
  function stop(){recorder.stop();stopped();}
  function togglePause(){if(!recorder.active&&!stage.sequencePlayer)return false;stage.paused=!stage.paused;stage.dispatchEvent(new CustomEvent(stage.paused?'sequence-paused':'sequence-playing'));editor.refresh();return true;}
  field('record').onclick=()=>{if(editor.busy||loading)return;try{document.querySelector('[data-view="gallery"]').click();recorder.start();stage.paused=false;stage.dispatchEvent(new CustomEvent('sequence-playing'));editor.refresh();refresh();message('Recording interactions. Click the character in Gallery.');}catch(error){message(error.message);}};
  field('stop').onclick=stop;
  field('replay').onclick=async()=>{
    if(!stage.sequence||editor.busy||loading)return;const sequence=validateSequence(stage.sequence);loading=true;refresh();
    try{await editor.restore(sequence.initial);stage.sequence=sequence;stage.sequencePlayer=new InteractionPlayer(stage,sequence);stage.sequenceBusy=true;stage.paused=false;stage.dispatchEvent(new CustomEvent('sequence-playing'));stage.evaluate(0);editor.refresh();if(stage.sequencePlayer)message('Replaying interaction sequence');}
    catch(error){stopped();message(error.message);}finally{loading=false;refresh();}
  };
  field('save').onclick=()=>{if(!stage.sequence)return;const url=URL.createObjectURL(new Blob([JSON.stringify(stage.sequence)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='mte-interaction-sequence.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  field('load').onclick=()=>field('file').click();
  field('file').onchange=async()=>{const file=field('file').files[0];field('file').value='';if(!file||loading||editor.busy)return;loading=true;refresh();try{if(file.size>64*1024*1024)throw new Error('Sequence file exceeds 64 MB');const checked=validateSequence(JSON.parse(await file.text()));editor.before();stage.sequence=checked;editor.changed();message('Interaction sequence imported');}catch(error){message(error.message);}finally{loading=false;refresh();}};
  stage.addEventListener('interaction-invoked',refresh);
  stage.addEventListener('sequence-recorded',event=>{stage.sequence=event.detail;stage.sequenceBusy=false;editor.changed();refresh();});
  stage.addEventListener('sequence-ended',()=>{stopped();message('Interaction sequence finished');});
  stage.addEventListener('sequence-error',event=>{stopped();message(event.detail);});
  stage.addEventListener('rendering-lost',()=>{stage.sequencePlayer=null;stage.sequenceBusy=false;refresh();});
  stage.addEventListener('rendering-recovered',refresh);stage.addEventListener('sequence-loaded',refresh);stage.addEventListener('scene-ready',refresh);stage.addEventListener('scene-change',refresh);refresh();
  return {recorder,get sequence(){return stage.sequence;},get previewing(){return Boolean(previewController);},stop,togglePause,refresh};
}
