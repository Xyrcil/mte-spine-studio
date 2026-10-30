let aliases=new Map(),assetRoot,shellRoot;

function localPath(value){
  return typeof value==='string'&&value.length>0&&!/[\\%?#:]/.test(value)&&!value.startsWith('/')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
}

export function configureResourceAliases(value,base){
  if(value?.schema!==1||!value.aliases||Array.isArray(value.aliases)||typeof value.aliases!=='object')throw new Error('Invalid local resource map');
  const root=new URL('assets/',base),next=new Map();
  for(const [source,target] of Object.entries(value.aliases)){
    if(!localPath(source)||!localPath(target)||Object.hasOwn(value.aliases,target))throw new Error('Invalid local resource alias');
    next.set(new URL(source,root).href,new URL(target,root).href);
  }
  assetRoot=root;shellRoot=new URL('.',base);aliases=next;
  return aliases.size;
}

export function resourceUrl(value){
  if(!aliases.size||typeof value!=='string')return value;
  try{return aliases.get(new URL(value,globalThis.document?.baseURI||shellRoot).href)||value;}catch{return value;}
}

export function mapAssetManager(manager){
  if(!aliases.size)return manager;
  manager.rawDataUris=new Proxy(manager.rawDataUris,{get(target,key,receiver){
    if(Reflect.has(target,key))return Reflect.get(target,key,receiver);
    const mapped=resourceUrl(key);return mapped!==key?mapped:undefined;
  }});
  return manager;
}
