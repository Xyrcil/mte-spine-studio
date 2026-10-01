import {validateScene} from './scene.js';

export function exportScene(scene,useSequence=false){
  const checked=validateScene(scene);
  if(!useSequence)return checked;
  if(!checked.sequence)throw new Error('Capture a scene with an interaction sequence first');
  return {...checked.sequence.initial,sequence:checked.sequence};
}
