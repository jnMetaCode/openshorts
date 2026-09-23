/**
 * OpenShorts 的 MCP server（stdio）：让 Claude / Cursor 等 agent 直接"给话题 → 拿成片"。
 *
 * 协议是按行分隔的 JSON-RPC 2.0，用到的只有 initialize / ping / tools/list / tools/call，
 * 自己实现比引 SDK 划算（包体、冷启动、又一个要跟版本的依赖）。
 * **stdout 只能出协议消息**——任何 console.log 都会把客户端的解析弄坏；人话一律走 stderr。
 *
 * server 名带 kaipian，与同名的其它 MCP server 装在同一个客户端里时分得清。
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../config.mjs';
import { startJob, readJob, listJobs, shutdownJobs } from './jobs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkgVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).version; } catch { return '0.0.0'; } };
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DURATIONS = [30, 45, 60, 90];

export const TOOLS = [
  { name: 'create_video',
    description: 'Make a finished vertical short video (1080x1920 mp4 with burned-in captions, voice-over, cover image and publish copy) from a topic, an article-style text or a full script. Writes the script with an LLM, finds stock footage or paints images locally, synthesizes the voice, then renders. Takes 1-25 minutes, so it returns a job_id immediately — poll job_status until state is "done". The free path costs $0. Set render=false to only write the script and review/edit project.json first.',
    inputSchema: { type: 'object', required: ['topic'], properties: {
      topic: { type: 'string', description: 'A topic ("why cats love boxes"), or a full script to be split into shots.' },
      lang: { type: 'string', enum: ['zh', 'en'], description: 'Language of the video (script, voice and captions). Default zh.' },
      duration_sec: { type: 'integer', enum: DURATIONS, description: 'Target length in seconds. Default 60.' },
      tone: { type: 'string', description: 'Optional tone, e.g. "Explainer", "Sharp opinion", "Casual talk".' },
      voice: { type: 'string', description: 'Optional Edge TTS voice id, e.g. zh-CN-YunxiNeural or en-US-AriaNeural.' },
      provider: { type: 'string', description: 'Optional text-model provider for script writing (e.g. ollama, deepseek, zhipu). Defaults to the one chosen in OpenShorts settings.' },
      model: { type: 'string', description: 'Optional model id for that provider (e.g. qwen2.5:14b).' },
      render: { type: 'boolean', description: 'Default true. false = write the script only.' } } } },
  { name: 'render_project',
    description: 'Render (or re-render) an existing OpenShorts project.json into a video — use after create_video with render=false, or after editing the script in project.json. Unchanged shots are reused. Returns a job_id; poll job_status.',
    inputSchema: { type: 'object', required: ['project'], properties: { project: { type: 'string', description: 'Absolute path to project.json.' } } } },
  { name: 'job_status',
    description: 'State of a create_video / render_project job: writing_script | rendering | done | failed | interrupted, the recent log lines, and when done the absolute paths of the video, captions (.srt), cover and publish copy plus any quality warnings. Without job_id, lists recent jobs. Poll every 20-30 s.',
    inputSchema: { type: 'object', properties: { job_id: { type: 'string' } } } },
  { name: 'list_projects',
    description: 'List OpenShorts projects in the output directory (newest first): id, title, path to project.json, and the finished video path if it has been rendered.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } } } },
  { name: 'doctor',
    description: 'Health check of this machine for OpenShorts: ffmpeg with subtitle support, fonts, TTS reachability, configured text/vision models, local image generation. Run this first if create_video fails.',
    inputSchema: { type: 'object', properties: {} } },
];

const text = (s, isError = false) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }], ...(isError ? { isError: true } : {}) });

const viewJob = (j) => ({ job_id: j.id, state: j.state, started: j.createdAt, updated: j.updatedAt, project: j.project, ...(j.script ? { script: j.script } : {}), ...(j.result ? { result: j.result } : {}), ...(j.error ? { error: j.error } : {}), recent_log: (j.log ?? []).slice(-12),
  ...(j.state === 'writing_script' || j.state === 'rendering' ? { hint: 'Still running — call job_status again in 20-30 seconds.' } : {}) });

export async function callTool(name, args = {}, deps = {}) {
  const start = deps.startJob ?? startJob;
  switch (name) {
    case 'create_video': {
      const topic = String(args.topic ?? '').trim();
      if (!topic) return text('topic is required: give a topic or a full script.', true);
      if (args.duration_sec != null && !DURATIONS.includes(Number(args.duration_sec))) return text(`duration_sec must be one of ${DURATIONS.join(', ')}.`, true);
      const job = start({ topic, lang: args.lang === 'en' ? 'en' : args.lang === 'zh' ? 'zh' : undefined, duration: args.duration_sec ? `${Number(args.duration_sec)}秒` : undefined, tone: args.tone, voice: args.voice, provider: args.provider, model: args.model, render: args.render !== false });
      return text({ job_id: job.id, state: job.state, next: 'Poll job_status with this job_id every 20-30 seconds until state is "done" (or "failed").' });
    }
    case 'render_project': {
      const pf = String(args.project ?? '');
      if (!path.isAbsolute(pf) || path.basename(pf) !== 'project.json' || !fs.existsSync(pf)) return text('project must be an absolute path to an existing project.json (see list_projects).', true);
      const job = start({ project: pf });
      return text({ job_id: job.id, state: job.state, next: 'Poll job_status with this job_id.' });
    }
    case 'job_status': {
      if (!args.job_id) return text({ recent_jobs: (deps.listJobs ?? listJobs)(10).map((j) => ({ job_id: j.id, state: j.state, started: j.createdAt, project: j.project })) });
      const j = (deps.readJob ?? readJob)(args.job_id);
      return j ? text(viewJob(j), j.state === 'failed') : text(`No job with id ${args.job_id}. Call job_status without job_id to list recent jobs.`, true);
    }
    case 'list_projects': {
      const out = (deps.readConfig ?? readConfig)().outputDir; let dirs = [];
      try { dirs = fs.readdirSync(out, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')); } catch { /* 输出目录还没建 */ }
      const items = dirs.map((d) => { const pf = path.join(out, d.name, 'project.json'); try { const p = JSON.parse(fs.readFileSync(pf, 'utf-8')); return { id: p.id ?? d.name, title: p.publish?.titles?.[0] ?? p.topic ?? d.name, project: pf, video: p.final?.file ?? null, mtime: fs.statSync(pf).mtimeMs }; } catch { return null; } })
        .filter(Boolean).sort((a, b) => b.mtime - a.mtime).slice(0, Math.min(Number(args.limit) || 15, 50)).map(({ mtime, ...x }) => x);
      return text({ output_dir: out, projects: items });
    }
    case 'doctor': {
      const items = await (deps.doctor ?? (await import('../doctor.mjs')).doctor)();
      const mark = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL' };
      return text(items.map((i) => `${mark[i.status] ?? '    '} ${i.msg}`).join('\n'), items.some((i) => i.status === 'fail'));
    }
    default: return null;
  }
}

/** 处理一条 JSON-RPC 消息；通知（没有 id）一律不回。返回要写回去的对象，或 null */
export async function handleMessage(msg, deps = {}) {
  const isNote = msg?.id === undefined || msg?.id === null;
  const ok = (result) => (isNote ? null : { jsonrpc: '2.0', id: msg.id, result });
  const err = (code, message) => (isNote ? null : { jsonrpc: '2.0', id: msg.id, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return msg?.id !== undefined ? { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32600, message: 'Invalid Request' } } : null;
  switch (msg.method) {
    case 'initialize': return ok({ protocolVersion: SUPPORTED.includes(msg.params?.protocolVersion) ? msg.params.protocolVersion : SUPPORTED[0], capabilities: { tools: {} }, serverInfo: { name: 'openshorts-kaipian', title: 'OpenShorts (Kaipian) — topic in, short video out', version: pkgVersion() },
      instructions: 'OpenShorts (Kaipian, github.com/jnMetaCode/openshorts) turns a topic or script into a finished vertical short video on this machine. Typical flow: create_video → poll job_status every 20-30 s → report the video path. If it fails, run doctor.' });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS });
    case 'tools/call': {
      try { const r = await callTool(msg.params?.name, msg.params?.arguments ?? {}, deps); return r ? ok(r) : err(-32602, `Unknown tool: ${msg.params?.name}`); }
      catch (e) { return ok(text(`Tool crashed: ${String(e?.message ?? e).split('\n')[0]}`, true)); }   // 工具内部出错按 MCP 约定回 isError，不回协议错误——agent 才看得见原因
    }
    default: return msg.method.startsWith('notifications/') ? null : err(-32601, `Method not found: ${msg.method}`);
  }
}

export function serveStdio({ input = process.stdin, output = process.stdout, deps = {} } = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const send = (o) => { if (o) output.write(JSON.stringify(o) + '\n'); };
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    send(await handleMessage(msg, deps));
  });
  const bye = () => { shutdownJobs(); process.exit(0); };
  rl.on('close', bye); process.on('SIGTERM', bye); process.on('SIGINT', bye);
  process.stderr.write(`OpenShorts MCP server ${pkgVersion()} ready (stdio)\n`);
}
