import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { spawnTree, killTree } from '../server/lib/proc.mjs';

/**
 * killTree 必须把孙进程也带走——AO 子进程下面挂着 sd-cli / ffmpeg，只杀 AO 它们照样活着。
 * 用真进程验：子进程再起一个孙进程并把 pid 打出来；killTree 之后孙进程必须不在了。
 * 变异检查：把 killTree 换成 child.kill() 这条会红（孙进程活着）。
 */
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const waitGone = async (pid, ms = 5000) => { const until = Date.now() + ms; while (Date.now() < until) { if (!alive(pid)) return true; await new Promise((r) => setTimeout(r, 50)); } return !alive(pid); };
const childScript = `
  const { spawn } = require('node:child_process');
  const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  process.stdout.write(String(g.pid) + '\\n');
  setInterval(() => {}, 1000);
`;
const grandchildPid = (child) => new Promise((resolve, reject) => {
  let buf = ''; child.stdout.on('data', (d) => { buf += d; const m = buf.match(/^(\d+)\n/); if (m) resolve(Number(m[1])); });
  child.on('error', reject); setTimeout(() => reject(new Error('孙进程 pid 没打出来')), 8000).unref();
});

test('killTree：杀掉子进程时孙进程一并消失', async () => {
  const child = spawnTree(process.execPath, ['-e', childScript], { stdio: ['ignore', 'pipe', 'ignore'] });
  const gpid = await grandchildPid(child);
  assert.ok(alive(gpid), '孙进程应先活着');
  assert.equal(killTree(child), true);
  await new Promise((r) => child.on('close', r));
  assert.ok(await waitGone(gpid), `孙进程 ${gpid} 应随子进程一起被杀`);
});

test('对照：普通 spawn + child.kill() 会留下孤儿孙进程（这正是要防的病）', { skip: process.platform === 'win32' && '仅 POSIX 语义' }, async () => {
  const child = spawn(process.execPath, ['-e', childScript], { stdio: ['ignore', 'pipe', 'ignore'] });
  const gpid = await grandchildPid(child);
  child.kill('SIGTERM');
  await new Promise((r) => child.on('close', r));
  await new Promise((r) => setTimeout(r, 300));
  const orphaned = alive(gpid);
  try { process.kill(gpid, 'SIGKILL'); } catch { /* 已经没了 */ }
  assert.equal(orphaned, true, '不整组杀的话孙进程应还活着——若此断言失败说明平台语义变了，killTree 的必要性要重新评估');
});

test('killTree：已退出的子进程返回 false，不抛', async () => {
  const child = spawnTree(process.execPath, ['-e', '0']);
  await new Promise((r) => child.on('close', r));
  assert.equal(killTree(child), false);
  assert.equal(killTree(null), false);
});
