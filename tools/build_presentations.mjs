import fs from 'node:fs';
import path from 'node:path';
import {completeSkeletonInstances,materialOrdering,skeletonDisplaySettings} from './presentation_helpers.mjs';

const root = path.resolve(process.argv[2] || 'public/assets');
const runtime = JSON.parse(fs.readFileSync(path.join(root, 'runtime-index.json')));
const extraction = JSON.parse(fs.readFileSync(path.join(root, 'extraction.json')));
const fontCatalogue=fs.existsSync(path.join(root,'font-index.json'))?JSON.parse(fs.readFileSync(path.join(root,'font-index.json'))):{},fontIndex=fontCatalogue.entries||[],nativeFonts=fontCatalogue.nativeFonts||[];
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
  const canvasPixelsPerUnit=owner=>{
    const seen=new Set();while(owner&&owner!=='0'&&!seen.has(owner)){seen.add(owner);const scaler=components.get(owner)?.find(node=>className(node)==='CanvasScaler');if(scaler&&'m_ReferencePixelsPerUnit' in scaler.data)return scaler.data.m_ReferencePixelsPerUnit;
      const parent=byId.get(idOf(transforms.get(owner)?.data.m_Father));owner=idOf(parent?.data.m_GameObject);
    }return 100;
  };
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
      const ordering=materialOrdering(bundle.renderers?.find(row=>row.id===renderer?.id));
      instances.push({id: node.id, gameObject: owner, name: gameObject?.data.m_Name, active: gameObject?.data.m_IsActive, skeletonId: skeleton?.id || null,...skeletonDisplaySettings(className(node),node.data,canvasPixelsPerUnit(owner)), skin: node.data.initialSkinName,timeScale: node.data.timeScale, flipX: Boolean(node.data.initialFlipX), flipY: Boolean(node.data.initialFlipY), sortingOrder: renderer?.data.m_SortingOrder || 0,...ordering, transform: transforms.get(owner)?.id, status: skeleton?.status || (String(node.data.skeletonDataAsset.m_PathID)==='0'?'unassigned':'missing-reference')});
    }
    if ('cur_clickEvent' in node.data) {
      hotspots.push({id: node.id, gameObject: owner, name: gameObject?.data.m_Name, class: className(node), enabled:node.data.m_Enabled, event: node.data.cur_clickEvent, track: node.data.trackIndex, animation: node.data.ani_name, audio: node.data.audio_name, controller: idOf(node.data.ani_root), colliders: (components.get(owner) || []).filter(item => item.type.endsWith('Collider2D')).map(item => ({id: item.id, type: item.type, data: item.data})), transform: transforms.get(owner)?.id});
    }
    if (node.data.OtherSoundList || node.data.OtherEffectList || 'aniState' in node.data) {
      controllers.push({id: node.id, gameObject: owner, class: className(node), data: node.data});
    }
  }
  const standalone=instances.length===0&&skeletons.size>0;
  const completed=completeSkeletonInstances(instances,[...skeletons.values()]);
  instances.splice(0,instances.length,...completed.instances);
  const effects=(bundle.effects||[]).map(effect=>({...effect,transform:transforms.get(effect.gameObject)?.id}));
  const visualAnimations=nodes.filter(node=>['Animation','AnimationClip','Animator','AnimatorController','AnimatorOverrideController'].includes(node.type));
  const canvasScalers=nodes.filter(node=>node.type==='MonoBehaviour'&&className(node)==='CanvasScaler').map(node=>node.data);
  const sortingGroups=nodes.filter(node=>node.type==='SortingGroup');
  const images=(bundle.images||[]).map(image=>({...image,transform:transforms.get(image.gameObject)?.id}));
  const canvasGroups=nodes.filter(node=>node.type==='CanvasGroup');
  const uiText=nodes.filter(node=>node.type==='MonoBehaviour'&&className(node)==='TextMeshProUGUI').map(node=>({id:node.id,gameObject:idOf(node.data.m_GameObject),transform:transforms.get(idOf(node.data.m_GameObject))?.id,data:node.data}));
  const nativeText=nodes.filter(node=>node.type==='MonoBehaviour'&&className(node)==='Text').map(node=>({id:node.id,gameObject:idOf(node.data.m_GameObject),transform:transforms.get(idOf(node.data.m_GameObject))?.id,fontReference:node.fontReference,data:node.data}));
  const nativeFontAssets=nativeFonts.filter(font=>nativeText.some(row=>row.fontReference?.assetId===font.assetId&&row.fontReference.serializedFile===font.serializedFile));
  const nativeBehaviours=nodes.filter(node=>node.type==='MonoBehaviour'&&['FightSkillUIShow','TextSpacing','ItemGen','HorizontalLayoutGroup','GraphicsGradientColor','ContentSizeFitter','LayoutElement','SpineAniDragBone','StationDrawingAnim'].includes(className(node))).map(node=>({id:node.id,class:className(node),gameObject:idOf(node.data.m_GameObject),data:node.data}));
  const typewriters=nodes.filter(node=>node.type==='MonoBehaviour'&&className(node)==='TextMeshProTypewriterEffect').map(node=>({id:node.id,gameObject:idOf(node.data.m_GameObject),data:node.data}));
  for(const receiver of nativeBehaviours.filter(row=>row.class==='SpineAniDragBone')){const target=byId.get(idOf(receiver.data.dragBoneTra)),owner=idOf(target?.data.m_GameObject);receiver.dragColliders=(components.get(owner)||[]).filter(node=>node.type.endsWith('Collider2D')).map(node=>({id:node.id,type:node.type,data:node.data}));}
  for(const receiver of nativeBehaviours.filter(row=>row.class==='StationDrawingAnim')){receiver.transform=transforms.get(receiver.gameObject)?.id;receiver.colliders=(components.get(receiver.gameObject)||[]).filter(node=>node.type.endsWith('Collider2D')).map(node=>({id:node.id,type:node.type,data:node.data}));}
  const fontAssets=fontIndex.filter(font=>uiText.some(row=>String(row.data.m_fontAsset?.m_PathID)===font.assetId));
  result.push({id: bundle.id, path: bundle.path, category: bundle.id.split('/')[1], standalone, instances, ...(completed.unassignedInstances.length?{unassignedInstances:completed.unassignedInstances}:{}), hotspots, controllers, effects, images, canvasGroups, visualAnimations, canvasScalers, uiText, nativeText, nativeFontAssets, nativeBehaviours, typewriters, fontAssets, sortingGroups, hierarchy: nodes.filter(node => ['GameObject', 'Transform', 'RectTransform'].includes(node.type)), errors: bundle.errors});
}
fs.writeFileSync(path.join(root, 'presentations.json'), JSON.stringify({schema: 1, presentations: result}, null, 2));
console.log({presentations: result.length, instances: result.reduce((n,x) => n+x.instances.length,0), hotspots: result.reduce((n,x) => n+x.hotspots.length,0), controllers: result.reduce((n,x) => n+x.controllers.length,0)});
const special = result.find(item => item.id === 'Spines/painting/301619402_spine');
console.log('Clarissa', {instances: special?.instances.length, hotspots: special?.hotspots.length, controllers: special?.controllers.length, missingColliders: special?.hotspots.filter(x => x.colliders.length === 0).length});
