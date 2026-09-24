import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'os-chars-'));
process.env.OPENSHORTS_HOME = HOME;
const c = await import('../src/characters/cards.mjs');
const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'openshorts.mjs');

// 不整齐的输入：特征用顿号/换行/分号混着写、带首尾空白、有空项
const RAW = { name: ' 林七 ', basics: '23 岁东方女性，清冷', face: '丹凤眼，薄唇', marks: '眉心朱砂痣、\n左脸一道刀疤；；', outfit: '赤色暗纹束腰武侠袍', background: '' };
// 假出图：写一个 PNG 头的文件，记下收到的参数
const calls = [];
const fakeGen = async (prompt, o) => { calls.push({ prompt, ...o }); fs.writeFileSync(o.out, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])); return { model: 'flux-schnell-q2' }; };

test('新建：字段规整、名字做 id、重名不覆盖', () => {
  const a = c.saveCard(RAW);
  assert.equal(a.id, '林七');
  assert.deepEqual(a.marks, ['眉心朱砂痣', '左脸一道刀疤']);
  const b = c.saveCard(RAW);
  assert.notEqual(b.id, a.id, '同名第二张不能把第一张盖掉');
  assert.equal(c.listCards().length, 2);
  c.deleteCard(b.id);
  assert.throws(() => c.saveCard({ name: '空人' }), /至少写一项/);
  assert.throws(() => c.readCard('../../etc'), /not found/);
});

test('外形锁定段不带名字（编剧验收禁止角色名），特征一条不少', () => {
  const t = c.lockText(c.readCard('林七'), 'zh');
  assert.ok(!t.includes('林七'));
  for (const k of ['眉心朱砂痣', '左脸一道刀疤', '赤色暗纹束腰武侠袍', '丹凤眼']) assert.ok(t.includes(k), k);
  assert.match(c.lockText(c.readCard('林七'), 'en'), /^\[The lead's look is fixed/);
  const s = c.storyWithCard('破庙夜饮', c.readCard('林七'), 'zh');
  assert.equal(c.storyWithCard(s, c.readCard('林七'), 'zh'), s, '拼过一次不再重复拼');
});

test('出图：翻译后的英文进提示词；--keep-seed 沿用种子；旧图进历史；改卡后标"图是旧的"', async () => {
  const chat = async (_sys, user) => { assert.match(user, /朱砂痣/); return 'woman, red mole between brows, scar on left cheek'; };
  const a = await c.renderPortrait('林七', { gen: fakeGen, chat });
  assert.equal(a.portrait.translated, true);
  assert.match(calls.at(-1).prompt, /red mole/);
  assert.ok(Number.isInteger(a.portrait.seed) && a.portrait.seed > 0, '种子要落成具体数字，-1 的话"沿用种子"无从谈起');
  assert.equal(c.portraitStale(a), false);

  c.saveCard({ ...RAW, background: '竹林，晨雾' }, { id: '林七' });
  assert.equal(c.portraitStale(c.readCard('林七')), true);
  const b = await c.renderPortrait('林七', { gen: fakeGen, chat, keepSeed: true });
  assert.equal(b.portrait.seed, a.portrait.seed);
  assert.equal(calls.at(-1).seed, a.portrait.seed);
  assert.equal(b.history.at(-1).file, a.portrait.file);
  assert.equal(c.portraitStale(b), false);
  // 没有文本模型：原样用中文描述，并如实标出
  const d = await c.renderPortrait('林七', { gen: fakeGen });
  assert.equal(d.portrait.translated, false);
  assert.match(d.portrait.prompt, /竹林/);
});

test('上传面容图：认字节头不认扩展名；来源换成 upload 时整条替换，不残留种子/提示词', () => {
  assert.throws(() => c.setUploadedPortrait('林七', Buffer.from('GIF89a…')), /PNG/);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const u = c.setUploadedPortrait('林七', jpg, { note: '演员照' });
  assert.equal(u.portrait.source, 'upload');
  assert.match(u.portrait.file, /\.jpg$/);
  assert.equal(u.portrait.seed, null); assert.equal(u.portrait.prompt, null);
  const back = c.restorePortrait('林七', u.history.at(-1).file);
  assert.equal(back.portrait.source, 'local-flux');
  assert.equal(back.history.at(-1).source, 'upload');
});

test('种子运行目录：引擎续跑时两步算已完成、图在 assets、必填的 image_model 补上', () => {
  const card = c.readCard('林七');
  const dir = c.writeSeedRun(card, { inputs: { story: 'x', video_provider: 'local-sdcpp' } });
  assert.ok(!dir.includes('.ao-runs'), '不能放进引擎的运行目录，否则会被当成本次成片目录');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
  assert.deepEqual(meta.steps.map((s) => [s.id, s.status, s.output_var]), [['character_prompt', 'completed', 'character_prompt'], ['character', 'completed', 'character_img']]);
  assert.equal(meta.inputs.image_model, 'character-card');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'assets', 'character.png')), fs.readFileSync(c.portraitPath(card)));
  // 引擎按 "\n---\n" 切掉文件头，只把正文回灌下游
  const md = fs.readFileSync(path.join(dir, 'steps', '9-character.md'), 'utf-8');
  assert.equal(md.slice(md.indexOf('\n---\n') + 5).trim(), '![character](../assets/character.png)');
  assert.throws(() => c.writeSeedRun({ ...card, portrait: null }, { inputs: {} }), /还没有定妆图/);
});

test('drama --character：外形拼进 story，带着种子目录 --resume 交给引擎', () => {
  const ao = fs.mkdtempSync(path.join(os.tmpdir(), 'os-aostub-'));
  fs.mkdirSync(path.join(ao, 'dist'), { recursive: true }); fs.mkdirSync(path.join(ao, 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(ao, 'package.json'), '{"name":"stub","version":"0.0.0"}');
  fs.writeFileSync(path.join(ao, 'dist', 'cli.js'), 'console.log("ARGS " + JSON.stringify(process.argv.slice(2)));');
  const env = { ...process.env, OPENSHORTS_LANG: 'zh', OPENSHORTS_HOME: HOME, OPENSHORTS_AO_DIR: ao };
  const run = (...a) => spawnSync(process.execPath, [bin, 'drama', ...a], { encoding: 'utf-8', timeout: 60000, env });
  const r = run('-i', 'story=破庙夜饮', '--character', '林七', '-i', 'video_provider=local-sdcpp');
  const args = JSON.parse(r.stdout.match(/ARGS (\[.*\])/)[1]);
  const story = args[args.indexOf('-i') + 1];
  assert.match(story, /^story=破庙夜饮\n【主角外形已定/);
  assert.ok(story.includes('眉心朱砂痣'));
  assert.ok(!args.includes('--character'), '--character 是我们的开关，不能漏给引擎');
  const seed = args[args.indexOf('--resume') + 1];
  assert.ok(seed && fs.existsSync(path.join(seed, 'metadata.json')), `要带 --resume <种子目录>：${JSON.stringify(args)}`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(seed, 'metadata.json'), 'utf-8')).inputs.video_provider, 'local-sdcpp');
  // 找不到卡 / 没有 story 都要说清楚、非零退出
  assert.equal(run('-i', 'story=x', '--character', '不存在').status, 1);
  assert.match(run('--character', '林七').stderr, /story/);
  // 跟用户自己的 --resume 撞了：说清楚，不叠两个
  assert.match(run('-i', 'story=x', '--character', '林七', '--resume', 'last').stderr, /--resume/);
  fs.rmSync(ao, { recursive: true, force: true });
});

test('更新只改传了的字段：只改服装不能把标志特征清空；显式传空才清', () => {
  const before = c.readCard('林七');
  const a = c.saveCard({ outfit: '玄色夜行衣' }, { id: '林七' });
  assert.equal(a.outfit, '玄色夜行衣');
  assert.deepEqual(a.marks, before.marks);
  assert.equal(a.name, before.name);
  assert.deepEqual(c.saveCard({ marks: [] }, { id: '林七' }).marks, []);
  c.saveCard({ marks: before.marks, outfit: before.outfit }, { id: '林七' });
});

test('画幅：出图按片子画幅给尺寸；上传的图从文件头读宽高；竖图配横片要报', async () => {
  const a = await c.renderPortrait('林七', { gen: fakeGen, ratio: '16:9' });
  assert.deepEqual([calls.at(-1).width, calls.at(-1).height], [1152, 640]);
  assert.match(calls.at(-1).prompt, /medium-wide shot/);
  assert.equal(a.portrait.ratio, '16:9');
  assert.equal(c.ratioMismatch(a, '16:9'), false);
  assert.equal(c.ratioMismatch(a, '9:16'), true);
  // 手机竖拍 1080×1920 的 PNG（只要头）：配 16:9 的片要报，配竖版不报
  const png = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.writeUInt32BE(1080, 16); png.writeUInt32BE(1920, 20);
  const u = c.setUploadedPortrait('林七', png);
  assert.deepEqual([u.portrait.width, u.portrait.height, u.portrait.ratio], [1080, 1920, '9:16']);
  assert.equal(c.ratioMismatch(u, '16:9'), true); assert.equal(c.ratioMismatch(u, '9:16'), false);
  // JPEG：SOF0 段里的高在前、宽在后（不整齐的 1000×750），读反了宽高就反了
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xee, 0x03, 0xe8, 0, 0, 0, 0, 0]);
  const j = c.setUploadedPortrait('林七', jpg);
  assert.deepEqual([j.portrait.width, j.portrait.height], [1000, 750]);
  // 默认竖版 2:3 出图，配 16:9 的片要报——9-24 真机三镜全没头就是这个
  const d = await c.renderPortrait('林七', { gen: fakeGen });
  assert.deepEqual([calls.at(-1).width, calls.at(-1).height], [768, 1152]);
  assert.equal(c.ratioMismatch(d, '16:9'), true);
});

test('种子目录会自动清理：旧的删、新的留', () => {
  const card = c.readCard('林七');
  const old = c.writeSeedRun(card, { inputs: {} });
  const past = new Date(Date.now() - 4 * 24 * 3600e3); fs.utimesSync(old, past, past);
  const fresh = c.writeSeedRun(card, { inputs: {} });   // 写新的时顺手清掉旧的
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true);
});
