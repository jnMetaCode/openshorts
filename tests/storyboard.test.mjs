import assert from 'node:assert/strict';
import test from 'node:test';
import {buildStoryboard, createDraftProject, estimateFrames, parseCharacterBible, splitSentences, storyboardMarkdown} from '../shared/storyboard.mjs';

test('中文文案可以按标点切句并估算旁白时长', () => {
  assert.deepEqual(splitSentences('长安醒来。万国来朝！'), ['长安醒来。', '万国来朝！']);
  assert.ok(estimateFrames('这是一段用于测试的中文旁白', 30) >= 90);
});

test('角色设定被注入所有主体提示词', () => {
  const board = buildStoryboard({title:'测试',text:'李白走进长安城。月光落在酒杯上。',characterBible:'李白：白袍，束发，三十岁，腰间佩剑'});
  assert.equal(parseCharacterBible('李白：白袍')[0].name, '李白');
  assert.ok(board.scenes[0].assets.find((item) => item.role === 'primary').prompt.includes('白袍'));
});

test('分镜可以组装为横屏和竖屏可编辑项目', () => {
  const wide = createDraftProject(buildStoryboard({text:'第一幕开始。第二幕继续。',aspect:'16:9'}), 'wide');
  const portrait = createDraftProject(buildStoryboard({text:'第一幕开始。第二幕继续。',aspect:'9:16'}), 'portrait');
  assert.deepEqual([wide.width, wide.height], [1920,1080]); assert.deepEqual([portrait.width, portrait.height], [1080,1920]);
  assert.ok(wide.scenes.every((scene) => scene.layers.length === 5));
  assert.match(storyboardMarkdown(buildStoryboard({text:'第一幕开始。'})), /分镜与素材需求单/);
});
