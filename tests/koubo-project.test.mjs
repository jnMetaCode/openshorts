import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKouboProject, parseJsonLoose } from '../src/project/koubo.mjs';

const aoResult = { name: '口播科普', success: true, steps: [
  { id: 'script', status: 'completed', output: '好的，脚本如下：\n{"hook":"猫为什么总爱钻纸箱？","segments":[{"id":"s1","text":"第一段","visualIntent":"猫钻箱","query":"cat inside cardboard box","emphasis":["安全感"]},{"id":"s2","text":"第二段","visualIntent":"猫科动物伏击","query":"wild cat stalking grass"}],"outro":"关注我，下期讲狗。"}' },
  { id: 'meta', status: 'completed', output: '{"titles":["猫钻纸箱的真相","T2","T3"],"tags":["猫","科普"],"publishNote":"晚 8 点发","aiLabel":"含 AI 配音"}' },
] };

test('从 AO 结果建口播项目：钩子 + 段 + 收尾 = 镜头，发布信息齐全', () => {
  const p = buildKouboProject(aoResult, { topic: '猫为什么爱钻纸箱', defaults: { voice: 'zh-CN-YunxiNeural' } });
  assert.equal(p.schemaVersion, 2); assert.equal(p.line, 'koubo');
  assert.deepEqual(p.shots.map((s) => s.id), ['hook', 's1', 's2', 'outro']);
  assert.equal(p.shots[0].query, 'cat inside cardboard box', '钩子借用第一段的画面');
  assert.deepEqual(p.shots[1].emphasis, ['安全感']);
  assert.equal(p.title, '猫钻纸箱的真相'); assert.equal(p.voice.voice, 'zh-CN-YunxiNeural');
  assert.equal(p.publish.tags.length, 2); assert.equal(p.publish.aiLabel, true);
});

test('parseJsonLoose 容忍前言与代码块；缺 segments 报错', () => {
  assert.equal(parseJsonLoose('```json\n{"a":1}\n```').a, 1);
  assert.throws(() => buildKouboProject({ steps: [{ id: 'script', status: 'completed', output: '{"hook":"x"}' }] }), /segments/);
});

test('选"只用纯色底"时每个镜头标 solid，run 不会去查素材库', () => {
  const p = buildKouboProject(aoResult, { topic: 'x', defaults: { visualSource: 'solid' } });
  assert.ok(p.shots.every((s) => s.visual.source === 'solid'));
  const q = buildKouboProject(aoResult, { topic: 'x' });
  assert.ok(q.shots.every((s) => s.visual.source === null));
});
