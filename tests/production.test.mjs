import test from 'node:test';
import assert from 'node:assert/strict';
import {activatePromptVersion, addPromptVersion, applyAssetMatches, matchAssets} from '../shared/production.mjs';

test('提示词创建新版本并可回切', () => {
  const first = {id:'scene-01-primary',prompt:'初稿',promptVersions:[{id:'pv-001',prompt:'初稿',note:'',createdAt:'2026-01-01'}],activePromptVersion:'pv-001'};
  const next = addPromptVersion(first, '精修稿', '加强角色锚点');
  assert.equal(next.activePromptVersion, 'pv-002');
  assert.equal(activatePromptVersion(next, 'pv-001').prompt, '初稿');
});

test('素材优先按计划 ID，其次按镜头和角色匹配', () => {
  const plans = [{id:'scene-01-primary',sceneId:'scene-01',role:'primary',name:'主体'}, {id:'scene-01-background',sceneId:'scene-01',role:'background',name:'背景'}];
  const matches = matchAssets(plans, [{path:'hero.png',assetPlanId:'scene-01-primary'}, {path:'bg.png',sceneId:'scene-01',role:'background'}]);
  assert.deepEqual(matches.map((item) => item.assetPlanId), ['scene-01-primary','scene-01-background']);
});

test('匹配结果写回素材计划和绑定图层', () => {
  const source = {production:{assetPlan:[{id:'a',sceneId:'s',role:'primary',name:'主体',status:'planned'}]},scenes:[{layers:[{assetPlanId:'a',src:'placeholder.svg'}]}]};
  const result = applyAssetMatches(source, [{path:'uploads/hero.png',assetPlanId:'a'}]);
  assert.equal(result.project.scenes[0].layers[0].src, 'uploads/hero.png');
  assert.equal(result.project.production.assetPlan[0].status, 'assigned');
});
