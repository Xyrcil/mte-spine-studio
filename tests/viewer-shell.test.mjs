import test from 'node:test';
import assert from 'node:assert/strict';
import {menuPosition,uiHiddenPreference,initialUiHidden,uiShortcutPreference} from '../src/viewer-shell.js';

test('viewer menu stays within each viewport edge and keeps its pointer origin',()=>{
  assert.deepEqual(menuPosition(1400,880,292,450,1440,900),{left:1136,top:438,origin:'bottom-right'});
  assert.deepEqual(menuPosition(40,50,292,450,1440,900),{left:40,top:50,origin:'top-left'});
  assert.deepEqual(menuPosition(0,0,292,450,320,600),{left:12,top:12,origin:'top-left'});
});

test('UI visibility has an explicit URL override without coercing saved values',()=>{
  assert.equal(uiHiddenPreference('?ui=0'),true);
  assert.equal(uiHiddenPreference('?ui=1',true),false);
  assert.equal(uiHiddenPreference('?other=1',true),true);
  assert.equal(uiHiddenPreference('?ui=unknown',true),true);
  assert.equal(uiHiddenPreference('',false),false);
  assert.equal(uiHiddenPreference('','true'),false);
  assert.equal(initialUiHidden(true),true);
  assert.equal(initialUiHidden(false),false);
});

test('the optional UI shortcut accepts a letter or off, with a safe default',()=>{
  assert.equal(uiShortcutPreference('u'),'U');
  assert.equal(uiShortcutPreference('Z'),'Z');
  assert.equal(uiShortcutPreference(''),'');
  for(const value of [null,undefined,42,'Escape','Ctrl+H'])assert.equal(uiShortcutPreference(value),'H');
});
