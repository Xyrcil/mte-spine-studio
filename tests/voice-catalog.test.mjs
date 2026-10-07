import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {voiceAppearance,mainViewVoiceBinding} from '../src/engine/voice-catalog.js';
import {voiceCatalog,savedVoiceRow,hotSpringRole,stationVoiceBinding,mainViewTouchVoices,mainViewIdleVoices} from '../src/engine/voice-catalog.js';
const library={appearances:[{id:'skin',characterId:'actor',bundle:'Spines/skin'}],voices:[{id:'1',targetId:'actor',title:'Login',resourceName:'Voice_Login',text:'Hello'},{id:'2',targetId:'skin',title:'Costume',resourceName:'Voice_Skin',text:'Hello again'},{id:'3',targetId:'other',title:'Other',resourceName:'Other'}],storyVoices:[{id:'1',resourceName:'Voice_Plot_1',text:'Story text'},{id:'2',resourceName:'',text:'Unvoiced text'}]};
test('artwork variants share declared parent voices without changing their authored source',()=>{
  const source=structuredClone(library);source.appearances.push({id:'hx',variantOf:'skin',characterId:'actor',bundle:'Spines/skin_hx'});
  const object={bundle:'Spines/skin_hx',sourceSkinId:'authored_other_role'},before=structuredClone(object);
  assert.equal(voiceAppearance(source,object).id,'skin');assert.deepEqual(voiceCatalog(source,[object]).map(row=>row.id),['1','2']);assert.deepEqual(object,before);
  source.appearances[0].id='301600901';source.appearances[1].variantOf='301600901';assert.equal(mainViewVoiceBinding(source,object).modelId,'301600901');
  source.appearances[0].variantOf='hx';assert.equal(voiceAppearance(source,object),null);assert.deepEqual(voiceCatalog(source,[object]),[]);
  source.appearances[1].variantOf='missing';assert.equal(voiceAppearance(source,object),null);
});
test('station voice scope uses source skin remapping and exact voice IDs, not resource prefixes',()=>{
  const source={...structuredClone(library),stationDrawings:{drawings:[{id:'drawing',skinId:'skin',gospelId:'actor',peopleId:'',voiceIds:['3','missing']}]}};
  source.appearances.push({id:'station',stationDrawingId:'drawing',bundle:'Spines/drawing/station/drawing',characterId:'actor'});
  source.appearances[0].ownVoice=true;
  assert.deepEqual(stationVoiceBinding(source,{appearanceId:'station'}),{drawingId:'drawing',targetId:'skin',voiceIds:['3','missing']});
  assert.deepEqual(voiceCatalog(source,[{appearanceId:'station'}]).map(row=>row.id),['1','2','3']);
  assert.deepEqual(voiceCatalog(source,[{appearanceId:'station'}],'station').map(row=>row.id),['3','missing']);
  assert.equal(voiceCatalog(source,[{appearanceId:'station'}],'station')[1].resourceName,'');
  source.appearances[0].ownVoice=false;
  assert.equal(stationVoiceBinding(source,{appearanceId:'station'}).targetId,'actor');
  assert.deepEqual(voiceCatalog(source,[{appearanceId:'station'}]).map(row=>row.id),['1','3']);
  source.stationDrawings.drawings[0].skinId='unindexed';
  assert.equal(stationVoiceBinding(source,{appearanceId:'station'}).targetId,'unindexed');
  assert.deepEqual(voiceCatalog(source,[{appearanceId:'skin'}],'station'),[]);
  assert.deepEqual(voiceCatalog(source,[{appearanceId:'station'}],'story').map(row=>row.id),['1','2']);
});
test('main-view touch pool uses source type and target rather than the newer application classification',()=>{
  const source={...structuredClone(library),stationDrawings:{drawings:[{id:'drawing',skinId:'',gospelId:'actor',peopleId:'',voiceIds:[]}]},mainViewVoices:{voices:[{id:'1',targetId:'actor',type:3,resourceName:'original',text:'Original',exactResource:true},{id:'2',targetId:'actor',type:0,resourceName:'idle'},{id:'3',targetId:'other',type:3,resourceName:'other'}]}};
  source.appearances.push({id:'station',stationDrawingId:'drawing',characterId:'actor'});
  assert.deepEqual(voiceCatalog(source,[{appearanceId:'station'}],'main-view-touch').map(row=>row.resourceName),['original']);
  assert.equal(savedVoiceRow({name:'original',id:'1',exactResource:true},[{id:'1',resourceName:'replacement',alias:'original',text:'Replacement'},source.mainViewVoices.voices[0]]).text,'Original');
});
test('explicit station pools precede favor and ordinary touch pools without dropping missing IDs',()=>{
  const original={id:'old',resourceName:'original',exactResource:true},current={id:'new',resourceName:'newer'};
  const data={appearances:[{id:'station',stationDrawingId:'drawing'}],stationDrawings:{drawings:[{id:'drawing',gospelId:'12',skinId:'',voiceIds:['old','new','missing','old']}]},voices:[{id:'old',resourceName:'replacement'},current],storyVoices:[],mainViewVoices:{voices:[original,{id:'touch',type:3,targetId:'12',resourceName:'touch'}],hotSpringProfiles:[{id:'12',tiers:[['favor']]}],favorVoices:[{id:'favor:line',resourceName:'favor'}]}};
  const pool=mainViewTouchVoices(data,{appearanceId:'station',hotSpringFavorLevel:0});
  assert.deepEqual(pool.map(row=>row.id),['old','new','missing','old']);assert.equal(pool[0],original);assert.equal(pool[1],current);assert.equal(pool[2].resourceName,'');
  assert.deepEqual(voiceCatalog(data,[{appearanceId:'station'}],'main-view-touch').map(row=>row.id),['old','new','missing']);
});
test('idle lines use station people or gospel targets rather than skin touch targets',()=>{
  const rows=['actor','person','12'].flatMap(target=>[2,1].map(index=>({id:target+index,resourceName:`Voice_${target}_Greetings_Idel_0${index}`,exactResource:true})));
  const data={appearances:[{id:'12',characterId:'actor',ownVoice:true},{id:'station',stationDrawingId:'drawing'}],stationDrawings:{drawings:[{id:'drawing',skinId:'12',peopleId:'person',gospelId:'actor',voiceIds:[]}]},mainViewVoices:{voices:rows},voices:[],storyVoices:[]};
  assert.deepEqual(mainViewIdleVoices(data,{appearanceId:'station'}).map(row=>row.id),['person1','person2']);
  data.stationDrawings.drawings[0].peopleId='';assert.deepEqual(mainViewIdleVoices(data,{appearanceId:'station'}).map(row=>row.id),['actor1','actor2']);
  assert.deepEqual(mainViewIdleVoices(data,{appearanceId:'12'}).map(row=>row.id),['121','122']);
  data.appearances[0].ownVoice=false;assert.deepEqual(mainViewIdleVoices(data,{appearanceId:'12'}).map(row=>row.id),['actor1','actor2']);
  assert.deepEqual(voiceCatalog(data,[{appearanceId:'station'},{appearanceId:'12'}],'main-view-idle').map(row=>row.id),['actor1','actor2']);
  assert.deepEqual(mainViewIdleVoices(data,{appearanceId:'absent'}),[]);
});
test('hot spring source overrides include earlier favor tiers and never fall back while locked',()=>{
  const source={appearances:[{id:'12',characterId:'2',ownVoice:false}],voices:[],storyVoices:[],mainViewVoices:{hotSpringProfiles:[{id:'12',tiers:[['a','b'],['c']]}],favorVoices:['a','b','c'].map(name=>({id:'favor:'+name,resourceName:name,exactResource:true})),voices:[{id:'fallback',targetId:'2',type:3,resourceName:'normal'}]}};
  assert.deepEqual(mainViewTouchVoices(source,{appearanceId:'12',hotSpringFavorLevel:0}),[]);
  assert.deepEqual(mainViewTouchVoices(source,{appearanceId:'12',hotSpringFavorLevel:1}).map(row=>row.resourceName),['a','b']);
  assert.deepEqual(mainViewTouchVoices(source,{appearanceId:'12',hotSpringFavorLevel:2}).map(row=>row.resourceName),['a','b','c']);
  assert.deepEqual(voiceCatalog(source,[{appearanceId:'12',hotSpringFavorLevel:0}],'main-view-touch'),[]);
  source.hotSpringRoles=[{skinId:'12'}];delete source.mainViewVoices.hotSpringProfiles;assert.deepEqual(mainViewTouchVoices(source,{appearanceId:'12'}),[]);
});
test('local source voice catalogue preserves references reassigned by the newer tables',t=>{
  if(!fs.existsSync('public/assets/library.json')){t.skip('Local game resources are not installed');return;}
  const library=JSON.parse(fs.readFileSync('public/assets/library.json')),source=library.mainViewVoices;if(!source){t.skip('Local catalogue predates main-view voice metadata');return;}
  assert.equal(source.voices.length,624);assert.equal(source.voices.filter(row=>row.type===3).length,367);assert.equal(source.voices.filter(row=>row.type!==3).length,257);assert.ok(source.voices.every(row=>row.exactResource));
  const current=new Map(library.voices.map(row=>[row.id,row])),changed=source.voices.filter(row=>row.type===3&&current.get(row.id)?.resourceName!==row.resourceName),audio=JSON.parse(fs.readFileSync('public/assets/audio-index.json')).entries;
  assert.equal(changed.length,45);for(const row of changed)assert.ok(audio.some(entry=>entry.name===row.resourceName&&entry.clips.length),'Original clip is missing: '+row.resourceName);
});
test('voice selection includes exact character and skin targets, not unrelated rows',()=>{assert.equal(voiceCatalog(library,[{bundle:'Spines/skin'}]).length,2);assert.equal(voiceCatalog(library,[{appearanceId:'skin'}]).length,2);assert.equal(voiceCatalog(library,[{id:'Spines/skin'}]).length,2);assert.deepEqual(voiceCatalog(library,[{id:'unknown'}]),[]);});
test('story library exposes all source rows without inferring artwork associations',()=>{const rows=voiceCatalog(library,[{appearanceId:'skin'}],'story');assert.equal(rows.length,2);assert.equal(rows[0].title,'Voice_Plot_1');assert.equal(rows[1].title,'Story line 2');assert.notEqual(rows[0].key,voiceCatalog(library,[{appearanceId:'skin'}])[0].key);assert.equal(rows[0].targetId,undefined);});
test('voice search matches subtitle, identifier, resource and title',()=>{assert.equal(voiceCatalog(library,[],'story',' STORY TEXT ').length,1);assert.equal(voiceCatalog(library,[{appearanceId:'skin'}],'scene','login').length,1);assert.equal(voiceCatalog(library,[{appearanceId:'skin'}],'scene','Voice_Skin').length,1);assert.equal(voiceCatalog(library,[],'story','2').length,1);});
test('saved voice lookup matches the identifier and resource instead of unrelated subtitles',()=>{assert.equal(savedVoiceRow({id:'1',name:'SoundRes/a_sound_voiceeff/Voice_Login'},library.voices).text,'Hello');assert.equal(savedVoiceRow({id:'3',name:'Voice_Login'},library.voices).text,'');});
test('the complete character library retains voices without artwork and searches original target IDs',()=>{
  const rows=voiceCatalog(library,[],'all');assert.equal(rows.length,library.voices.length);assert.equal(rows[2].targetId,'other');assert.equal(rows[2].label,'other · Other · Other');assert.equal(rows[2].title,'Other');assert.equal(rows[2].kind,'character');assert.equal(voiceCatalog(library,[],'all','other').length,1);assert.equal(rows[0].key,voiceCatalog(library,[{appearanceId:'skin'}])[0].key);
});
test('hot spring scopes follow explicit level pools rather than target or filename guesses',()=>{
  const data={...library,appearances:[{id:'skin',characterId:'actor',bundle:'Spines/skin',hotSpringRoleId:'actor'}],hotSpringRoles:[{id:'actor',skinId:'onsen-skin',levels:[{level:1,voiceIds:['2','missing']},{level:2,voiceIds:['2','1','missing']}]}]};
  assert.equal(hotSpringRole(data,{presentation:{id:'Spines/skin'}}).id,'actor');assert.deepEqual(voiceCatalog(data,[{id:'Spines/skin'}],'hot-spring').map(row=>row.id),['2','missing']);
  assert.deepEqual(voiceCatalog(data,[{id:'Spines/skin',hotSpringLevel:2}],'hot-spring').map(row=>row.id),['2','1','missing']);assert.equal(voiceCatalog(data,[{id:'Spines/skin'}],'hot-spring','missing')[0].resourceName,'');assert.equal(voiceCatalog(data,[{id:'unknown'}],'hot-spring').length,0);assert.equal(voiceCatalog(data,[{id:'Spines/skin',hotSpringLevel:5}],'hot-spring').length,0);
});
test('a hot spring house exposes both declared roles without unrelated conversation pools',()=>{
  const data={...library,appearances:[{id:'house',bundle:'onsen/house',hotSpringRoleIds:['a','b']}],hotSpringRoles:[{id:'a',skinId:'skin-a',levels:[{level:1,voiceIds:['1']}]},{id:'b',skinId:'skin-b',levels:[{level:1,voiceIds:['2']}]},{id:'c',skinId:'skin-c',levels:[{level:1,voiceIds:['3']}]}]};
  assert.deepEqual(voiceCatalog(data,[{id:'onsen/house'}],'scene').map(row=>row.id),['1','2']);
});
