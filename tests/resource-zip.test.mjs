import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {stageResourceZip} from '../src/engine/resource-zip.js';
const base='https://example.test/mte/';
function cache(){const entries=new Map();return {entries,async put(url,response){entries.set(url,response);},async match(url){return entries.get(url)?.clone();}};}
test('stored and deflated ZIP resources stream into scoped browser storage',async()=>{
  for(const level of [0,6]){const target=cache(),file=new File([zipSync({'library.json':strToU8('{"schema":1}'),'spines/角色/page.png':new Uint8Array([1,2,3]),'client.apk':new Uint8Array([0])},{level})],'resources.zip');const result=await stageResourceZip(file,target,base);assert.equal(result.rows.length,2);assert.equal(result.excluded,1);assert.equal(await result.rows[0].file.text(),'{"schema":1}');assert.ok(target.entries.has('https://example.test/mte/assets/spines/%E8%A7%92%E8%89%B2/page.png'));}
});
test('ZIP traversal, storage overflow and cancellation fail without committing a pack',async()=>{
  const archive=entries=>new File([zipSync(entries)],'resources.zip');await assert.rejects(stageResourceZip(archive({'../outside.json':strToU8('{}')}),cache(),base),/Invalid resource path/);
  await assert.rejects(stageResourceZip(archive({'large.json':strToU8('{}')}),cache(),base,{budget:1}),/Not enough browser storage/);
  const controller=new AbortController();controller.abort();await assert.rejects(stageResourceZip(archive({'valid.json':strToU8('{}')}),cache(),base,{signal:controller.signal}),error=>error.name==='AbortError');
});
test('font files remain in streamed resource ZIPs with their own MIME types',async()=>{
  const target=cache(),path='spines/interfaces/fonts/SOURCE.otf',file=new File([zipSync({[path]:new Uint8Array([79,84,84,79])})],'fonts.zip'),result=await stageResourceZip(file,target,base);assert.equal(result.excluded,0);assert.equal(result.rows.length,1);assert.equal(target.entries.get(base+'assets/'+path).headers.get('content-type'),'font/otf');
});
