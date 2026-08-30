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
  const dir = projDir(req.params.id); const f = path.resolve(dir, safe(req.params.name));
  if (!f.startsWith(dir) || !fs.existsSync(f)) return res.status(404).end();
  res.sendFile(f);
});
kaipian.get('/ao-status', (_req, res) => {
  let keys = {}; try { keys = JSON.parse(fs.readFileSync(path.join(aoHome(), '.local', 'web-keys.json'), 'utf-8')); } catch { /* none */ }
  const envs = ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'AGNES_API_KEY', 'APIMART_API_KEY', 'ARK_API_KEY', 'MOONSHOT_API_KEY', 'ZHIPU_API_KEY'].filter((k) => !!process.env[k]);
  const saved = Object.keys(keys).filter((k) => keys[k]?.apiKey);
  res.json({ hasTextKey: saved.length > 0 || envs.length > 0, saved, envs, aoHome: aoHome(), home: os.homedir() });
});
