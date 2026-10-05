export function cardOutcomeSeeds(draw){
  const seeds=new Map();for(let seed=1;seed<=100000&&seeds.size<3;seed++){const outcome=draw(seed);if(!Number.isInteger(outcome)||outcome<0||outcome>2)throw new Error('Invalid card outcome');if(!seeds.has(outcome))seeds.set(outcome,seed);}
  if(seeds.size!==3)throw new Error('Card outcome coverage is incomplete');return [0,1,2].map(outcome=>({outcome,seed:seeds.get(outcome)}));
}

export class ControllerCheckpoint {
  constructor(path,source){this.path=path;this.source=source;this.bundles=new Map();}
  apply(row){
    if(row.kind==='header'){if(row.schema!==1||row.source!==this.source)throw new Error('Controller runtime changed; choose a new checkpoint file');this.header=true;return;}
    if(!this.header)throw new Error('Invalid controller checkpoint');
    if(row.kind==='bundle'){if(this.bundles.has(row.bundle))throw new Error('Duplicate checkpoint bundle');this.bundles.set(row.bundle,{metadata:row.metadata,seen:new Set(),pending:new Map(),progress:null});return;}
    const state=this.bundles.get(row.bundle);if(!state)throw new Error('Invalid checkpoint bundle');
    if(row.kind==='state'){if(state.seen.has(row.key))throw new Error('Duplicate checkpoint state');state.seen.add(row.key);state.pending.set(row.key,Buffer.from(row.scene,'base64'));}
    else if(row.kind==='finished'){if(!state.pending.delete(row.key))throw new Error('Invalid completed checkpoint state');state.progress=row.progress;}
    else throw new Error('Invalid controller checkpoint record');
  }
  async open(){
    if(!this.path){this.header=true;return;}
    let bytes=0,tail=Buffer.alloc(0);
    try{for await(const chunk of createReadStream(this.path)){tail=Buffer.concat([tail,chunk]);let end;while((end=tail.indexOf(10))!==-1){const line=tail.subarray(0,end);this.apply(JSON.parse(line.toString()));bytes+=end+1;tail=tail.subarray(end+1);}}}
    catch(error){if(error.code!=='ENOENT')throw error;await mkdir(dirname(this.path),{recursive:true});await appendFile(this.path,JSON.stringify({kind:'header',schema:1,source:this.source})+'\n',{flag:'wx'});this.header=true;return;}
    if(!this.header)throw new Error('Invalid controller checkpoint header');
    if(tail.length)await truncate(this.path,bytes);
  }
  async append(row){if(this.path)await appendFile(this.path,JSON.stringify(row)+'\n');this.apply(row);}
  async begin(bundle,metadata){const previous=this.bundles.get(bundle);if(previous){if(previous.metadata!==metadata)throw new Error('Controller resources changed; choose a new checkpoint file');}else await this.append({kind:'bundle',bundle,metadata});return {...this.status(bundle),seen:[...this.bundles.get(bundle).seen]};}
  status(bundle){const state=this.bundles.get(bundle);return {states:state.seen.size,pending:state.pending.size,progress:state.progress};}
  async enqueue(bundle,key,scene,limit){const state=this.bundles.get(bundle);if(state.seen.has(key))return {added:false,...this.status(bundle)};if(state.seen.size>=limit)return {limited:true,...this.status(bundle)};await this.append({kind:'state',bundle,key,scene:gzipSync(Buffer.from(JSON.stringify(scene))).toString('base64')});return {added:true,...this.status(bundle)};}
  next(bundle){const row=this.bundles.get(bundle).pending.entries().next();return row.done?null:{key:row.value[0],scene:JSON.parse(gunzipSync(row.value[1]).toString())};}
  async finish(bundle,key,progress){await this.append({kind:'finished',bundle,key,progress});return this.status(bundle);}
}
import {createReadStream} from 'node:fs';
import {appendFile,mkdir,truncate} from 'node:fs/promises';
import {dirname} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
