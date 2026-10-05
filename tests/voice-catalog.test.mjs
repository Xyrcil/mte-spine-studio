import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceCatalog,savedVoiceRow,hotSpringRole,stationVoiceBinding} from '../src/engine/voice-catalog.js';
const library={appearances:[{id:'skin',characterId:'actor',bundle:'Spines/skin'}],voices:[{id:'1',targetId:'actor',title:'Login',resourceName:'Voice_Login',text:'Hello'},{id:'2',targetId:'skin',title:'Costume',resourceName:'Voice_Skin',text:'Hello again'},{id:'3',targetId:'other',title:'Other',resourceName:'Other'}],storyVoices:[{id:'1',resourceName:'Voice_Plot_1',text:'Story text'},{id:'2',resourceName:'',text:'Unvoiced text'}]};
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
