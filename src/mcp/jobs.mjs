/**
 * MCP 的出片任务：起子进程跑 CLI 的 `new --json` → `run --json`，状态落盘。
 *
 * 为什么跑 CLI 而不是直接调库：`new` / `run` 两段编排（自动重写、质检落到退出码、耗时扣休眠……）
 * 已经在 CLI 和 Web 各有一份，再抄第三份迟早漂。CLI 是发版前真跑过的那条路，`--json` 末行给结构化结果。
 *
 * 为什么任务化：出一条片 1–25 分钟，远超 MCP 客户端的工具调用超时。`create_video` 立刻回任务号，
 * agent 用 `job_status` 轮询。状态写在 ~/.openshorts/mcp-jobs/，server 被客户端重启也查得到；
 * 子进程不 detach（这个项目吃过孤儿进程的亏）——server 退出时一并收掉，状态如实记成 interrupted。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OPENSHORTS_HOME } from '../config.mjs';
import { writeFileAtomic } from '../core/fs-atomic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(root, 'bin', 'openshorts.mjs');
export const jobsDir = () => path.join(OPENSHORTS_HOME, 'mcp-jobs');
const jobFile = (id) => path.join(jobsDir(), `${id}.json`);
const TERMINAL = new Set(['done', 'failed', 'interrupted']);
const LOG_KEEP = 60;

const live = new Map();   // id → 当前子进程（只在本进程里有意义）

export function readJob(id) {
  if (!/^[a-z0-9-]{6,40}$/.test(String(id))) return null;
  let job; try { job = JSON.parse(fs.readFileSync(jobFile(id), 'utf-8')); } catch { return null; }
  // 状态还在"进行中"，但负责它的 server 进程已经没了（被客户端重启 / 崩了）→ 如实说断了，别让 agent 永远等下去
  if (!TERMINAL.has(job.state) && !live.has(id) && !pidAlive(job.serverPid)) { job.state = 'interrupted'; job.error = 'The OpenShorts MCP server that owned this job exited before it finished. Start it again with create_video, or render the existing project with render_project.'; save(job); }
  return job;
}
const pidAlive = (pid) => { if (!pid || pid === process.pid) return pid === process.pid; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function save(job) { fs.mkdirSync(jobsDir(), { recursive: true }); job.updatedAt = new Date().toISOString(); writeFileAtomic(jobFile(job.id), JSON.stringify(job, null, 2)); }

/** 跑一条 CLI 命令：日志尾巴进 job，末行 `@@json {...}` 作为结果返回 */
function runCli(job, args, { spawnImpl = spawn, env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawnImpl(process.execPath, [CLI, ...args, '--json'], { env: { ...env, FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    live.set(job.id, child);
    let result = null, buf = '';
    const feed = (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const raw of lines) {
        const line = raw.trimEnd(); if (!line.trim()) continue;
        if (line.startsWith('@@json ')) { try { result = JSON.parse(line.slice(7)); continue; } catch { /* 坏的结果行留在日志里，排查时看得见 */ } }
        job.log.push(line.trim()); if (job.log.length > LOG_KEEP) job.log.splice(0, job.log.length - LOG_KEEP);
      }
      save(job);
    };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    child.on('error', (e) => { live.delete(job.id); resolve({ code: 1, result: null, spawnError: e.message }); });
    child.on('close', (code, signal) => { if (buf.trim()) feed('\n'); live.delete(job.id); resolve({ code: code ?? 1, signal, result }); });
  });
}

/** 失败原因要穿透到 agent 眼前：取日志里最后一条 ⛔，没有就取最后几行 */
const whyFailed = (job, r) => r.spawnError ?? ([...job.log].reverse().find((l) => l.includes('⛔')) ?? job.log.slice(-3).join(' | ')) ?? `exit code ${r.code}`;

/** 终态超过 14 天的任务文件清掉：agent 一天几十次调用，不清这个目录会无限长 */
export function pruneJobs({ maxAgeMs = 14 * 86400_000, now = Date.now() } = {}) {
  let removed = 0;
  try { for (const n of fs.readdirSync(jobsDir())) { if (!n.endsWith('.json')) continue; const f = path.join(jobsDir(), n); try { const j = JSON.parse(fs.readFileSync(f, 'utf-8')); if (TERMINAL.has(j.state) && now - Date.parse(j.updatedAt ?? j.createdAt) > maxAgeMs) { fs.rmSync(f); removed++; } } catch { /* 坏文件留着，别误删 */ } } } catch { /* 目录还没建 */ }
  return removed;
}

export function startJob(params, deps = {}) {
  pruneJobs();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job = { id, state: 'writing_script', createdAt: new Date().toISOString(), serverPid: process.pid, params, project: null, result: null, error: null, log: [] };
  save(job);
  (async () => {
    try {
      let projectFile = params.project ?? null;
      if (!projectFile) {
        const a = ['new', '--topic', params.topic];
        for (const k of ['lang', 'duration', 'tone', 'voice', 'provider', 'model']) if (params[k]) a.push(`--${k}`, String(params[k]));
        const r = await runCli(job, a, deps);
        if (r.code !== 0 || !r.result?.project) { job.state = r.signal ? 'interrupted' : 'failed'; job.error = whyFailed(job, r); return save(job); }
        projectFile = r.result.project; job.project = projectFile; job.script = { shots: r.result.shots, title: r.result.title, warnings: r.result.warnings };
        if (params.render === false) { job.state = 'done'; return save(job); }
      } else job.project = projectFile;
      job.state = 'rendering'; save(job);
      const r = await runCli(job, ['run', projectFile], deps);
      // 质检没过时 CLI 退出码是 1，但文件已经生成、结果也给了——这是"出了片但有问题"，不是"没出来"
      if (r.result?.video) { job.result = r.result; job.state = 'done'; }
      else { job.state = r.signal ? 'interrupted' : 'failed'; job.error = whyFailed(job, r); }
      save(job);
    } catch (e) { job.state = 'failed'; job.error = String(e?.message ?? e); save(job); }
  })();
  return job;
}

export function listJobs(limit = 10) {
  let names = []; try { names = fs.readdirSync(jobsDir()).filter((n) => n.endsWith('.json')); } catch { return []; }
  return names.map((n) => readJob(n.slice(0, -5))).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}

/** server 退出时收掉还在跑的子进程，并把状态记成 interrupted（别留"rendering"骗人） */
export function shutdownJobs() {
  for (const [id, child] of live) {
    try { child.kill('SIGTERM'); } catch { /* 已经没了 */ }
    try { const job = JSON.parse(fs.readFileSync(jobFile(id), 'utf-8')); if (!TERMINAL.has(job.state)) { job.state = 'interrupted'; job.error = 'The MCP server was shut down while this job was running.'; save(job); } } catch { /* 状态文件没了就算了 */ }
  }
  live.clear();
}
