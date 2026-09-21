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
const { kaipian, kaipianBusy, _pipeline } = await import('../server/kaipian.mjs');
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

test('POST /ao-keys：存完立刻进环境变量（issue #12：AO 库函数只认环境变量，不同步就得重启才生效）；能换 key；shell 里显式设的不覆盖', async () => {
  const save = (provider, apiKey) => fetch(`${base}/ao-keys`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, apiKey }) });
  delete process.env.ZHIPU_API_KEY; delete process.env.MOONSHOT_API_KEY;
  assert.equal((await save('zhipu', 'zp-第一把-0001')).status, 200);
  assert.equal(process.env.ZHIPU_API_KEY, 'zp-第一把-0001', '存完不重启就得能用');
  // 换 key：上一把是我们映射进去的，得跟着换；否则界面显示新 key、实际还在用旧的
  await save('zhipu', 'zp-第二把-000002');
  assert.equal(process.env.ZHIPU_API_KEY, 'zp-第二把-000002');
  // 界面列 key 来源时，我们映射进去的变量不能再当成"来自环境变量"列一遍
  const st = await j(await fetch(`${base}/ao-status`));
  assert.deepEqual(st.body.saved, ['zhipu']); assert.ok(!st.body.envs.includes('ZHIPU_API_KEY'), '同一把 key 不能显示两遍');
  // 用户在 shell 里显式设的优先，界面存的不能盖掉它；也不能因为存别家的 key 被连带改动
  process.env.MOONSHOT_API_KEY = 'ms-来自shell';
  await save('moonshot', 'ms-界面存的-77');
  assert.equal(process.env.MOONSHOT_API_KEY, 'ms-来自shell');
  assert.equal(process.env.ZHIPU_API_KEY, 'zp-第二把-000002');
  delete process.env.ZHIPU_API_KEY; delete process.env.MOONSHOT_API_KEY;
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

test('kaipianBusy：没活在跑时如实报空（桌面版退出确认的数据源）', () => {
  const b = kaipianBusy();
  assert.deepEqual(b.koubo, []);
  assert.equal(b.drama, false);
});

test('GET /projects：空目录返回空清单；建过的项目能列出来', async () => {
  const r = await j(await fetch(`${base}/projects`));
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  assert.ok(r.body.some((p) => p.id === '短剧-测试'), '上一条测试建的项目应在清单里');
});

// 任务与连接解耦（lib/job-hub.mjs）之后的入口：没跑过的项目 status 是 idle、events/cancel 404；短剧同理
test('任务状态接口：没跑过 → status idle、events 404、cancel 404（口播与短剧）', async () => {
  const st = await j(await fetch(`${base}/projects/短剧-测试/status`));
  assert.equal(st.status, 200); assert.equal(st.body.status, 'idle');
  const ev = await j(await fetch(`${base}/projects/短剧-测试/events`));
  assert.equal(ev.status, 404); assert.match(ev.body.error, /没有在跑/);
  const cancel = await j(await fetch(`${base}/projects/短剧-测试/cancel`, { method: 'POST' }));
  assert.equal(cancel.status, 404);
  const ds = await j(await fetch(`${base}/drama/status`));
  assert.equal(ds.status, 200); assert.equal(ds.body.status, 'idle');
  assert.equal((await fetch(`${base}/drama/events`)).status, 404);
  assert.equal((await fetch(`${base}/drama/cancel`, { method: 'POST' })).status, 404);
});


// ───────────── 出片任务与 SSE 连接解耦：409 锁 / 断线重连 / 补发 / 取消（假出片，不联网） ─────────────
/** 读 SSE：收帧直到 until(frames) 为真或超时，然后主动断开（服务端据此把这条连接从观众里摘掉） */
const sseRead = async (url, { headers = {}, until = () => false, ms = 3000 } = {}) => {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  const r = await fetch(url, { headers, signal: ac.signal });
  if (r.status !== 200) { clearTimeout(t); return { status: r.status, frames: [], body: await r.json().catch(() => null) }; }
  const frames = []; let buf = '';
  const reader = r.body.getReader(); const dec = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n'); buf = parts.pop();
      for (const p of parts) { const m = p.match(/id: (\d+)\nevent: (\w+)\ndata: (.*)/s); if (m) frames.push({ n: Number(m[1]), ev: m[2], data: JSON.parse(m[3]) }); }
      if (until(frames)) break;
    }
  } catch { /* 超时/主动断开 */ }
  clearTimeout(t); ac.abort();
  return { status: 200, frames };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realRunKoubo = _pipeline.runKoubo;
// 假出片：每 60ms 一行日志，共 8 行，能被 signal 取消——像真的一样慢，才测得到"连接断了活照跑"
const fakeRun = async (project, { log, signal }) => {
  for (let i = 1; i <= 8; i++) {
    if (signal?.aborted) throw new Error('Cancelled');
    log(`line ${i}`); await sleep(60);
  }
  if (signal?.aborted) throw new Error('Cancelled');
  return { final: { file: path.join(outDir, project.id, 'fake.mp4'), durationSec: 1 }, provenance: [] };
};
test('run：观众断开活照跑；第二个标签 409；带 Last-Event-ID 重连只补错过的；/events 从头补发到 done', async (t) => {
  _pipeline.runKoubo = fakeRun; t.after(() => { _pipeline.runKoubo = realRunKoubo; });
  const dir = path.join(outDir, '口播-测试'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ id: '口播-测试', line: 'koubo', lang: 'zh', shots: [] }));
  const first = await sseRead(`${base}/projects/口播-测试/run`, { until: (fr) => fr.length >= 2 });   // 看两行就关页面
  assert.equal(first.status, 200); assert.deepEqual(first.frames.map((x) => x.data.m), ['line 1', 'line 2']);
  const st = await j(await fetch(`${base}/projects/口播-测试/status`));
  assert.equal(st.body.status, 'running', '页面关了任务还在跑');
  assert.deepEqual(kaipianBusy().koubo, ['口播-测试']);
  const second = await sseRead(`${base}/projects/口播-测试/run`, { until: () => true });
  assert.equal(second.status, 409, '没带 Last-Event-ID 的第二个 /run 是"再跑一条"，要拒');
  const re = await sseRead(`${base}/projects/口播-测试/run`, { headers: { 'last-event-id': '2' }, until: (fr) => fr.length >= 1 });
  assert.equal(re.status, 200); assert.ok(re.frames[0].n >= 3, `重连应从第 3 行起，得到 ${re.frames[0].n}`);
  const all = await sseRead(`${base}/projects/口播-测试/events`, { until: (fr) => fr.some((x) => x.ev === 'done'), ms: 5000 });
  assert.equal(all.frames[0].n, 1, '/events 从头补发');
  assert.equal(all.frames.at(-1).ev, 'done'); assert.match(all.frames.at(-1).data.final.file, /fake\.mp4$/);
  const after = await j(await fetch(`${base}/projects/口播-测试/status`));
  assert.equal(after.body.status, 'done'); assert.match(after.body.result.final.file, /fake\.mp4$/);
  const replay = await sseRead(`${base}/projects/口播-测试/events`, { until: () => false, ms: 1500 });
  assert.equal(replay.frames.at(-1).ev, 'done', '跑完之后再来看：补完就关');
  assert.deepEqual(kaipianBusy().koubo, []);
});
test('cancel：只认显式 POST；出片收到 Cancelled，status 变 error，之后能再跑', async (t) => {
  _pipeline.runKoubo = fakeRun; t.after(() => { _pipeline.runKoubo = realRunKoubo; });
  const watching = sseRead(`${base}/projects/口播-测试/run`, { until: (fr) => fr.some((x) => x.ev === 'error' || x.ev === 'done'), ms: 4000 });
  await sleep(150);
  const c = await j(await fetch(`${base}/projects/口播-测试/cancel`, { method: 'POST' }));
  assert.equal(c.status, 200);
  const w = await watching;
  assert.equal(w.frames.at(-1).ev, 'error'); assert.match(w.frames.at(-1).data.m, /Cancelled/);
  assert.equal((await j(await fetch(`${base}/projects/口播-测试/status`))).body.status, 'error');
  assert.equal((await fetch(`${base}/projects/口播-测试/cancel`, { method: 'POST' })).status, 404, '已停的再取消是 404');
  const again = await sseRead(`${base}/projects/口播-测试/run`, { until: (fr) => fr.length >= 1 });
  assert.equal(again.status, 200, '取消后同一项目能再跑');
  await fetch(`${base}/projects/口播-测试/cancel`, { method: 'POST' }); await sleep(100);
});

test('写脚本任务模式：POST /new async → 202 + job key；/jobs/:key/events 收到 generateKoubo 的日志、引擎 stdout 上的限流行、done 带项目；project.json 落盘', async (t) => {
  const real = _pipeline.generateKoubo;
  _pipeline.generateKoubo = async ({ inputs, log }) => {
    log('脚本解析不了（x），自动重写一次…');
    process.stderr.write('  ⚠️  script 失败 (API error 429: rate limit)，6s 后重试 (1/5)...\n');   // 引擎连接器打的是 stderr（console.warn）——真机上就是这条路，只挂 stdout 接不到
    process.stdout.write('  some unrelated stdout line\n');
    await sleep(50);
    return { ok: true, project: { id: '口播-异步', line: 'koubo', lang: 'zh', topic: inputs.topic, shots: [{ id: 's1', text: 'a' }], defaults: {} } };
  };
  t.after(() => { _pipeline.generateKoubo = real; });
  const r = await j(await fetch(`${base}/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: '洋葱', async: true }) }));
  assert.equal(r.status, 202); assert.match(r.body.job, /^new:/);
  const ev = await sseRead(`${base}/jobs/${encodeURIComponent(r.body.job)}/events`, { until: (fr) => fr.some((x) => x.ev === 'done' || x.ev === 'error'), ms: 5000 });
  const msgs = ev.frames.filter((x) => x.ev === 'log').map((x) => x.data.m);
  assert.ok(msgs.some((m) => m.includes('自动重写')), `generateKoubo 的 log 要流出来：${msgs}`);
  assert.ok(msgs.some((m) => m.includes('429')), `引擎 stdout 上的限流行要流出来：${msgs}`);
  assert.ok(!msgs.some((m) => m.includes('unrelated')), '无关的 stdout 行不能混进来');
  const done = ev.frames.at(-1); assert.equal(done.ev, 'done'); assert.equal(done.data.project.id, '口播-异步');
  assert.ok(fs.existsSync(path.join(outDir, '口播-异步', 'project.json')));
  assert.equal((await j(await fetch(`${base}/jobs/${encodeURIComponent(r.body.job)}/status`))).body.status, 'done');
  assert.equal((await fetch(`${base}/jobs/nope/events`)).status, 404);
  // 同步模式照旧：不带 async 直接回项目
  const sync = await j(await fetch(`${base}/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: '洋葱2' }) }));
  assert.equal(sync.status, 200); assert.match(sync.body.id, /^口播-异步/);
});

test('DELETE /projects/:id：不存在 404；正在出片 409；删成功后 404；清洗成空的 id 不会删到输出根目录', async (t) => {
  _pipeline.runKoubo = fakeRun; t.after(() => { _pipeline.runKoubo = realRunKoubo; });
  assert.equal((await fetch(`${base}/projects/不存在/`, { method: 'DELETE' })).status, 404);
  const dir = path.join(outDir, '口播-待删'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ id: '口播-待删', line: 'koubo', shots: [] }));
  await sseRead(`${base}/projects/口播-待删/run`, { until: (fr) => fr.length >= 1 });   // 起一条在跑
  const busy = await j(await fetch(`${base}/projects/口播-待删`, { method: 'DELETE' }));
  assert.equal(busy.status, 409); assert.match(busy.body.error, /正在出片/);
  await fetch(`${base}/projects/口播-待删/cancel`, { method: 'POST' }); await sleep(150);
  const ok = await j(await fetch(`${base}/projects/口播-待删`, { method: 'DELETE' }));
  assert.equal(ok.status, 200); assert.equal(fs.existsSync(dir), false);
  assert.equal((await fetch(`${base}/projects/口播-待删`, { method: 'DELETE' })).status, 404);
  // id 只剩会被清洗掉的字符：projDir 落到输出根目录本身——绝不能 rm
  const marker = path.join(outDir, 'project.json'); fs.writeFileSync(marker, '{}');
  assert.equal((await fetch(`${base}/projects/${encodeURIComponent('..')}`, { method: 'DELETE' })).status, 404);
  assert.ok(fs.existsSync(outDir) && fs.existsSync(marker), '输出根目录必须原样');
  fs.rmSync(marker);
});

test('DELETE：短剧正在重出这个项目时也拒删（锁是全局 drama，得看它记的 projectId）', async () => {
  const { _hub } = await import('../server/kaipian.mjs');
  const dir = path.join(outDir, '短剧-重出中'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ id: '短剧-重出中', line: 'drama', shots: [] }));
  const job = _hub.start('drama', { meta: { kind: 'redo', projectId: '短剧-重出中', shot: 'shot1' } });
  const busy = await j(await fetch(`${base}/projects/短剧-重出中`, { method: 'DELETE' }));
  assert.equal(busy.status, 409); assert.ok(fs.existsSync(dir));
  // 别的项目不受这把全局锁影响
  const other = path.join(outDir, '口播-无关'); fs.mkdirSync(other, { recursive: true }); fs.writeFileSync(path.join(other, 'project.json'), '{"id":"口播-无关","shots":[]}');
  assert.equal((await fetch(`${base}/projects/口播-无关`, { method: 'DELETE' })).status, 200);
  _hub.finish(job, 'done', {});
  assert.equal((await fetch(`${base}/projects/短剧-重出中`, { method: 'DELETE' })).status, 200);
  assert.equal(fs.existsSync(dir), false);
});
