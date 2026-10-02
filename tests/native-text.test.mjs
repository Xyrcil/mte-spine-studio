import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutNativeText} from '../src/engine/native-text.js';
import {createNativeVisuals} from '../src/engine/native-visuals.js';
import {omittedVisualWarnings} from '../src/engine/export-source.js';

const font={settings:{m_FontSize:16,m_LineSpacing:1,m_FontStyle:0,m_HorizontalOverflow:1,m_VerticalOverflow:1,m_Alignment:3},metrics:{m_FontSize:16,m_Ascent:12,m_Descent:-4,m_LineSpacing:20,m_Tracking:1,m_CharacterSpacing:0,m_ShouldRoundAdvanceValue:true}};
test('native text preserves original rounded advances, authored spacing and middle-left anchors',()=>{
  const flow=layoutNativeText('AB\nC',()=>10.5,font,{x:100,y:40},{x:.5,y:.5},{x:3,y:2});assert.deepEqual(flow.glyphs,[{character:'A',x:-50,y:6,line:0},{character:'B',x:-37,y:6,line:0},{character:'C',x:-50,y:-16,line:1}]);assert.equal(flow.width,20);assert.equal(flow.height,36);
  assert.equal(layoutNativeText('A',()=>11.5,font,{x:0,y:0},{x:0,y:.5}).width,12);
  assert.throws(()=>layoutNativeText('<b>A</b>',()=>10,font,{x:0,y:0},{x:0,y:0}),/unsupported/);
});
test('native text scales original face metrics and does not invent wrapping or automatic sizing',()=>{
  const scaled={...font,settings:{...font.settings,m_FontSize:32,m_Alignment:8}};const flow=layoutNativeText('AB',()=>20,scaled,{x:100,y:40},{x:.5,y:.5});assert.equal(flow.glyphs[0].x,10);assert.equal(flow.glyphs[0].y,-12);assert.equal(flow.ascent,24);
  assert.throws(()=>layoutNativeText('A',()=>10,{...font,settings:{...font.settings,m_BestFit:1}},{x:1,y:1},{x:0,y:0}),/unsupported/);
  assert.throws(()=>layoutNativeText('A',()=>NaN,font,{x:1,y:1},{x:0,y:0}),/advance/);
});
test('native text color and spacing curves share the animation clock and restore independently',()=>{
  const load=()=>{const node={id:'rootT',data:{m_GameObject:{m_PathID:'root'},m_Children:[]}},slot={source:{gameObject:'root',transform:'rootT',data:{m_Script:{m_PathID:'text'}}},modifier:{data:{m_Script:{m_PathID:'spacing'}}},color:{r:1,g:1,b:1,a:1},spacing:{x:0,y:0},used:false},curve=(attribute,script)=>({path:'',classID:114,attribute,script:{m_PathID:script},curve:{m_Curve:[{time:0,value:0},{time:2,value:2}]}}),group={nodes:new Map([['rootT',node]]),transforms:new Map([['root',node]]),nativeTextLayer:{slots:[slot]},presentation:{visualAnimations:[{id:'animation',type:'Animation',data:{m_GameObject:{m_PathID:'root'},m_Animation:{m_PathID:'clip'},m_PlayAutomatically:true}},{id:'clip',type:'AnimationClip',data:{m_Legacy:true,m_WrapMode:2,m_FloatCurves:[curve('m_Color.a','text'),curve('spacing_x','spacing')]}}]}};createNativeVisuals(group,'/',{loadTexture(){}});return {group,slot,model:group.nativeAnimations[0].model};};
  const a=load();assert.ok(a.model,a.group.nativeAnimations[0].reason);assert.equal(a.slot.used,true);a.model.advance(1);assert.equal(a.slot.color.a,1);assert.equal(a.slot.spacing.x,1);const b=load();b.model.restore(a.model.snapshot());assert.deepEqual(b.slot,a.slot);a.model.advance(.3);assert.notEqual(a.slot.spacing.x,b.slot.spacing.x);
});
test('unsupported native text effects are reported only when their field is in the visible export',()=>{
  const slot={used:true,reason:'Native text vertex-gradient effect is not restored',source:{transform:'text'}},group={visible:true,nativeTextLayer:{slots:[slot]},isActiveTransform:()=>true};assert.deepEqual(omittedVisualWarnings([group],{}),['Some source native text or text effects are not rendered']);slot.used=false;assert.deepEqual(omittedVisualWarnings([group],{}),[]);group.nativeTextLayer.reason='Original native text font is unavailable';assert.equal(omittedVisualWarnings([group],{}).length,1);group.visible=false;assert.deepEqual(omittedVisualWarnings([group],{}),[]);
});
