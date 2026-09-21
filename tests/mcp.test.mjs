import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * MCP server：协议层（handleMessage）用假 startJob 测；任务层（startJob）用一段假 CLI 测——
 * 假 CLI 照真 CLI 的样子输出：人话日志 + 末行 `@@json {...}`，还故意混一行坏 JSON、
 * 一条"质检没过但片子出来了"（退出码 1 + 有结果）、一条只有 ⛔ 原因的失败。
 */
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'os-mcp-'));
process.env.OPENSHORTS_HOME = path.join(home, '.openshorts');
const { handleMessage, TOOLS } = await import('../src/mcp/server.mjs');
const { startJob, readJob, listJobs, shutdownJobs, jobsDir } = await import('../src/mcp/jobs.mjs');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const rpc = (method, params, id = 1) => handleMessage({ jsonrpc: '2.0', id, method, params });
const body = (r) => JSON.parse(r.result.content[0].text);

test('协议：initialize 协商版本、tools/list 五个工具、通知不回、未知方法 -32601、坏请求 -32600', async () => {
  const init = await rpc('initialize', { protocolVersion: '2024-11-05' });
  assert.equal(init.result.protocolVersion, '2024-11-05'); assert.equal(init.result.serverInfo.name, 'openshorts-kaipian');
  assert.equal((await rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-06-18', '不认识的版本回我们最新支持的');
  assert.deepEqual((await rpc('tools/list')).result.tools.map((t) => t.name), TOOLS.map((t) => t.name));
  for (const t of TOOLS) assert.ok(t.inputSchema.type === 'object' && t.description.length > 40, `${t.name} 的 schema / 描述不完整`);
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal((await rpc('nope')).error.code, -32601);
  assert.equal((await handleMessage({ id: 9, method: 'x' })).error.code, -32600);
});

test('create_video：参数校验；合法调用把参数翻译成 CLI 参数并立刻回 job_id；工具内部崩溃回 isError 而不是协议错误', async () => {
  const bad = await rpc('tools/call', { name: 'create_video', arguments: {} }); assert.equal(bad.result.isError, true);
  const dur = await rpc('tools/call', { name: 'create_video', arguments: { topic: 'x', duration_sec: 42 } }); assert.match(dur.result.content[0].text, /30, 45, 60, 90/);
  let got; const deps = { startJob: (p) => { got = p; return { id: 'job-1', state: 'writing_script' }; } };
  const ok = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_video', arguments: { topic: '猫为什么钻纸箱', lang: 'en', duration_sec: 45, provider: 'ollama', model: 'qwen2.5:14b', render: false } } }, deps);
  assert.equal(body(ok).job_id, 'job-1');
  assert.deepEqual(got, { topic: '猫为什么钻纸箱', lang: 'en', duration: '45秒', tone: undefined, voice: undefined, provider: 'ollama', model: 'qwen2.5:14b', render: false });
  const crash = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'doctor', arguments: {} } }, { doctor: async () => { throw new Error('boom\nstack'); } });
  assert.equal(crash.result.isError, true); assert.match(crash.result.content[0].text, /boom/); assert.ok(!crash.error);
  assert.equal((await rpc('tools/call', { name: 'render_project', arguments: { project: 'relative/project.json' } })).result.isError, true, '相对路径拒绝');
});

// ── 任务层：假 CLI ──
const fakeCli = path.join(home, 'fake-cli.mjs');
fs.writeFileSync(fakeCli, `
const [cmd, ...rest] = process.argv.slice(2);
const topic = rest[rest.indexOf('--topic') + 1] ?? '';
if (cmd === 'new') {
  if (topic === 'FAIL') { console.log('✍️  正在写脚本…'); console.error('⛔ 缺少 API Key：文本供应商「zhipu」没配 key'); process.exit(1); }
  console.log('✍️  正在写脚本（30秒）…'); console.log('@@json {broken'); console.log('  ⟳ 脚本 75 字，自动重写一次…');
  console.log('@@json ' + JSON.stringify({ ok: true, project: '${home.replace(/\\/g, '\\\\')}/p/project.json', id: 'p', shots: 4, title: 'T', warnings: ['短了'] }));
} else if (cmd === 'run') {
  console.log('🎙 hook 配音 2.1s'); if (process.env.FAKE_SLOW) { const t = Date.now(); while (Date.now() - t < 4000) {} }
  console.log('@@json ' + JSON.stringify({ ok: true, qualityPass: false, video: '/v.mp4', captions: '/v.srt', cover: null, publishCopy: '/v.txt', durationSec: 27.3, notes: ['n1'], quality: [{ status: 'fail', msg: '响度太低' }] }));
  console.error('⛔ 质检未过'); process.exit(1);
}`);
const spawnFake = (_node, args, opts) => spawn(process.execPath, [fakeCli, ...args.slice(1)], opts);
const waitTerminal = async (id, ms = 15000) => { const t0 = Date.now(); for (;;) { const j = readJob(id); if (['done', 'failed', 'interrupted'].includes(j.state)) return j; if (Date.now() - t0 > ms) throw new Error(`job ${id} 卡在 ${j.state}`); await new Promise((r) => setTimeout(r, 100)); } };

test('任务：new → run 串起来；坏的 @@json 行当日志；质检没过（退出码 1）但片子出来了 → done + qualityPass=false；脚本失败原因穿透到 error', async () => {
  const j = await waitTerminal(startJob({ topic: '猫', duration: '30秒' }, { spawnImpl: spawnFake }).id);
  assert.equal(j.state, 'done'); assert.equal(j.result.qualityPass, false); assert.equal(j.result.video, '/v.mp4'); assert.deepEqual(j.script, { shots: 4, title: 'T', warnings: ['短了'] });
  assert.ok(j.log.some((l) => l.startsWith('@@json {broken')), '坏 JSON 行留在日志里，不炸');
  assert.ok(j.log.includes('🎙 hook 配音 2.1s'));
  const f = await waitTerminal(startJob({ topic: 'FAIL' }, { spawnImpl: spawnFake }).id);
  assert.equal(f.state, 'failed'); assert.match(f.error, /缺少 API Key.*zhipu/);
  const onlyScript = await waitTerminal(startJob({ topic: '猫', render: false }, { spawnImpl: spawnFake }).id);
  assert.equal(onlyScript.state, 'done'); assert.equal(onlyScript.result, null); assert.ok(onlyScript.project.endsWith('project.json'));
  assert.equal(listJobs(2).length, 2); assert.equal(readJob('../etc/passwd'), null);
});

test('server 退出时正在跑的任务记成 interrupted；另一个进程留下的"rendering"也如实报断', async () => {
  const j = startJob({ project: '/x/project.json' }, { spawnImpl: spawnFake, env: { ...process.env, FAKE_SLOW: '1' } });
  await new Promise((r) => setTimeout(r, 400)); assert.equal(readJob(j.id).state, 'rendering');
  shutdownJobs();
  const after = readJob(j.id); assert.equal(after.state, 'interrupted'); assert.match(after.error, /shut down/);
  // 别的（已经死掉的）server 进程写的状态
  const stale = { id: 'stale0-abcdef', state: 'rendering', createdAt: new Date().toISOString(), serverPid: 999999, log: [] };
  fs.writeFileSync(path.join(jobsDir(), `${stale.id}.json`), JSON.stringify(stale));
  assert.equal(readJob(stale.id).state, 'interrupted');
});
