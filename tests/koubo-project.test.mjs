import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildKouboProject, parseJsonLoose, uniqueProjectId, repairJson, scriptWarnings, lengthWarning } from '../src/project/koubo.mjs';

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

test('同一个话题跑第二次不该覆盖上一条片子', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-uid-'));
  assert.equal(uniqueProjectId(dir, '猫为什么钻纸箱'), '猫为什么钻纸箱', '目录空着就用干净的 id');

  fs.mkdirSync(path.join(dir, '猫为什么钻纸箱'), { recursive: true });
  fs.writeFileSync(path.join(dir, '猫为什么钻纸箱', 'project.json'), '{"id":"猫为什么钻纸箱"}');
  const second = uniqueProjectId(dir, '猫为什么钻纸箱');
  assert.notEqual(second, '猫为什么钻纸箱', 'new 每次都是新写的脚本，即使话题一样也是另一条片子');
  assert.match(second, /^猫为什么钻纸箱-\d{8}$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * 模型最常犯的一种 JSON 破损：字符串值里夹了没转义的英文双引号。
 * 真机原话：{"hook": "…它只是在"报警"。"} —— 以前整条 new 直接崩一个原始堆栈，脚本白写、token 白花。
 */
test('模型写坏的 JSON：字符串里没转义的引号要能修回来，正常 JSON 不能被改坏', () => {
  const broken = '{"hook": "它只是在"报警"。", "segments": [{"id":"s1","text":"他说"好"，然后走了"}]}';
  assert.throws(() => JSON.parse(broken), '前提：原生 parse 确实过不了');
  const p = parseJsonLoose(broken);
  assert.equal(p.hook, '它只是在"报警"。');
  assert.equal(p.segments[0].text, '他说"好"，然后走了');

  // 正常 JSON 必须原样通过（修复逻辑不能反过来把好的改坏）
  for (const good of ['{"a":"x","b":[1,2],"c":{"d":"带 \\" 转义的引号"}}', '{"a":"结尾是引号\\""}', '{"a":""}', '{"a":"逗号, 冒号: 括号}"}']) {
    assert.deepEqual(parseJsonLoose(good), JSON.parse(good), good);
  }

  // 修不回来的照样要报错，而且是人话
  assert.throws(() => parseJsonLoose('{"a": }'), /解析不了/);
  assert.throws(() => parseJsonLoose('没有 JSON'), /没有 JSON 对象/);
  assert.throws(() => parseJsonLoose(''), /空输出/);
});

/**
 * 模型偶尔把英文单词当中文词用（真机：「次磺酸又迅速 rearrange」「学名叫 petrichor」）。
 * Edge TTS 会照着念出一个英文词（实测 575ms，跟中文词一样长），字幕上也是一串拉丁字母——
 * 中文科普片里很出戏。缩写除外：AI / DNA / CT 中文里本来就念字母。
 */
test('口播文本的可朗读检查：夹在句子里的英文单词要报，缩写不报', () => {
  assert.equal(scriptWarnings([{ id: 's1', text: '纯中文一句话' }]).length, 0);
  assert.equal(scriptWarnings([{ id: 's1', text: 'AI 生成要标注，DNA 检测也一样，用 USB 传' }]).length, 0, '缩写中文里本来就念字母');

  const w = scriptWarnings([{ id: 's2', text: '次磺酸又迅速 rearrange，变成丙烯硫醚' }]);
  assert.equal(w.length, 1);
  assert.match(w[0], /rearrange/);
  assert.match(w[0], /镜头 s2/);

  // 同一镜多个词合并成一条，不刷屏
  const many = scriptWarnings([{ id: 's3', text: '叫 petrichor 也叫 geosmin，是 petrichor 的来源' }]);
  assert.equal(many.length, 1);
  assert.match(many[0], /petrichor、geosmin/, '去重且合并');
});

/**
 * 脚本长度对不对得上目标时长。模板里写了字数区间，但模型时灵时不灵——真机同一话题两次
 * 分别是 278 字（60 秒目标，在 243–297 区间内）和 183 字（短 32%）。提示词管不住的事，
 * 至少不能让它悄悄过去：写少了成片就是比你要的短一大截。
 */
test('脚本长度偏离目标时长要报出来，容差内不吵', () => {
  const mk = (n) => [{ id: 's1', text: '字'.repeat(n) }];
  assert.equal(lengthWarning(mk(270), '60秒'), null, '正中不报');
  assert.equal(lengthWarning(mk(243), '60秒'), null, '−10% 在容差内');
  assert.match(lengthWarning(mk(183), '60秒'), /短 32%/, '真机这次');
  assert.match(lengthWarning(mk(165), '45秒'), /短 19%/, '更早那次');
  assert.match(lengthWarning(mk(400), '60秒'), /长 \d+%/);
  assert.equal(lengthWarning(mk(270), ''), null, '没给目标时长就别猜');
  assert.equal(lengthWarning(mk(270), '一分钟'), null, '解析不出数字也别猜');

  // 要跟"夹英文单词"一起进 scriptWarnings，一次说完
  const w = scriptWarnings([{ id: 's1', text: '短' + 'x'.repeat(0) }], '60秒');
  assert.ok(w.some((x) => /秒/.test(x)));
});
