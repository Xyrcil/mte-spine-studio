import {InteractionRecorder,InteractionPlayer,validateSequence} from './engine/interaction-sequence.js';

export function createSequencePanel(stage,editor,message){
  const recorder=new InteractionRecorder(stage);let loading=false;
  const panel=document.createElement('section');panel.id='sequence-panel';panel.className='scene-controls';
  panel.innerHTML='<h2>Interaction sequence</h2><p>Record clicks in Gallery. Stop before editing the scene. Replay restores the recorded starting scene.</p><div class="actions"><button id="sequence-record">Record</button><button id="sequence-stop">Stop</button><button id="sequence-replay">Replay</button></div><div class="actions"><button id="sequence-save">Export sequence</button><button id="sequence-load">Import sequence</button></div><output id="sequence-status" aria-live="polite"></output><input id="sequence-file" type="file" accept="application/json,.json" hidden>';
  document.querySelector('.inspector').append(panel);
  const field=name=>panel.querySelector(`#sequence-${name}`);
  function refresh(){
    const active=recorder.active||Boolean(stage.sequencePlayer),busy=active||loading||stage.recoveryPending;
    stage.sequenceBusy=active;
    field('record').disabled=busy||editor.busy;field('replay').disabled=busy||!stage.sequence;field('stop').disabled=!active;field('load').disabled=busy;field('save').disabled=active||loading||!stage.sequence;
    field('status').textContent=recorder.active?`Recording · ${recorder.actions.length} clicks`:stage.sequencePlayer?'Replaying':stage.sequence?`${stage.sequence.actions.length} clicks · ${stage.sequence.duration.toFixed(2)} s`:'No sequence recorded';
    for(const selector of ['.library','#layers','.scene-controls:not(#sequence-panel)','#sound-panel','#voice-panel','#background','#speed','#fit']){const node=document.querySelector(selector);if(node)node.inert=(selector==='.scene-controls:not(#sequence-panel)'?active||loading:busy)||(selector==='.library'&&!document.querySelector('#export-panel').hidden);}
    for(const tab of document.querySelectorAll('[data-view]'))tab.disabled=busy;
  }
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
  return {recorder,get sequence(){return stage.sequence;},stop,togglePause,refresh};
}
