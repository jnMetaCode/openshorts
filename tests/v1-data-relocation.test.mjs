import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * v1 数据外迁（OPENSHORTS_V1_DATA）——桌面版的命脉。
 *
 * 打包后的 Electron 资源目录是只读的：v1 编辑器若仍往包根写 projects/data/out/uploads，
 * 启动第一步 mkdir 就 EROFS，整个 app 白屏。这条测试真 spawn 一个服务端进程验证：
 * ① 写目录确实落在指定目录；② 首启把包里的示例工程播种过去（否则 /editor 开箱空白）；
 * ③ 不污染仓库自己的 projects/（开发机上跑桌面版不该改动源码树）。
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

const waitHealth = async (port, ms = 30000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) });
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

test('OPENSHORTS_V1_DATA：写目录外迁到指定位置，首启播种示例工程，不碰仓库源码树', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-v1data-'));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(root, 'server', 'index.mjs')], {
    env: { ...process.env, OPENSHORTS_V1_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  t.after(() => { try { child.kill(); } catch { /* noop */ } fs.rmSync(dataDir, { recursive: true, force: true }); });

  const up = await waitHealth(port);
  assert.ok(up, `服务端应在外迁目录下正常启动（stderr: ${stderr.slice(-300)}）`);

  // ① 四个写目录都建在外迁位置
  for (const d of ['projects', 'data', 'out', 'public']) {
    assert.ok(fs.existsSync(path.join(dataDir, d)), `${d}/ 应建在 OPENSHORTS_V1_DATA 下`);
  }

  // ② 示例工程被播种过去——否则打包版的 /editor 开箱是空的
  const seeded = fs.readdirSync(path.join(dataDir, 'projects')).filter((f) => f.endsWith('.json'));
  assert.ok(seeded.length > 0, '首启应把包里的示例工程播种到外迁目录');
  const listed = await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json();
  assert.equal(listed.length, seeded.length, '/api/projects 读的应是外迁目录里的工程');

  // ③ 仓库自己的 projects/ 没被动过（开发机跑桌面版不该改源码树）
  const repoProjects = fs.readdirSync(path.join(root, 'projects')).filter((f) => f.endsWith('.json'));
  assert.deepEqual(seeded.sort(), repoProjects.sort(), '播种应是复制而非搬走，源码树保持原样');
});
