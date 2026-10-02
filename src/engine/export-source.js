import {validateScene} from './scene.js';

export function exportScene(scene,useSequence=false){
  const checked=validateScene(scene);
  if(!useSequence)return checked;
  if(!checked.sequence)throw new Error('Capture a scene with an interaction sequence first');
  return {...checked.sequence.initial,sequence:checked.sequence};
}

export function omittedVisualWarnings(groups,scene,useSequence=false){
  const warnings=new Set();
  for(const group of groups){
    if(!group.visible)continue;
    if(group.effects?.some(effect=>effect.reason&&effect.source.renderer?.m_Enabled!==0&&effect.source.renderer?.m_Enabled!==false&&group.isActiveTransform(effect.source.transform)))warnings.add('Some source particle effects are not rendered');
    if(group.nativeAnimations?.some(native=>native.reason&&native.source.data.m_PlayAutomatically&&native.source.data.m_Enabled!==0&&native.source.data.m_Enabled!==false&&group.isActiveTransform(group.transforms.get(String(native.source.data.m_GameObject?.m_PathID))?.id)))warnings.add('Some source native animation clips are not rendered');
    if(group.presentation?.hotSpringHouse){
      const conversation=group.controllers?.some(root=>root.value?.kind==='hot-spring'&&['focusing','dialogue'].includes(root.value.phase)),recorded=useSequence&&scene.sequence?.actions.some(action=>action.group===group.id&&action.controller==='hot-spring'&&!['close','continue'].includes(action.hit));
      if(conversation||recorded){const root=group.controllers?.find(root=>root.value?.kind==='hot-spring');warnings.add(root?.decorationModels?.size&&!root.decorationReason?root.dialoguePanelAvailable?group.dialogueTypography?.slots.length===2&&!group.dialogueTypography.reason?'Dialogue uses original fonts with browser rasterization; original-client visual verification is pending':'Original hot spring dialogue typography is not restored':'Original hot spring dialogue panel layout is not restored':'Original hot spring dialogue decorations are not rendered');}
    }
  }
  return [...warnings];
}
