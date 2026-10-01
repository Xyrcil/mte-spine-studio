import fs from 'node:fs';
import path from 'node:path';
import {standaloneInstances} from './presentation_helpers.mjs';

const root = path.resolve(process.argv[2] || 'public/assets');
const runtime = JSON.parse(fs.readFileSync(path.join(root, 'runtime-index.json')));
const extraction = JSON.parse(fs.readFileSync(path.join(root, 'extraction.json')));
const idOf = pointer => pointer?.m_FileID === 0 ? String(pointer.m_PathID) : null;
const result = [];
for (const bundle of extraction.bundles) {
  if (!bundle.path) continue;
  const nodes = JSON.parse(fs.readFileSync(path.join(root, bundle.path, 'hierarchy.json')));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const transforms = new Map(nodes.filter(node => ['Transform', 'RectTransform'].includes(node.type)).map(node => [idOf(node.data.m_GameObject), node]));
  const components = new Map();
  for (const node of nodes) {
    const owner = idOf(node.data.m_GameObject);
    if (owner) components.set(owner, [...(components.get(owner) || []), node]);
  }
  const className = node => byId.get(idOf(node.data.m_Script))?.data.m_ClassName || null;
  const skeletons = new Map(runtime.entries.filter(entry => entry.bundle === bundle.id).map(entry => [entry.id, entry]));
  const instances = [];
  const hotspots = [];
  const controllers = [];
  for (const node of nodes.filter(node => node.type === 'MonoBehaviour')) {
    const owner = idOf(node.data.m_GameObject);
    const gameObject = byId.get(owner);
    if (!owner || owner === '0') continue;
    if (node.data.skeletonDataAsset) {
      const skeleton = skeletons.get(idOf(node.data.skeletonDataAsset));
      const renderer = components.get(owner)?.find(item => item.type === 'MeshRenderer');
      instances.push({id: node.id, gameObject: owner, name: gameObject?.data.m_Name, active: gameObject?.data.m_IsActive, skeletonId: skeleton?.id || null, animation: node.data._animationName, skin: node.data.initialSkinName, loop: Boolean(node.data.loop), timeScale: node.data.timeScale, flipX: Boolean(node.data.initialFlipX), flipY: Boolean(node.data.initialFlipY), sortingOrder: renderer?.data.m_SortingOrder || 0, transform: transforms.get(owner)?.id, status: skeleton?.status || 'missing-reference'});
    }
    if ('cur_clickEvent' in node.data) {
      hotspots.push({id: node.id, gameObject: owner, name: gameObject?.data.m_Name, class: className(node), event: node.data.cur_clickEvent, track: node.data.trackIndex, animation: node.data.ani_name, audio: node.data.audio_name, controller: idOf(node.data.ani_root), colliders: (components.get(owner) || []).filter(item => item.type.endsWith('Collider2D')).map(item => ({id: item.id, type: item.type, data: item.data})), transform: transforms.get(owner)?.id});
    }
    if (node.data.OtherSoundList || node.data.OtherEffectList || 'aniState' in node.data) {
      controllers.push({id: node.id, gameObject: owner, class: className(node), data: node.data});
    }
  }
  const standalone=instances.length===0&&skeletons.size>0;
  if(standalone)instances.push(...standaloneInstances([...skeletons.values()]));
  const effects=(bundle.effects||[]).map(effect=>({...effect,transform:transforms.get(effect.gameObject)?.id}));
  const visualAnimations=nodes.filter(node=>['Animation','AnimationClip'].includes(node.type));
  const sortingGroups=nodes.filter(node=>node.type==='SortingGroup');
  const images=(bundle.images||[]).map(image=>({...image,transform:transforms.get(image.gameObject)?.id}));
  const canvasGroups=nodes.filter(node=>node.type==='CanvasGroup');
  result.push({id: bundle.id, path: bundle.path, category: bundle.id.split('/')[1], standalone, instances, hotspots, controllers, effects, images, canvasGroups, visualAnimations, sortingGroups, hierarchy: nodes.filter(node => ['GameObject', 'Transform', 'RectTransform'].includes(node.type)), errors: bundle.errors});
}
fs.writeFileSync(path.join(root, 'presentations.json'), JSON.stringify({schema: 1, presentations: result}, null, 2));
console.log({presentations: result.length, instances: result.reduce((n,x) => n+x.instances.length,0), hotspots: result.reduce((n,x) => n+x.hotspots.length,0), controllers: result.reduce((n,x) => n+x.controllers.length,0)});
const special = result.find(item => item.id === 'Spines/painting/301619402_spine');
console.log('Clarissa', {instances: special?.instances.length, hotspots: special?.hotspots.length, controllers: special?.controllers.length, missingColliders: special?.hotspots.filter(x => x.colliders.length === 0).length});
