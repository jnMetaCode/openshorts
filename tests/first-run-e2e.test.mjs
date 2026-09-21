import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

/**
 * 全新用户的第一条路，在**同一个进程**里走完：空目录 → 界面接口存 key → 选模型 → 写脚本。
 *
 * issue #12 就死在这条路上：存 key、验证、右栏 ✅ 各自都对，连起来才炸（存完没进环境变量，重启才好）。
 * 别的测试要么注入假的 runFn、要么只测校验层，都绕开了"AO 真的去取 key"这一步——所以这里不注入，
 * 让 AO 的真连接器去打一个本地假的 OpenAI 兼容服务，并检查它带来的 key 就是界面上刚存的那把。
 */
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'os-firstrun-'));
process.env.OPENSHORTS_HOME = path.join(home, '.openshorts');
process.env.AO_DATA_DIR = path.join(home, '.ao');
for (const k of ['OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];

// 字数按 30 秒档写（约 120–150 字），不整齐：三段长短不一
const SCRIPT = { hook: '你家猫是不是也这样，买的猫窝不睡，偏要钻快递箱？', segments: [
  { id: 's1', text: '纸箱四面有壁，猫缩在里面，背后和两侧都被护住，只需要盯着一个方向，这是伏击型猎手刻在骨子里的安全感。', visualIntent: '猫缩在纸箱里往外看', query: 'cat hiding in cardboard box', emphasis: ['安全感'] },
  { id: 's2', text: '瓦楞纸还很保暖，猫喜欢的温度比人高得多。', visualIntent: '猫在箱子里打盹', query: 'cat sleeping in box', emphasis: [] },
  { id: 's3', text: '荷兰一项收容所研究发现，有箱子可躲的猫，适应新环境明显更快，压力分数也更低。', visualIntent: '收容所里的猫', query: 'shelter cat', emphasis: ['更快'] },
], outro: '所以下次拆完快递，箱子先别扔。' };
const META = { titles: ['猫为什么爱钻纸箱'], tags: ['科普', '猫'], publishNote: '说明', aiLabel: 'AI 生成' };

const seen = [];
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; }).on('end', () => {
    const b = JSON.parse(body || '{}');
    seen.push({ url: req.url, auth: req.headers.authorization, model: b.model });
    const prompt = JSON.stringify(b.messages ?? '');
    // 视觉验证：看得见图的模型收到的是 image_url 分片；假装 text-only 的型号按真实供应商的样子回 400
    const hasImage = (b.messages ?? []).some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url'));
    if (hasImage || /main colour/.test(prompt)) {
      seen.at(-1).hasImage = hasImage;
      if (b.model === 'text-only') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'image input is not supported by this model' } })); }
      const word = b.model === 'blind' ? 'I cannot see any image.' : 'Red';
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: word }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    }
    const content = JSON.stringify(prompt.includes(SCRIPT.hook.slice(0, 12)) ? META : SCRIPT);   // meta 那步的提示词里带着上一步的脚本
    if (b.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10 } })}\n\ndata: [DONE]\n\n`);
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
    }
  });
});
await new Promise((ok) => fake.listen(0, '127.0.0.1', ok));
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${fake.address().port}/v1`;

const express = (await import('express')).default;
const { kaipian } = await import('../server/kaipian.mjs');
const { writeConfig } = await import('../src/config.mjs');
const outDir = path.join(home, 'OpenShorts'); fs.mkdirSync(outDir, { recursive: true });
writeConfig({ outputDir: outDir });
const app = express(); app.use('/api/kaipian', express.json(), kaipian);
const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/kaipian`;
test.after(() => { server.close(); fake.close(); fs.rmSync(home, { recursive: true, force: true }); });
const post = (p, body, method = 'POST') => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('全新用户：存 key → 选模型 → 写脚本，一次走通；引擎带去的就是界面上刚存的那把 key', async () => {
  const before = await (await fetch(`${base}/ao-status`)).json();
  assert.equal(before.hasTextKey, false, '起点必须是真的空目录');

  assert.equal((await post('/ao-keys', { provider: 'openai', apiKey: 'sk-firstrun-e2e-0001' })).status, 200);
  assert.equal((await post('/config', { text: { provider: 'openai', model: 'gpt-e2e' } }, 'PUT')).status, 200);

  const r = await post('/new', { topic: '猫为什么爱钻纸箱', duration: '30秒' });
  const project = await r.json();
  assert.equal(r.status, 200, `写脚本应当成功，实际：${JSON.stringify(project).slice(0, 300)}`);
  assert.equal(project.shots?.length >= 3, true, '脚本的三段都得进项目');
  assert.ok(fs.existsSync(path.join(outDir, project.id, 'project.json')), '项目落盘');

  assert.ok(seen.length >= 2, '脚本 + 发布文案至少两次请求');
  for (const s of seen) { assert.equal(s.auth, 'Bearer sk-firstrun-e2e-0001'); assert.equal(s.model, 'gpt-e2e', '侧栏选的模型要真的用上'); }
});

test('key 里混进了复制带来的全角空格 / 中文引号 / 零宽字符：存的时候就说清楚，不留到写脚本时报"无法连接"', async () => {
  for (const bad of ['sk-abc\u3000def', '“sk-abcdef”', 'sk-abc\u200bdef', 'sk-abc def']) {
    const r = await post('/ao-keys', { provider: 'openai', apiKey: bad });
    assert.equal(r.status, 400, JSON.stringify(bad)); assert.match((await r.json()).error, /复制/);
  }
});

test('换一把 key 后，下一次写脚本用的是新 key（不是进程里缓存的旧值）', async () => {
  seen.length = 0;
  await post('/ao-keys', { provider: 'openai', apiKey: 'sk-rotated-e2e-0002' });
  const r = await post('/new', { topic: '猫为什么爱钻纸箱', duration: '30秒' });
  assert.equal(r.status, 200);
  assert.ok(seen.length >= 1); for (const s of seen) assert.equal(s.auth, 'Bearer sk-rotated-e2e-0002');
});

test('看图把关的验证真的发了一张图：看得见的通过；拒收图片的、睁眼说瞎话的都不通过，并说明是模型看不了图', async () => {
  const t = async (model) => (await post('/ao-keys/test', { provider: 'openai', model, kind: 'vision' })).json();
  seen.length = 0;
  const ok = await t('sees'); assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(seen.at(-1).hasImage, true, '图片必须作为 image_url 分片发出去，而不是一长串 base64 文字');
  const refused = await t('text-only'); assert.equal(refused.ok, false); assert.match(refused.error, /不支持图片|image/);
  const blind = await t('blind'); assert.equal(blind.ok, false); assert.match(blind.error, /看不了图/);
  // 文本验证不受影响：不带 kind 时不发图
  seen.length = 0; const txt = await (await post('/ao-keys/test', { provider: 'openai', model: 'text-only' })).json();
  assert.equal(txt.ok, true); assert.ok(!seen.at(-1).hasImage);
});
