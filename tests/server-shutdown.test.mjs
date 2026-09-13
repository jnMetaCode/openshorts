import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * 服务端收到 SIGTERM 要走自己的收尾（停活、关端口、退出码 0），而不是 Node 的默认"立刻死"。
 * 默认行为下子进程会成孤儿（真机坐实，见 server/lib/proc.mjs）。这里真 spawn 一个服务端：
 * 有收尾日志 + 在 3 秒内以 0 退出，才算 handler 真的装上了。
 * 真跑一条出片再杀的验证不进 CI（要 TTS 网络），在 tests/proc.test.mjs 验杀树本身。
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

test('SIGTERM：服务端打收尾日志并在 3 秒内以退出码 0 结束', { skip: process.platform === 'win32' && 'Windows 没有 SIGTERM 语义' }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-shutdown-'));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(root, 'server', 'index.mjs')], { env: { ...process.env, OPENSHORTS_V1_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  try {
    const until = Date.now() + 30000; let up = false;
    while (Date.now() < until && !up) { try { up = (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) })).ok; } catch { await new Promise((r) => setTimeout(r, 250)); } }
    assert.ok(up, `服务端没起来：${out.slice(-500)}`);
    const t0 = Date.now();
    child.kill('SIGTERM');
    const code = await new Promise((r) => child.on('close', r));
    assert.equal(code, 0, `退出码应为 0，输出：${out.slice(-500)}`);
    assert.ok(Date.now() - t0 < 3000, '应在 3 秒内退出');
    assert.match(out, /收到 SIGTERM/, '应打出收尾日志（没有 = handler 没装上，走的是默认立刻死）');
  } finally { try { child.kill('SIGKILL'); } catch { /* 已退出 */ } fs.rmSync(dataDir, { recursive: true, force: true }); }
});
