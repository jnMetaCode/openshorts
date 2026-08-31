import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'os-reuse-home-'));
process.env.OPENSHORTS_HOME = HOME;
const { runKoubo } = await import('../src/pipeline/koubo-run.mjs');

/** 不联网：假的 TTS 端点会被 Edge TTS 打到，所以这里只用「已经有配音缓存」的项目来验复用路径 */
const mkProject = (dir, texts) => ({
  schemaVersion: 2, id: 'reuse', line: 'koubo', title: 't', topic: 't', inputs: {},
  output: { w: 180, h: 320, fps: 10 },
  voice: { provider: 'edge-tts', voice: 'v1', rate: 1 },
  captions: { preset: 'douyin', maxChars: 16 },
  defaults: { visualSource: 'solid', cutEverySec: 4, localDirs: [] }, bgm: null,
  shots: texts.map(([id, text]) => ({
    id, text, visualIntent: '', query: '', emphasis: [],
    visual: { source: 'solid', provider: null, file: null, candidateId: null, cost: { kind: 'free' } },
    audio: null, durationSec: null, status: 'planned',
  })),
  publish: { titles: ['t'], tags: [], note: '', aiLabel: false, aiLabelText: '' }, provenance: [], ao: {},
});

/** 假配音：写一段真 mp3（ffmpeg 生成），返回固定词表——整条流水线因此可以离线跑 */
const makeTts = (counter) => async (text, { outFile }) => {
  counter.calls.push(text);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1.5', '-c:a', 'libmp3lame', outFile]);
  const chars = [...text];
  const per = 1500 / chars.length;
  return { file: outFile, buffer: null, durationMs: 1500, words: chars.map((c, i) => ({ text: c, startMs: Math.round(i * per), endMs: Math.round((i + 1) * per) })) };
};

test('单镜重出：只重出指定那一镜，其余复用配音与分段', { skip: !hasFfmpeg && '无 ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-reuse-'));
  const counter = { calls: [] };
  const opts = { outDir: dir, synthesizeImpl: makeTts(counter) };

  let p = await runKoubo(mkProject(dir, [['hook', '第一句话'], ['s1', '第二句话'], ['s2', '第三句话']]), opts);
  assert.equal(counter.calls.length, 3, '第一次三镜都要配音');
  assert.ok(p.shots.every((s) => s.render?.audioFingerprint && s.render.segmentFingerprint), '每镜都要记下指纹');

  // 原样重跑：一句配音都不该再发
  counter.calls = [];
  p = await runKoubo(JSON.parse(JSON.stringify(p)), opts);
  assert.deepEqual(counter.calls, [], '什么都没改就不该重新配音');

  // 改一镜文案：只有那一镜重配
  counter.calls = [];
  const edited = JSON.parse(JSON.stringify(p));
  edited.shots[1].text = '第二句话改过了';
  p = await runKoubo(edited, opts);
  assert.deepEqual(counter.calls, ['第二句话改过了'], '只有改过的那一镜重配音');

  // --only 强制重出某镜：文案没动，所以配音仍然复用（重出的是画面）
  counter.calls = [];
  p = await runKoubo(JSON.parse(JSON.stringify(p)), { ...opts, only: ['s2'] });
  assert.deepEqual(counter.calls, [], '重出画面不该连配音一起重来');
  // 不断言 quality.pass：这台机器的 ffmpeg 有没有 libass 会左右字幕那一项，跟复用逻辑无关
  assert.ok(fs.existsSync(p.final.file), '重出后仍然出得来成片');
  assert.ok(p.shots.every((s) => s.status === 'ready'));

  // 换语速：整条片的配音都变了，必须全部重配
  counter.calls = [];
  const faster = JSON.parse(JSON.stringify(p)); faster.voice.rate = 1.2;
  await runKoubo(faster, opts);
  assert.equal(counter.calls.length, 3, '换语速要全部重配');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('--only 指定了不存在的镜头要立刻报错，并把有哪些镜头列出来', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-reuse2-'));
  const project = mkProject(dir, [['hook', 'a'], ['s1', 'b']]);
  await assert.rejects(() => runKoubo(project, { outDir: dir, only: ['s9'] }), /没有这些镜头：s9.*hook、s1/s);
  fs.rmSync(dir, { recursive: true, force: true });
});
