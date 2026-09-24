import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 角色卡的接口层：增删改、只发卡自己记着的图、上传认字节头、短剧运行带卡时真把种子目录交给引擎。
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'os-charapi-'));
process.env.OPENSHORTS_HOME = path.join(home, '.openshorts');
process.env.AO_DATA_DIR = path.join(home, '.ao');
// 桩引擎：把收到的参数写进文件（只断言状态码的话，"带没带 --resume"根本验不到）
const ao = path.join(home, 'ao'); const argsOut = path.join(home, 'ao-args.json');
fs.mkdirSync(path.join(ao, 'dist'), { recursive: true }); fs.mkdirSync(path.join(ao, 'workflows'), { recursive: true });
fs.writeFileSync(path.join(ao, 'package.json'), '{"name":"stub","version":"0.0.0"}');
fs.writeFileSync(path.join(ao, 'dist', 'cli.js'), `require('fs').writeFileSync(${JSON.stringify(argsOut)}, JSON.stringify(process.argv.slice(2)));`);
process.env.OPENSHORTS_AO_DIR = ao;

const express = (await import('express')).default;
const { kaipian } = await import('../server/kaipian.mjs');
const { writeConfig } = await import('../src/config.mjs');
writeConfig({ outputDir: path.join(home, 'OpenShorts') });
const app = express();
app.use('/api/kaipian', express.json(), kaipian);
const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/kaipian`;
test.after(() => { server.close(); fs.rmSync(home, { recursive: true, force: true }); });
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const post = (u, b, m = 'POST') => fetch(`${base}${u}`, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

test('增删改：缺名字 400（英文请求给英文），改完回显 stale', async () => {
  const bad = await j(await post('/characters?lang=en', { basics: 'x' }));
  assert.equal(bad.status, 400); assert.match(bad.body.error, /needs a name/);
  const c = await j(await post('/characters', { name: '阿澜', basics: '30 岁女性', marks: ['右耳三枚银耳钉', ' '] }));
  assert.equal(c.status, 200); assert.deepEqual(c.body.marks, ['右耳三枚银耳钉']);
  assert.equal(c.body.portraitUrl, null);
  const e = await j(await post(`/characters/${encodeURIComponent(c.body.id)}`, { name: '阿澜', basics: '30 岁女性', outfit: '墨绿风衣' }, 'PUT'));
  assert.equal(e.body.outfit, '墨绿风衣');
  assert.equal((await j(await fetch(`${base}/characters`))).body.length, 1);
  assert.equal((await j(await fetch(`${base}/characters/nope`, { method: 'DELETE' }))).status, 404);
});

test('上传：非图片 400；图片存下来、只按卡自己记着的文件名发图', async () => {
  const id = encodeURIComponent('阿澜');
  const gif = await j(await fetch(`${base}/characters/${id}/upload`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('GIF89a------') }));
  assert.equal(gif.status, 400);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);
  const up = await j(await fetch(`${base}/characters/${id}/upload`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png }));
  assert.equal(up.status, 200); assert.equal(up.body.portrait.source, 'upload');
  const img = await fetch(`http://127.0.0.1:${server.address().port}${up.body.portraitUrl}`);
  assert.equal(img.status, 200); assert.deepEqual(Buffer.from(await img.arrayBuffer()), png);
  // 卡没记着的文件名（包括路径穿越）一律 404
  for (const f of ['card.json', '../../.openshorts/config.json', 'portrait-x.png']) assert.equal((await fetch(`${base}/characters/${id}/portrait?f=${encodeURIComponent(f)}`)).status, 404, f);
});

test('短剧运行带卡：故事拼进外形，有定妆图就不要求图片模型、带 --resume 种子目录；卡不存在 404', async () => {
  const miss = await j(await fetch(`${base}/drama/run?story=x&tier=local&character=nope`));
  assert.equal(miss.status, 404);
  const r = await fetch(`${base}/drama/run?story=${encodeURIComponent('天台告别')}&tier=local&character=${encodeURIComponent('阿澜')}`);
  assert.equal(r.status, 200, '有定妆图时不该再因为没选 image_model 被 400');
  await r.text();   // 等 SSE 结束（桩引擎立刻退出）
  const args = JSON.parse(fs.readFileSync(argsOut, 'utf-8'));
  const story = args.find((a) => a.startsWith('story='));
  assert.match(story, /^story=天台告别\n【主角外形已定/); assert.ok(story.includes('右耳三枚银耳钉'));
  const seed = args[args.indexOf('--resume') + 1];
  assert.ok(seed && fs.existsSync(path.join(seed, 'assets', 'character.png')), JSON.stringify(args));
  assert.ok(!seed.includes('.ao-runs'));
});
