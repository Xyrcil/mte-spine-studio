import chinese from './locales/zh-CN.js';

export const supportedLocales=Object.freeze(['zh-CN','en']);
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const templates=Object.entries(chinese).filter(([key])=>key.includes('{')).map(([key,value])=>{
  const names=[],parts=[];let offset=0;
  for(const match of key.matchAll(/\{(\w+)\}/g)){const number=/^(count|width|height|frames|duration|size|bundles|start|end|total|at|time|done|frame)$/.test(match[1]);parts.push(escape(key.slice(offset,match.index)),number?'([\\d.,+-]+)':'(.+?)');names.push(match[1]);offset=match.index+match[0].length;}
  parts.push(escape(key.slice(offset)));
  return {key,value,names,pattern:new RegExp('^'+parts.join('')+'$'),specificity:key.replace(/\{\w+\}/g,'').length};
}).sort((a,b)=>b.specificity-a.specificity);
export function normalizeLocale(value){return /^zh(?:-|$)/i.test(value||'')?'zh-CN':'en';}
function initialLocale(){try{const saved=globalThis.localStorage?.getItem('mte-interface-language');if(supportedLocales.includes(saved))return saved;}catch{}return typeof document==='undefined'?'en':'zh-CN';}
let locale=initialLocale();
export const getLocale=()=>locale;
export function formatMessage(template,values={}){return template.replace(/\{(\w+)\}/g,(token,name)=>Object.hasOwn(values,name)?String(values[name]):token);}
export function translate(message,language=locale){
  if(typeof message!=='string'||language==='en')return message;
  const trimmed=message.trim();let value;
  if(Object.hasOwn(chinese,trimmed))value=chinese[trimmed];
  else for(const row of templates){const match=row.pattern.exec(trimmed);if(match){value=formatMessage(row.value,Object.fromEntries(row.names.map((name,index)=>[name,['reason','warnings'].includes(name)?translate(match[index+1],language):name==='action'?({start:'启用',touch:'点击',stop:'停用',entry:'入场',birthday:'生日问候',move:'移动',release:'松开'}[match[index+1]]||match[index+1]):match[index+1]])));break;}}
  if(value===undefined&&trimmed.includes(' · '))value=trimmed.split(' · ').map(part=>translate(part,language)).join(' · ');
  if(value===undefined||value===trimmed)return message;
  return message.slice(0,message.indexOf(trimmed))+value+message.slice(message.indexOf(trimmed)+trimmed.length);
}
export function t(key,values={}){return formatMessage(locale==='zh-CN'?(chinese[key]||key):key,values);}

export function createI18n(root){
  const document=root.ownerDocument,textRecords=new WeakMap(),attributeRecords=new WeakMap();
  const attributes=['aria-label','aria-description','placeholder','title'];
  const skip='script,style,textarea,[data-i18n-skip],#subtitle';
  const source='#layers .layer>button:first-child,#ambient-tracks>section>p,#saved-scenes option[value]:not([value=""]),#skill-role option,#layers option[value]:not([value=""])';
  const decoratedSource='.asset strong,#voice-list option,#export-audio option[value]:not([value=""]),#skill-list option';
  function render(value,node,attribute){
    if(!attribute&&node.parentElement?.closest(source))return value;
    if(!attribute&&node.parentElement?.closest(decoratedSource)){
      const parts=value.split(' · ');return parts.map((part,index)=>index?translate(part):part).join(' · ');
    }
    return translate(value);
  }
  function canonical(value,old){
    if(!old)return value;
    if(value===old.rendered)return old.source;
    if(old.rendered!==old.source&&value.startsWith(old.rendered))return old.source+value.slice(old.rendered.length);
    return value;
  }
  function text(node){
    if(node.parentElement?.closest(skip)||!node.data.trim())return;
    const original=canonical(node.data,textRecords.get(node)),rendered=render(original,node);
    textRecords.set(node,{source:original,rendered});if(rendered!==node.data)node.data=rendered;
  }
  function element(node){
    if(node.closest(skip))return;
    let records=attributeRecords.get(node);if(!records){records=new Map();attributeRecords.set(node,records);}
    for(const attribute of attributes){const value=node.getAttribute(attribute);if(value===null)continue;const original=canonical(value,records.get(attribute)),rendered=render(original,node,attribute);records.set(attribute,{source:original,rendered});if(value!==rendered)node.setAttribute(attribute,rendered);}
  }
  function scan(node){
    if(node.nodeType===3){text(node);return;}
    if(node.nodeType!==1||node.closest(skip))return;element(node);
    const walker=document.createTreeWalker(node,5);let child;while((child=walker.nextNode())){if(child.nodeType===3)text(child);else element(child);}
  }
  const observer=new MutationObserver(records=>{
    for(const row of records){if(row.type==='characterData')text(row.target);else if(row.type==='attributes')element(row.target);else for(const node of row.addedNodes)scan(node);}
  });
  const changed=()=>{document.documentElement.lang=locale;scan(root);};
  document.addEventListener('mte-language-change',changed);changed();
  observer.observe(root,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:attributes});
  return {refresh:()=>scan(root),dispose(){observer.disconnect();document.removeEventListener('mte-language-change',changed);}};
}
export function setLocale(value){
  if(!supportedLocales.includes(value))throw new Error('Unsupported interface language');locale=value;
  try{globalThis.localStorage?.setItem('mte-interface-language',value);}catch{}
  if(typeof document!=='undefined')document.dispatchEvent(new CustomEvent('mte-language-change',{detail:{locale:value}}));
}
