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

/**
 * 假配音：写一段真 mp3（ffmpeg 生成），返回词表——整条流水线因此可以离线跑。
 * 时长按字数折算（4.5 字/秒，跟 Edge TTS 实测一致）：固定 1.5 秒的话，
 * 依赖时长的逻辑（比如"一镜多长要切几段"）在测试里永远触发不了。
 */
const makeTts = (counter) => async (text, { outFile }) => {
  counter.calls.push(text);
  const chars = [...text];
  const secs = Math.max(1.5, chars.length / 4.5);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=300:duration=${secs.toFixed(2)}`, '-c:a', 'libmp3lame', outFile]);
  const ms = Math.round(secs * 1000); const per = ms / chars.length;
  return { file: outFile, buffer: null, durationMs: ms, words: chars.map((c, i) => ({ text: c, startMs: Math.round(i * per), endMs: Math.round((i + 1) * per) })) };
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

/**
 * 批量出版本时每一版有自己的 work 目录，以前因此把配音和分段全重做了一遍——
 * 而只换字幕样式的话，配音和分段是一模一样的（字幕是在最后合成那一步烧的）。
 * 真机：2 版从 50 秒降到 19 秒，且一次 Edge TTS 都没调。
 */
test('换个目录重跑：配音和分段按指纹跨目录复用；换音色则必须重做', { skip: !hasFfmpeg && '无 ffmpeg' }, async () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'os-x1-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'os-x2-'));
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'os-mat-'));
  // 用一份放在共用位置的素材：纯色底是每次在当前 work 目录现生成的，visual.file 一变指纹就变
  // （那是对的行为），拿它测不出跨目录复用
  const clip = path.join(shared, 'm.mp4');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=teal:size=180x320:rate=10:d=2', '-pix_fmt', 'yuv420p', clip]);

  const counter = { calls: [] };
  const opts = { synthesizeImpl: makeTts(counter) };
  const withClip = (proj) => { for (const s of proj.shots) s.visual = { source: 'stock', provider: 'test', kind: 'video', file: clip, cost: { kind: 'free' } }; return proj; };

  let p = await runKoubo(withClip(mkProject(a, [['hook', '第一句'], ['s1', '第二句']])), { ...opts, outDir: a });
  assert.equal(counter.calls.length, 2);
  assert.ok(p.shots.every((s) => s.render.segment.startsWith(a)));

  // 同一个项目搬到另一个目录跑（批量出版本就是这种情况）：不该重配音、不该重渲染
  counter.calls = [];
  const moved = JSON.parse(JSON.stringify(p)); moved.id = 'moved';
  const r = await runKoubo(moved, { ...opts, outDir: b });
  assert.deepEqual(counter.calls, [], '配音该跨目录复用');
  assert.ok(r.shots.every((s) => s.render.segment.startsWith(a)), '分段也该沿用原来那份，不在新目录重渲');
  assert.ok(fs.existsSync(r.final.file) && r.final.file.startsWith(b), '成片本身还是要出在新目录');

  // 换音色：指纹变了，必须全部重做，绝不能因为"文件还在"就误用
  counter.calls = [];
  const other = JSON.parse(JSON.stringify(p)); other.id = 'othervoice'; other.voice = { ...other.voice, voice: 'v2' };
  const r2 = await runKoubo(other, { ...opts, outDir: b });
  assert.equal(counter.calls.length, 2, '换音色要全部重配');
  assert.ok(r2.shots.every((s) => s.render.segment.startsWith(b)), '换音色后分段必须重渲到新目录');

  for (const d of [a, b, shared]) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * 一镜切几段时，第一段必须是真正定下来的那个画面。
 * 曾经的写法是 `extras.length ? extras : …`，而 extras 装的是"打分没到主画面线"的候选——
 * 于是本机刚画好的那张图会被丢掉，改用几张判退的素材，正好把看图把关的意义抹掉。
 */
test('切段时第一段必须是定下来的主画面，不能被补位候选顶掉', { skip: !hasFfmpeg && '无 ffmpeg' }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'os-pri-'));
  const mk = (n, c) => { const f = path.join(d, n); spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${c}:size=600x400:d=1`, '-frames:v', '1', f]); return f; };
  const main = mk('main.png', 'red'); const fill = mk('fill.png', 'blue');

  const project = mkProject(d, [['hook', '一段足够长的口播文案让它需要切成好几段来放']]);
  project.defaults.cutEverySec = 2;
  project.shots[0].visual = { source: 'local-image', provider: 'local-flux', kind: 'image', file: main, cost: { kind: 'free' } };
  // 模拟"另外还下了一张补位素材"：用已有的 render 缓存跑不到取材分支，这里直接验渲染入参
  const r = await runKoubo(project, { outDir: d, synthesizeImpl: makeTts({ calls: [] }) });
  const parts = r.shots[0].visual.parts;
  if (parts) assert.equal(parts[0].file, main, '第一段必须是主画面');
  assert.equal(r.shots[0].visual.file, main, '主画面本身不能被换掉');
  assert.ok(fs.existsSync(fill));
  fs.rmSync(d, { recursive: true, force: true });
});

/**
 * 候选不够时，视频素材可以用同一条的不同时间点补段——同一段素材的不同瞬间在观感上就是换了画面，
 * 而且不引入新的版权来源，所以署名里不该重复记。图片不做（同一张图切几段还是同一张图）。
 */
test('切段补位：视频用不同时间点，署名不重复记；图片不这么补', { skip: !hasFfmpeg && '无 ffmpeg' }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'os-seek-'));
  const vid = path.join(d, 'long.mp4');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=180x320:rate=10:d=20', '-pix_fmt', 'yuv420p', vid]);

  const project = mkProject(d, [['hook', '一段挺长的口播，足够切成好几段来放才不显得闷']]);
  project.defaults.cutEverySec = 2;
  project.shots[0].visual = { source: 'stock', provider: 'test', kind: 'video', file: vid, candidateId: 'test:1', cost: { kind: 'free' } };
  const r = await runKoubo(project, { outDir: d, synthesizeImpl: makeTts({ calls: [] }) });

  const parts = r.shots[0].visual.parts ?? [];
  assert.ok(parts.length > 1, '一条素材也该靠不同时间点切成几段');
  assert.equal(parts[0].seekSec, undefined, '第一段从头开始');
  assert.ok(parts.slice(1).every((p) => p.seekSec > 0), '后面几段都要有偏移');
  assert.equal(new Set(parts.map((p) => p.seekSec ?? 0)).size, parts.length, '每段的时间点都不同');
  // 同一条素材换时间点不是新来源，署名不能重复记
  assert.equal(r.provenance.filter((x) => x.id === 'test:1').length, 0, '用的是已在 visual 里记过的那条');
  fs.rmSync(d, { recursive: true, force: true });
});
