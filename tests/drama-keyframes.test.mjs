import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'os-kf-'));
process.env.OPENSHORTS_HOME = HOME;
const kf = await import('../src/pipeline/drama-keyframes.mjs');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_WF = path.join(root, 'node_modules', 'agency-orchestrator', 'workflows', '短剧流水线.yaml');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 5, 0x40, 0, 0, 3, 0]);

// 不整齐的剧本：主角段在前、镜头标题带全角括号、镜 2 只有一行、末尾没有换行
const SCRIPT = `## 主角
28 岁，黑框眼镜
## 镜头 1（建立）
场景：便利店门口，雨夜
主角在做什么：收伞，抬头看招牌

## 镜头 2（冲突）
同上，他蹲下捡起地上的旧收音机
## 镜头 3（转折或收束）
收音机报出明天的新闻，他愣住`;

test('剧本按镜切开：带括号的标题、只有一行的镜、结尾没换行都认得；主角段不算镜', () => {
  const d = kf.shotDescriptions(SCRIPT);
  assert.deepEqual(Object.keys(d), ['shot1', 'shot2', 'shot3']);
  assert.match(d.shot1, /^场景：便利店门口，雨夜\n主角在做什么：收伞/);
  assert.equal(d.shot2, '同上，他蹲下捡起地上的旧收音机');
  assert.equal(d.shot3, '收音机报出明天的新闻，他愣住');
});

test('派生工作流（拿引擎真的那份）：三镜首帧各读各的、依赖补上、追加三个首帧步骤；引擎改版对不上就报错', () => {
  const out = kf.deriveKeyframeWorkflow(REAL_WF, { resolveAgents: () => '/abs/agents' });
  const y = fs.readFileSync(out, 'utf-8');
  for (const id of kf.SHOTS) {
    assert.ok(y.includes(`image: "{{${id}_keyframe}}"`), id);
    assert.ok(y.includes(`depends_on: [character, ${id}_prompt, ${id}_keyframe]`), id);
    assert.ok(y.includes(`  - id: ${id}_keyframe\n    type: image`), id);
  }
  assert.equal((y.match(/image: "\{\{character_img\}\}"/g) ?? []).length, 0, '三镜都不该再读同一张定妆图');
  assert.match(y, /^agents_dir: "\/abs\/agents"$/m);
  // 引擎工作流改了写法（比如首帧变量改名）：宁可报错，也不能派生出三镜仍共用一张图的版本
  const changed = path.join(HOME, 'changed.yaml');
  fs.writeFileSync(changed, fs.readFileSync(REAL_WF, 'utf-8').replaceAll('image: "{{character_img}}"', 'image: "{{portrait}}"'));
  assert.throws(() => kf.deriveKeyframeWorkflow(changed), /expected 3 shot image lines, found 0/);
});

test('两段种子：第一段把出片 / 合成 / 交付页标成已完成；第二段去掉它们、加三张首帧和来源', () => {
  const seedA = path.join(HOME, 'seedA'); fs.mkdirSync(seedA);
  fs.writeFileSync(path.join(seedA, 'metadata.json'), JSON.stringify({ inputs: {}, steps: [{ id: 'character', status: 'completed' }, { id: 'shot2', status: 'failed' }] }));
  kf.textsOnlySeed(seedA);
  const a = JSON.parse(fs.readFileSync(path.join(seedA, 'metadata.json'), 'utf-8'));
  assert.deepEqual(a.steps.filter((s) => s.status === 'completed').map((s) => s.id).sort(), ['character', 'film', 'pack', 'shot1', 'shot2', 'shot3']);
  assert.equal(a.steps.filter((s) => s.id === 'shot2').length, 1, '原来那条失败的 shot2 要换掉，不能留两条');
  // 模拟第一段跑完的目录：假完成的步骤引擎也会留下步骤文件
  const runA = path.join(HOME, 'runA'); fs.mkdirSync(path.join(runA, 'steps'), { recursive: true }); fs.mkdirSync(path.join(runA, 'assets'));
  fs.writeFileSync(path.join(runA, 'metadata.json'), JSON.stringify({ inputs: { story: 'x' }, steps: [...a.steps, { id: 'script', status: 'completed', output_var: 'script' }] }));
  for (const f of ['1-script.md', '12-shot1.md', '16-film.md', '17-pack.md']) fs.writeFileSync(path.join(runA, 'steps', f), '> h\n\n---\n\nbody');
  const seedB = kf.keyframesSeed(runA, { shot1: PNG, shot2: PNG, shot3: PNG }, { meta: [{ shot: 'shot1', provider: 'agnes' }] });
  const b = JSON.parse(fs.readFileSync(path.join(seedB, 'metadata.json'), 'utf-8'));
  const ids = b.steps.map((s) => s.id);
  for (const id of ['shot1', 'shot2', 'shot3', 'film', 'pack']) assert.ok(!ids.includes(id), `${id} 要真跑，不能还算已完成`);
  assert.ok(ids.includes('script') && ids.includes('shot2_keyframe'));
  assert.ok(!fs.existsSync(path.join(seedB, 'steps', '12-shot1.md')) && fs.existsSync(path.join(seedB, 'steps', '1-script.md')));
  assert.deepEqual(fs.readFileSync(path.join(seedB, 'assets', 'shot3_keyframe.png')), PNG);
  assert.equal(b.keyframes[0].provider, 'agnes');
  assert.throws(() => kf.keyframesSeed(runA, { shot1: PNG, shot2: PNG }), /missing keyframe for shot3/);
});

test('逐镜合成：每镜的要求带这一镜的描述和点名特征、按画幅要尺寸；一镜失败要说是哪一镜', async () => {
  const card = { lang: 'zh', face: '黑框眼镜，胡茬', marks: ['左眉尾浅疤'], outfit: '深灰雨衣' };
  const seen = [];
  const edit = async (a) => { seen.push(a); return PNG; };
  const r = await kf.composeKeyframes({ card, portrait: PNG, sceneImage: PNG, script: SCRIPT, edit, provider: 'agnes', model: 'm', ratio: '9:16' });
  assert.deepEqual(Object.keys(r.frames), ['shot1', 'shot2', 'shot3']);
  assert.ok(seen[1].prompt.includes('蹲下捡起地上的旧收音机') && seen[1].prompt.includes('黑框眼镜') && seen[1].prompt.includes('放进第二张图的场景'));
  assert.equal(seen[0].images.length, 2); assert.equal(seen[0].size, '768x1344');
  let n = 0;
  await assert.rejects(kf.composeKeyframes({ card, portrait: PNG, script: SCRIPT, edit: async () => { if (++n === 2) throw new Error('HTTP 503'); return PNG; }, provider: 'agnes', model: 'm' }), /shot2 首帧合成失败：HTTP 503/);
  await assert.rejects(kf.composeKeyframes({ card, portrait: PNG, script: '## 镜头 1\n只有一镜', edit, provider: 'agnes', model: 'm' }), /找不到「shot2」/);
});

test('命令行串起三段：第一段只写文字、合成三张首帧、第二段用派生工作流 + 首帧种子出片', async () => {
  // 假改图供应商
  const hits = [];
  const srv = await new Promise((ok) => { const s = http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { hits.push(JSON.parse(b)); r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] })); }); }); s.listen(0, '127.0.0.1', () => ok(s)); });
  // 桩引擎：第一次调用造一个"第一段运行目录"（带剧本）并打出"详细输出"；每次都把参数记下来
  const ao = path.join(HOME, 'ao'); fs.mkdirSync(path.join(ao, 'dist'), { recursive: true }); fs.mkdirSync(path.join(ao, 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(ao, 'package.json'), '{"name":"stub","version":"0.0.0"}');
  fs.copyFileSync(REAL_WF, path.join(ao, 'workflows', '短剧流水线.yaml'));
  const calls = path.join(HOME, 'calls.jsonl'); const runA = path.join(HOME, 'runA-cli');
  fs.writeFileSync(path.join(ao, 'dist', 'cli.js'), `const fs=require('fs'),p=require('path');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(a)+'\\n');
if(!fs.existsSync(${JSON.stringify(runA)})){fs.mkdirSync(p.join(${JSON.stringify(runA)},'steps'),{recursive:true});fs.mkdirSync(p.join(${JSON.stringify(runA)},'assets'));
fs.writeFileSync(p.join(${JSON.stringify(runA)},'steps','1-script.md'),'> x\\n\\n---\\n\\n'+${JSON.stringify(SCRIPT)});
const m=JSON.parse(fs.readFileSync(p.join(a[a.indexOf('--resume')+1],'metadata.json'),'utf-8'));m.steps.push({id:'script',status:'completed',output_var:'script'});
fs.writeFileSync(p.join(${JSON.stringify(runA)},'metadata.json'),JSON.stringify(m));console.log('  详细输出: '+${JSON.stringify(runA)});}`);
  const cards = await import('../src/characters/cards.mjs');
  const c = cards.saveCard({ name: '阿杰', basics: '外卖骑手', face: '黑框眼镜' });
  cards.setUploadedPortrait(c.id, PNG);
  const env = { ...process.env, OPENSHORTS_LANG: 'zh', OPENSHORTS_HOME: HOME, OPENSHORTS_AO_DIR: ao, AGNES_BASE_URL: `http://127.0.0.1:${srv.address().port}/v1`, AGNES_API_KEY: 'k' };
  const bin = path.join(root, 'bin', 'openshorts.mjs');
  const code = await new Promise((ok) => { const ch = spawn(process.execPath, [bin, 'drama', '--character', c.id, '--keyframes', '--edit-provider', 'agnes', '--edit-model', 'agnes-image-2.5-flash', '-i', 'story=避雨', '-i', 'video_provider=local-sdcpp'], { env, stdio: 'ignore' }); ch.on('close', ok); });
  srv.close();
  assert.equal(code, 0);
  const runs = fs.readFileSync(calls, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(runs.length, 2, '两段各跑一次引擎');
  assert.ok(runs[0][1].endsWith('短剧流水线.yaml'), '第一段用原工作流');
  assert.match(runs[1][1], /drama-keyframes-.*\.yaml$/, '第二段用派生工作流');
  assert.ok(runs[0].includes('video_resolution=640x384'), '本机草稿档两段都要带上');
  const seedB = runs[1][runs[1].indexOf('--resume') + 1];
  assert.ok(fs.existsSync(path.join(seedB, 'assets', 'shot1_keyframe.png')));
  assert.equal(hits.length, 3, '三镜各合成一张');
  assert.ok(hits[2].prompt.includes('收音机报出明天的新闻'));
  // 没给改图供应商：说清楚要什么，不静默退回共用一张图
  const noProv = await new Promise((ok) => { let err = ''; const ch = spawn(process.execPath, [bin, 'drama', '--character', c.id, '--keyframes', '-i', 'story=x'], { env }); ch.stderr.on('data', (d) => (err += d)); ch.on('close', (code2) => ok({ code2, err })); });
  assert.equal(noProv.code2, 1); assert.match(noProv.err, /--edit-provider/);
  assert.equal(fs.readFileSync(calls, 'utf-8').trim().split('\n').length, 2, '缺供应商时一次引擎都不该起');
});
