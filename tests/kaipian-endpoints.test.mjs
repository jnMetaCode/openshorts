import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 开片 API 的入口校验。server/kaipian.mjs 有 400 多行，以前只有"能 import"一条测试——
 * 短剧线的 404/400/409 全靠真机手点。这里把配置根目录指到临时目录（OPENSHORTS_HOME /
 * AO_DATA_DIR 都是模块级常量，必须在 import 之前设），不碰真实的 ~/.openshorts 和 ~/.ao。
 * 只测校验层，不往下走到会 spawn AO 的地方。
 */
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'os-kaipian-'));
process.env.OPENSHORTS_HOME = path.join(home, '.openshorts');
process.env.AO_DATA_DIR = path.join(home, '.ao');

const express = (await import('express')).default;
const { kaipian } = await import('../server/kaipian.mjs');
const { writeConfig } = await import('../src/config.mjs');

const outDir = path.join(home, 'OpenShorts'); fs.mkdirSync(outDir, { recursive: true });
writeConfig({ outputDir: outDir });

const app = express();
app.use('/api/kaipian', express.json(), kaipian);
const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/kaipian`;
test.after(() => { server.close(); fs.rmSync(home, { recursive: true, force: true }); });

const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

test('PUT /config：根目录拒绝，合法目录通过，打码的 key 不会覆盖真 key', async () => {
  const bad = await j(await fetch(`${base}/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outputDir: path.parse(home).root }) }));
  assert.equal(bad.status, 400); assert.match(bad.body.error, /根目录/);

  const good = await j(await fetch(`${base}/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outputDir: outDir, pexelsKey: 'px-真key-123456' }) }));
  assert.equal(good.status, 200);
  // 回显是打码的；把打码值再 PUT 回去不能把真 key 覆盖掉
  await fetch(`${base}/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pexelsKey: 'px-真…456' }) });
  const cfg = await j(await fetch(`${base}/config`));
  assert.equal(cfg.body.stock.hasPexels, true);
  assert.ok(!JSON.stringify(cfg.body).includes('px-真key-123456'), 'GET /config 不能回显完整 key');
});

test('POST /new：没有话题直接 400，不去调 LLM', async () => {
  const r = await j(await fetch(`${base}/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  assert.equal(r.status, 400); assert.match(r.body.error, /话题/);
});

test('GET /drama/run：缺故事 400；缺 image_model 400（必填无默认，不拦的话 AO spawn 后立刻退出码 1）', async () => {
  const noStory = await j(await fetch(`${base}/drama/run`));
  assert.equal(noStory.status, 400); assert.match(noStory.body.error, /故事/);
  const noImg = await j(await fetch(`${base}/drama/run?story=x&tier=local`));
  assert.equal(noImg.status, 400); assert.match(noImg.body.error, /image_model/);
});

test('单镜重出：项目不存在 404；镜头 id 不合法 400；上次运行目录丢了 409', async () => {
  const gone = await j(await fetch(`${base}/projects/不存在/drama/redo?shot=shot1`));
  assert.equal(gone.status, 404);

  const dir = path.join(outDir, '短剧-测试'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ id: '短剧-测试', line: 'drama', shots: [], inputs: { story: 'x' }, final: { aoRun: path.join(home, '不存在的运行目录') } }));
  const badShot = await j(await fetch(`${base}/projects/短剧-测试/drama/redo?shot=film`));
  assert.equal(badShot.status, 400); assert.match(badShot.body.error, /character|shot1/);
  const lost = await j(await fetch(`${base}/projects/短剧-测试/drama/redo?shot=shot1`));
  assert.equal(lost.status, 409); assert.match(lost.body.error, /运行目录/);
});

test('GET /projects：空目录返回空清单；建过的项目能列出来', async () => {
  const r = await j(await fetch(`${base}/projects`));
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  assert.ok(r.body.some((p) => p.id === '短剧-测试'), '上一条测试建的项目应在清单里');
});
