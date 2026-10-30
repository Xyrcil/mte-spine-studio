import test from 'node:test';
import assert from 'node:assert/strict';
import chinese from '../src/locales/zh-CN.js';
import {translate,t,setLocale,getLocale,normalizeLocale,formatMessage} from '../src/i18n.js';

test('interface language is explicit, reversible and separate from source identifiers',()=>{
  assert.equal(normalizeLocale('zh-TW'),'zh-CN');assert.equal(normalizeLocale('en-US'),'en');
  setLocale('zh-CN');assert.equal(getLocale(),'zh-CN');assert.equal(t('Menu'),'菜单');
  setLocale('en');assert.equal(t('Menu'),'Menu');assert.throws(()=>setLocale('jp'),/Unsupported/);
  for(const source of ['Voice_3016024_Touch_Head','Spines/painting/301602402_spine','click_head','塞蕾丝蒂娜'])assert.equal(translate(source,'zh-CN'),source);
});
test('catalogue templates preserve placeholders, numeric units and source data',()=>{
  for(const [key,value] of Object.entries(chinese))assert.deepEqual([...key.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...value.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),key);
  assert.equal(translate('Voices (42)','zh-CN'),'语音（42）');
  assert.equal(translate('Skin · 4 Spine layers','zh-CN'),'皮肤 · 4 个 Spine 图层');
  assert.equal(translate('Captured: Custom name · 2 objects','zh-CN'),'已捕获：Custom name · 2 个对象');
  assert.equal(translate('  Pause  ','zh-CN'),'  暂停  ');
  assert.equal(translate('Voice unavailable (cn): Voice_Test','zh-CN'),'语音不可用（cn）：Voice_Test');
  assert.equal(formatMessage('{name} · {count}',{name:'<b>source</b>',count:0}),'<b>source</b> · 0');
  assert.equal(translate('Main-view entry','zh-CN'),'主页语音 入场');
  assert.equal(translate('Main-view birthday','zh-CN'),'主页语音 生日问候');
  assert.equal(translate('Skin · 4 Spine layers','en'),'Skin · 4 Spine layers');
});
