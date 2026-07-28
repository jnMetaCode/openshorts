import test from 'node:test';
import assert from 'node:assert/strict';
import {attachGenerationTrace, retimeProjectFromNarration, retimeScene, reviewAssets} from '../shared/review.mjs';

const assetProject = () => ({fps:30,production:{assetPlan:[{id:'a',status:'assigned'},{id:'b',status:'planned'}]},scenes:[]});

test('素材支持批量批准并保留审核历史', () => {
  const result = reviewAssets(assetProject(),{assetIds:['a','b'],status:'approved',note:'构图通过'});
  assert.equal(result.updated,2); assert.equal(result.project.production.assetPlan[0].reviewHistory[0].note,'构图通过');
});

test('生成来源记录模型、种子和参数', () => {
  const project = attachGenerationTrace(assetProject(),'a',{provider:'comfyui',model:'flux',seed:42,parameters:{steps:28}});
  assert.equal(project.production.assetPlan[0].generation.seed,42); assert.equal(project.production.assetPlan[0].generation.parameters.steps,28);
});

test('镜头重排同比缩放字幕、延迟和关键帧', () => {
  const scene = {id:'s',durationFrames:100,captions:[{text:'字幕',fromFrame:10,toFrame:90,words:[{text:'字',fromFrame:10,toFrame:30}]}],layers:[{delayFrames:20,keyframes:[{frame:50},{frame:99}]}]};
  const next = retimeScene(scene,200); assert.equal(next.captions[0].fromFrame,20); assert.equal(next.captions[0].words[0].toFrame,60); assert.equal(next.layers[0].delayFrames,40); assert.equal(next.layers[0].keyframes[0].frame,100);
});

test('按旁白时长只更新已有时长的镜头', () => {
  const project = {fps:30,scenes:[{id:'s1',durationFrames:30,captions:[],layers:[]},{id:'s2',durationFrames:60,captions:[],layers:[]}]};
  const result = retimeProjectFromNarration(project,{s1:2},0); assert.equal(result.updated,1); assert.equal(result.project.scenes[0].durationFrames,60); assert.equal(result.project.scenes[1].durationFrames,60);
});
