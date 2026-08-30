/**
 * 「开片」四步界面的本地 API（架构 §12）。只监听本机；写操作校验路径在输出目录内；不展开 @file。
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readConfig, writeConfig, aoHome } from '../src/config.mjs';
import { sourcesAvailability } from '../src/sources/availability.mjs';
import { DEFAULT_VOICES, synthesize } from '../src/voice/edge-tts.mjs';
import { buildKouboProject } from '../src/project/koubo.mjs';
import { runKoubo } from '../src/pipeline/koubo-run.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const kaipian = express.Router();
const safe = (id) => String(id).replace(/[\\/:*?"<>|]/g, '').replace(/\.\./g, '').trim();
const projDir = (id) => path.join(readConfig().outputDir, safe(id));
const mask = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-3)}` : '');

kaipian.get('/sources', (_req, res) => res.json(sourcesAvailability()));
kaipian.get('/doctor', async (_req, res, next) => { try { const { doctor } = await import('../src/doctor.mjs'); res.json(await doctor()); } catch (e) { next(e); } });
kaipian.get('/config', (_req, res) => { const c = readConfig(); res.json({ ...c, stock: { pexelsKey: mask(c.stock?.pexelsKey), pixabayKey: mask(c.stock?.pixabayKey), hasPexels: !!c.stock?.pexelsKey, hasPixabay: !!c.stock?.pixabayKey }, aoHome: aoHome() }); });
kaipian.put('/config', (req, res) => {
  const cur = readConfig(); const b = req.body ?? {};
  // 输出目录必须真能写：先建、再试写，失败 400——否则下一次出片才在最后一步炸
  if (b.outputDir) { const od = path.resolve(String(b.outputDir)); try { fs.mkdirSync(od, { recursive: true }); fs.accessSync(od, fs.constants.W_OK); } catch { return res.status(400).json({ error: `输出目录不可写：${od}` }); } b.outputDir = od; }
  const next = { ...cur, ...(b.outputDir ? { outputDir: b.outputDir } : {}), tts: { ...cur.tts, ...(b.tts ?? {}) }, stock: { ...cur.stock } };
  if (typeof b.pexelsKey === 'string' && b.pexelsKey && !b.pexelsKey.includes('…')) next.stock.pexelsKey = b.pexelsKey.trim();
  if (typeof b.pixabayKey === 'string' && b.pixabayKey && !b.pixabayKey.includes('…')) next.stock.pixabayKey = b.pixabayKey.trim();
  writeConfig(next); res.json({ ok: true });
});
kaipian.get('/voices', (_req, res) => res.json(DEFAULT_VOICES));
kaipian.post('/tts/preview', async (req, res, next) => {
  try {
    const text = String(req.body?.text ?? '你好，这是开片的配音试听。').slice(0, 80);
    const r = await synthesize(text, { voice: req.body?.voice || 'zh-CN-XiaoxiaoNeural' });
    res.json({ dataUrl: `data:audio/mpeg;base64,${r.buffer.toString('base64')}`, durationMs: r.durationMs });
  } catch (e) { next(e); }
});
kaipian.post('/new', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    if (!String(b.topic ?? '').trim()) return res.status(400).json({ error: '请输入话题或文案' });
    const { run } = await import('agency-orchestrator');
    const cfg = readConfig();
    const inputs = { topic: String(b.topic).trim(), duration: b.duration || '60秒', tone: b.tone || '科普讲解' };
    const r = await run(path.join(root, 'templates', 'koubo-kepu.yaml'), inputs, { quiet: true, outputDir: path.join(cfg.outputDir, '.ao-runs') });
    if (!r.success) return res.status(502).json({ error: '脚本生成失败：' + r.steps.filter((s) => s.status === 'failed').map((s) => `${s.id}: ${s.error}`).join('；') });
    const project = buildKouboProject(r, { topic: inputs.topic, inputs, defaults: { voice: b.voice || cfg.tts?.voice, captionPreset: b.captions || 'douyin', visualSource: b.source || 'stock', localDirs: b.localDir ? [path.resolve(String(b.localDir))] : [], bgm: b.bgm ? path.resolve(String(b.bgm)) : null } });
    fs.mkdirSync(projDir(project.id), { recursive: true });
    fs.writeFileSync(path.join(projDir(project.id), 'project.json'), JSON.stringify(project, null, 2));
    res.json(project);
  } catch (e) { next(e); }
});
kaipian.get('/projects', (_req, res) => {
  const out = readConfig().outputDir; if (!fs.existsSync(out)) return res.json([]);
  const list = [];
  for (const n of fs.readdirSync(out)) { const f = path.join(out, n, 'project.json'); if (!fs.existsSync(f)) continue; try { const p = JSON.parse(fs.readFileSync(f, 'utf-8')); list.push({ id: p.id, title: p.title, line: p.line, shots: p.shots?.length ?? 0, final: !!p.final?.file, updatedAt: fs.statSync(f).mtime.toISOString() }); } catch { /* skip */ } }
  res.json(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});
kaipian.get('/projects/:id', (req, res) => { const f = path.join(projDir(req.params.id), 'project.json'); if (!fs.existsSync(f)) return res.status(404).json({ error: '项目不存在' }); res.json(JSON.parse(fs.readFileSync(f, 'utf-8'))); });
kaipian.put('/projects/:id', (req, res) => {
  const f = path.join(projDir(req.params.id), 'project.json'); if (!fs.existsSync(f)) return res.status(404).json({ error: '项目不存在' });
  const cur = JSON.parse(fs.readFileSync(f, 'utf-8')); const b = req.body ?? {};
  // 只允许改文案/画面意图/检索词/音色/字幕预设/来源，不允许改路径类字段
  if (Array.isArray(b.shots)) cur.shots = cur.shots.map((s) => { const e = b.shots.find((x) => x.id === s.id); return e ? { ...s, text: String(e.text ?? s.text), query: String(e.query ?? s.query), visualIntent: String(e.visualIntent ?? s.visualIntent), visual: e.resetVisual ? { ...s.visual, file: null, candidateId: null, source: null } : s.visual } : s; });
  if (b.voice) cur.voice = { ...cur.voice, ...b.voice };
  if (b.captions) cur.captions = { ...cur.captions, ...b.captions };
  if (b.defaults) cur.defaults = { ...cur.defaults, ...b.defaults };
  fs.writeFileSync(f, JSON.stringify(cur, null, 2)); res.json(cur);
});
kaipian.get('/projects/:id/run', async (req, res) => {
  const f = path.join(projDir(req.params.id), 'project.json'); if (!fs.existsSync(f)) return res.status(404).json({ error: '项目不存在' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    const project = JSON.parse(fs.readFileSync(f, 'utf-8'));
    const p = await runKoubo(project, { outDir: path.dirname(f), log: (m) => send('log', { m }) });
    send('done', { final: p.final, provenance: p.provenance });
  } catch (e) { send('error', { m: e.message }); }
  res.end();
});
kaipian.get('/projects/:id/file/:name', (req, res) => {
  const dir = projDir(req.params.id); let f = path.resolve(dir, safe(req.params.name));
  if (!fs.existsSync(f) && fs.existsSync(path.join(dir, 'assets', safe(req.params.name)))) f = path.join(dir, 'assets', safe(req.params.name));
  if (!f.startsWith(dir) || !fs.existsSync(f)) return res.status(404).end();
  res.sendFile(f);
});
kaipian.get('/ao-status', (_req, res) => {
  let keys = {}; try { keys = JSON.parse(fs.readFileSync(path.join(aoHome(), '.local', 'web-keys.json'), 'utf-8')); } catch { /* none */ }
  const envs = ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'AGNES_API_KEY', 'APIMART_API_KEY', 'ARK_API_KEY', 'MOONSHOT_API_KEY', 'ZHIPU_API_KEY'].filter((k) => !!process.env[k]);
  const saved = Object.keys(keys).filter((k) => keys[k]?.apiKey);
  res.json({ hasTextKey: saved.length > 0 || envs.length > 0, saved, envs, aoHome: aoHome(), home: os.homedir() });
});

// ───────────── AI 短剧线（复用 AO 短剧流水线；AO 以子进程跑，stdout 逐行转 SSE） ─────────────
import { spawn, spawnSync } from 'node:child_process';
import { aoResultToProject } from '../src/core/ao-result.mjs';
function aoCli() { const main = fileURLToPath(import.meta.resolve('agency-orchestrator')); const dir = path.resolve(path.dirname(main), '..'); return { dir, cli: path.join(dir, 'dist', 'cli.js'), wf: path.join(dir, 'workflows', '短剧流水线.yaml') }; }
const TIERS = {
  local: { video_provider: 'local-sdcpp', video_model: 'minimax-h3-q2', video_resolution: '640x384', video_ratio: '16:9', video_duration: '2', label: '本地草稿档（不花钱，每镜约 3–4 分钟，2-bit 画质）' },
  cloud: { label: '云端成片档（按秒计费，运行前看花费）' },
};
function dramaInputs(b) {
  const t = b.tier === 'local' ? TIERS.local : {};
  const inputs = { story: String(b.story ?? '').trim(), genre: b.genre || '剧情短剧', style: b.style || '美式复古好莱坞', narration: '不配音',
    image_provider: b.image_provider || '', image_model: b.image_model || '',
    video_provider: b.video_provider || t.video_provider || 'apimart', video_model: b.video_model || t.video_model || 'veo3.1-fast', video_resolution: b.video_resolution || t.video_resolution || '720p', video_ratio: b.video_ratio || t.video_ratio || '16:9', video_duration: String(b.video_duration || t.video_duration || '8') };
  if (b.tier === 'local') { inputs.video_ratio = b.video_ratio === '9:16' ? '9:16' : '16:9'; inputs.video_resolution = inputs.video_ratio === '9:16' ? '384x640' : '640x384'; }
  return inputs;
}
const inputArgs = (inputs) => Object.entries(inputs).flatMap(([k, v]) => (v === '' ? [] : ['-i', `${k}=${v}`]));
async function aoProviders() {
  // AO 的 exports 只暴露主入口；按绝对路径 import 同目录文件绕过白名单（同一份 dist，不会漂）
  const main = fileURLToPath(import.meta.resolve('agency-orchestrator'));
  const api = await import(path.join(path.dirname(main), 'connectors', 'api-providers.js'));
  const local = await import(path.join(path.dirname(main), 'connectors', 'local-sdcpp.js')).catch(() => null);
  let keys = {}; try { keys = JSON.parse(fs.readFileSync(path.join(aoHome(), '.local', 'web-keys.json'), 'utf-8')); } catch { /* none */ }
  const hasKey = (p) => !!(keys[p.id]?.apiKey || process.env[p.envKey]);
  const localStatus = local?.localSdcppStatus ? local.localSdcppStatus() : null;
  const video = (api.VIDEO_PROVIDERS ?? []).map((v) => ({ id: v.id, shape: v.shape, hasKey: v.shape === 'local' ? !!localStatus?.ok : hasKey(v), models: (v.models ?? []).map((m) => ({ id: m.id, resolutions: m.resolutions ?? [], durations: m.durations ?? [], ratios: m.ratios ?? [] })) }));
  const KNOWN_IMAGE = { agnes: ['agnes-image-2.0-flash', 'agnes-image-2.1-flash'], volcengine: ['doubao-seedream-5-0-260128'], 'volcengine-plan': ['doubao-seedream-5.0-lite'], lanox: ['gpt-image-2'], apimart: ['gpt-image-2'], openai: ['gpt-image-2'] };
  const image = (api.API_PROVIDERS ?? []).filter((p) => hasKey(p)).map((p) => ({ id: p.id, hasKey: true, models: KNOWN_IMAGE[p.id] ?? [] }));
  return { video, image, localStatus };
}
kaipian.get('/drama/providers', async (_req, res, next) => { try { res.json(await aoProviders()); } catch (e) { next(e); } });
kaipian.get('/drama/options', (_req, res) => {
  const { cli } = aoCli();
  const r = spawnSync(process.execPath, [cli, 'doctor', '--no-probe'], { encoding: 'utf-8', env: { ...process.env, AO_NO_MODEL_HINT: '1' } });
  const out = String(r.stdout || '') + String(r.stderr || '');
  const localReady = /本地出片可用/.test(out);
  const cloud = (out.match(/文生视频可用（type: video）：([^（\n]+)/) || [])[1]?.split(/,\s*/).map((s) => s.trim()).filter(Boolean) ?? [];
  res.json({ tiers: TIERS, localReady, cloudProviders: cloud, doctor: out.split('\n').filter((l) => /本地出片|文生视频|出图/.test(l)) });
});
kaipian.post('/drama/preflight', (req, res) => {
  const inputs = dramaInputs(req.body ?? {});
  if (!inputs.story) return res.status(400).json({ error: '请输入故事' });
  const { cli, wf } = aoCli();
  const r = spawnSync(process.execPath, [cli, 'plan', wf, ...inputArgs(inputs)], { encoding: 'utf-8', env: { ...process.env, AO_NO_MODEL_HINT: '1' } });
  const lines = (String(r.stdout || '') + String(r.stderr || '')).split('\n').map((l) => l.trim()).filter((l) => /^(🎬|🎨|🎙|🎞|·|合计)/.test(l));
  res.json({ inputs, lines, ok: r.status === 0, raw: r.status !== 0 ? String(r.stderr || r.stdout).slice(-400) : undefined });
});
kaipian.get('/drama/run', (req, res) => {
  const q = req.query; const inputs = dramaInputs(q);
  if (!inputs.story) return res.status(400).json({ error: '请输入故事' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const { cli, wf } = aoCli(); const cfg = readConfig();
  const runsDir = path.join(cfg.outputDir, '.ao-runs'); fs.mkdirSync(runsDir, { recursive: true });
  const args = [cli, 'run', wf, '--output', runsDir, ...inputArgs(inputs)];
  if (q.provider) args.push('--provider', String(q.provider)); if (q.model) args.push('--model', String(q.model));
  if (q.verify_provider) args.push('--verify-provider', String(q.verify_provider), '--verify-model', String(q.verify_model || ''));
  const child = spawn(process.execPath, args, { env: { ...process.env, AO_NO_MODEL_HINT: '1', AO_NO_RESUME_HINT: '1', FORCE_COLOR: '0' } });
  let buf = ''; let runDir = '';
  const onLine = (line) => {
    const clean = line.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '').trim(); if (!clean) return;
    const m = clean.match(/详细输出:\s*(.+)$/); if (m) runDir = m[1].trim();
    if (/^(──|🎬|🎨|🎞|⚠️|⟳|✅|❌|完成|失败|部分失败|🖥|💰|·|🎙)/.test(clean) || /验收|重出|素材|镜头/.test(clean)) send('log', { m: clean.slice(0, 300) });
  };
  for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { buf += d.toString(); const parts = buf.split('\n'); buf = parts.pop(); parts.forEach(onLine); });
  child.on('close', (code) => {
    if (buf) onLine(buf);
    // 非 0 退出（中断/失败）不回填：否则会拿半截的运行目录覆盖项目
    if (code !== 0) { send('error', { m: `引擎退出码 ${code}（中断或失败），项目未改动` }); return res.end(); }
    try { const id = finishDramaRun({ runDir, runsDir, inputs, tier: q.tier || 'cloud' }); send('done', { id, code }); }
    catch (e) { send('error', { m: `${e.message}（退出码 ${code}）` }); }
    res.end();
  });
  req.on('close', () => { try { child.kill('SIGTERM'); } catch { /* noop */ } });
});

/** AO 运行目录 → 项目（新建或覆盖同 id）：回填 shots/验收、按输入标来源、拷贝 assets、记住 aoRun 供 resume。 */
function finishDramaRun({ runDir, runsDir, inputs, tier, existingId, shotSources }) {
  if (!runDir) { const dirs = fs.readdirSync(runsDir).filter((d) => d.startsWith('短剧流水线')).map((d) => path.join(runsDir, d)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs); runDir = dirs[0]; }
  if (!runDir || !fs.existsSync(path.join(runDir, 'metadata.json'))) throw new Error('没有找到运行结果');
  const meta = JSON.parse(fs.readFileSync(path.join(runDir, 'metadata.json'), 'utf-8'));
  const tpl = JSON.parse(fs.readFileSync(path.join(root, 'templates', 'ai-drama.template.json'), 'utf-8'));
  const id = existingId || safe(`短剧-${inputs.story.slice(0, 16)}-${new Date().toISOString().slice(5, 16).replace(/[:T]/g, '')}`);
  const project = aoResultToProject(meta, tpl, { id, assetsBase: 'assets' });
  project.line = 'drama'; project.title = inputs.story.slice(0, 30); project.topic = inputs.story; project.inputs = inputs; project.tier = tier; project.shotSources = shotSources ?? {};
  for (const s of project.shots) {
    const ov = shotSources?.[s.id];
    const vp = ov?.video_provider ?? inputs.video_provider, vm = ov?.video_model ?? inputs.video_model;
    s.visual.provider = s.kind === 'video' ? vp : inputs.image_provider || null; s.visual.model = s.kind === 'video' ? vm : inputs.image_model || null;
    s.visual.source = s.kind === 'video' && vp === 'local-sdcpp' ? 'local' : 'cloud';
  }
  const dir = projDir(id); fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  for (const f of fs.readdirSync(path.join(runDir, 'assets'))) fs.copyFileSync(path.join(runDir, 'assets', f), path.join(dir, 'assets', f));
  project.final = project.final ? { file: path.join(dir, project.final.file), aoRun: runDir, notes: [] } : { file: null, aoRun: runDir, notes: ['本次运行没有成片'] };
  project.shots.forEach((s) => { s.visual.file = path.join(dir, s.visual.file); });
  // 保留上次的镜头级来源记录（未重出的镜头沿用）
  if (existingId) { try { const prev = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf-8')); project.redoHistory = [...(prev.redoHistory ?? []), { at: new Date().toISOString(), aoRun: runDir }]; } catch { /* first */ } }
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 2));
  return id;
}

// 单镜重出：AO --resume <上次运行> --from <镜头> [--feedback 意见] [-i video_provider=…]（换来源）。
// 下游（合成）会自动跟着重跑；上游（剧本/定妆图/其他镜头）原样复用，不再花钱。
kaipian.get('/projects/:id/drama/redo', (req, res) => {
  const f = path.join(projDir(req.params.id), 'project.json'); if (!fs.existsSync(f)) return res.status(404).json({ error: '项目不存在' });
  const prev = JSON.parse(fs.readFileSync(f, 'utf-8')); const q = req.query;
  const shot = String(q.shot || ''); if (!/^(shot[123]|character)$/.test(shot)) return res.status(400).json({ error: '只能重出 character / shot1 / shot2 / shot3' });
  if (!prev.final?.aoRun || !fs.existsSync(prev.final.aoRun)) return res.status(409).json({ error: '找不到上次的 AO 运行目录，无法续跑（可能被清理了）' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const { cli, wf } = aoCli(); const cfg = readConfig(); const runsDir = path.join(cfg.outputDir, '.ao-runs');
  // 换来源：本镜的 tier 覆盖只影响这次 -i；记进 shotSources 让标注正确
  const inputs = { ...prev.inputs };
  const shotSources = {};
  if (q.tier === 'local') { Object.assign(inputs, { video_provider: TIERS.local.video_provider, video_model: TIERS.local.video_model, video_resolution: inputs.video_ratio === '9:16' ? '384x640' : '640x384', video_duration: TIERS.local.video_duration }); }
  else if (q.tier === 'cloud') { for (const k of ['video_provider', 'video_model', 'video_resolution', 'video_duration']) if (q[k]) inputs[k] = String(q[k]); }
  shotSources[shot] = { video_provider: inputs.video_provider, video_model: inputs.video_model };
  const args = [cli, 'run', wf, '--output', runsDir, '--resume', prev.final.aoRun, '--from', shot, ...inputArgs(inputs)];
  if (q.feedback && String(q.feedback).trim()) args.push('--feedback', String(q.feedback).trim());
  if (q.verify_provider) args.push('--verify-provider', String(q.verify_provider), '--verify-model', String(q.verify_model || ''));
  const child = spawn(process.execPath, args, { env: { ...process.env, AO_NO_MODEL_HINT: '1', AO_NO_RESUME_HINT: '1', FORCE_COLOR: '0' } });
  let buf = ''; let runDir = '';
  const onLine = (line) => { const clean = line.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '').trim(); if (!clean) return; const m = clean.match(/详细输出:\s*(.+)$/); if (m) runDir = m[1].trim(); if (/^(──|🎬|🎨|🎞|⚠️|⟳|✅|❌|完成|失败|部分失败|🖥|✎|·)/.test(clean) || /验收|重出|镜头|恢复自|跳过已完成/.test(clean)) send('log', { m: clean.slice(0, 300) }); };
  for (const st of [child.stdout, child.stderr]) st.on('data', (d) => { buf += d.toString(); const parts = buf.split('\n'); buf = parts.pop(); parts.forEach(onLine); });
  child.on('close', (code) => {
    if (buf) onLine(buf);
    if (code !== 0) { send('error', { m: `引擎退出码 ${code}（中断或失败），项目未改动` }); return res.end(); }
    try { const id = finishDramaRun({ runDir, runsDir, inputs: prev.inputs, tier: prev.tier, existingId: prev.id, shotSources: { ...(prev.shotSources ?? {}), ...shotSources } }); send('done', { id, code }); }
    catch (e) { send('error', { m: `${e.message}（退出码 ${code}）` }); }
    res.end();
  });
  req.on('close', () => { try { child.kill('SIGTERM'); } catch { /* noop */ } });
});

// ───────────── 本地生成：状态 / 安装 sd-cli / 下载模型（SSE 进度；下载前必须确认许可证） ─────────────
import { downloadWithResume, pickSdcppAsset } from '../src/local/download.mjs';
import { execFileSync } from 'node:child_process';
const HF = 'https://huggingface.co/unsloth/MiniMax-H3-GGUF/resolve/main';
const MODEL_FILES = (m) => [[m.diffusion, `${HF}/${m.diffusion}`], [m.llm, `${HF}/${m.llm}`], ['minimax_h3_video_vae_fp16.safetensors', `${HF}/vae/minimax_h3_video_vae_fp16.safetensors`], ['minimax_h3_audio_vae_fp32.safetensors', `${HF}/vae/minimax_h3_audio_vae_fp32.safetensors`]];
async function localModule() { const main = fileURLToPath(import.meta.resolve('agency-orchestrator')); return import(path.join(path.dirname(main), 'connectors', 'local-sdcpp.js')); }
kaipian.get('/local/status', async (_req, res, next) => { try { const m = await localModule(); res.json({ ...m.localSdcppStatus(), catalog: m.LOCAL_MODELS, license: 'MiniMax-H3 Community License（含适用地域与用途限制）：https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE' }); } catch (e) { next(e); } });
kaipian.get('/local/install', async (req, res) => {
  const q = req.query; const what = String(q.what || ''); const modelId = String(q.model || 'minimax-h3-q2');
  if (q.agree !== '1') return res.status(400).json({ error: '下载前需确认已阅读 MiniMax-H3 Community License 与 stable-diffusion.cpp 的 MIT 许可' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const ac = new AbortController(); req.on('close', () => ac.abort());
  try {
    const m = await localModule(); const { cli, modelsDir } = m.sdcppPaths();
    if (what === 'sdcli' || what === 'all') {
      const rel = await (await fetch('https://api.github.com/repos/leejet/stable-diffusion.cpp/releases/latest', { headers: { 'User-Agent': 'OpenShorts/2.0' }, signal: ac.signal })).json();
      const asset = pickSdcppAsset(rel.assets ?? []); if (!asset) throw new Error(`没有找到本平台（${process.platform}/${process.arch}）的 sd-cli 预编译包，请从源码编译（见 doctor 提示）`);
      send('log', { m: `下载 sd-cli ${rel.tag_name} · ${asset.name}（${(asset.size / 1048576).toFixed(0)} MB）` });
      const zip = path.join(path.dirname(cli), asset.name);
      await downloadWithResume(asset.browser_download_url, zip, { signal: ac.signal, onProgress: (p) => send('progress', { file: asset.name, ...p }) });
      fs.mkdirSync(path.dirname(cli), { recursive: true });
      execFileSync(process.platform === 'win32' ? 'tar' : 'unzip', process.platform === 'win32' ? ['-xf', zip, '-C', path.dirname(cli)] : ['-o', '-q', zip, '-d', path.dirname(cli)]);
      const found = walkFind(path.dirname(cli), /^sd-cli(\.exe)?$/); if (!found) throw new Error('解压后没找到 sd-cli');
      if (found !== cli) fs.copyFileSync(found, cli); if (process.platform !== 'win32') fs.chmodSync(cli, 0o755);
      if (process.platform === 'darwin') { try { execFileSync('xattr', ['-cr', path.dirname(cli)]); } catch { /* 无隔离属性 */ } }
      send('log', { m: `sd-cli 就绪：${cli}` });
    }
    if (what === 'model' || what === 'all') {
      const cat = m.LOCAL_MODELS.find((x) => x.id === modelId); if (!cat) throw new Error(`未知档位 ${modelId}`);
      for (const [name, url] of MODEL_FILES(cat)) {
        send('log', { m: `下载 ${name}` });
        await downloadWithResume(url, path.join(modelsDir, name), { signal: ac.signal, onProgress: (p) => send('progress', { file: name, ...p }) });
      }
      send('log', { m: `模型就绪：${modelsDir}` });
    }
    send('done', m.localSdcppStatus());
  } catch (e) { send('error', { m: e.message }); }
  res.end();
});
function walkFind(dir, re) { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); const st = fs.statSync(p); if (st.isDirectory()) { const r = walkFind(p, re); if (r) return r; } else if (re.test(n)) return p; } return null; }
