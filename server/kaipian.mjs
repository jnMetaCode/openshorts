/**
 * 「开片」四步界面的本地 API（架构 §12）。只监听本机；写操作校验路径在输出目录内；不展开 @file。
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { importAo } from '../src/core/ao-module.mjs';
import { readConfig, writeConfig, aoHome, applyAoKeysToEnv, isEnvAppliedByUs } from '../src/config.mjs';
import { sourcesAvailability } from '../src/sources/availability.mjs';
import { DEFAULT_VOICES, voicesFor, synthesize } from '../src/voice/edge-tts.mjs';
import { uniqueProjectId } from '../src/project/koubo.mjs';
import { langSpec, normLang, localizeInputs, tt } from '../src/project/lang.mjs';
import { generateKoubo } from '../src/pipeline/koubo-script.mjs';
import { runKoubo } from '../src/pipeline/koubo-run.mjs';
import { planVariants, runBatch } from '../src/pipeline/batch.mjs';
// 测试缝：出片/批量的实现从这里取，端点测试换成假的就能不联网验 409 锁 / 断线重连 / cancel（生产就是本尊）
export const _pipeline = { runKoubo, runBatch, generateKoubo };
let newSeq = 0;
import { spawnTree, killTree } from './lib/proc.mjs';
import { readStepOutput } from './lib/ao-run-dir.mjs';
import { writeJsonAtomic } from '../src/core/fs-atomic.mjs';
import { JobHub } from './lib/job-hub.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const kaipian = express.Router();
const safe = (id) => String(id).replace(/[\\/:*?"<>|]/g, '').replace(/\.\./g, '').trim();
const projDir = (id) => path.join(readConfig().outputDir, safe(id));
const mask = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-3)}` : '');
/**
 * 报错文案的语言。**优先跟着项目走**：英文项目的报错就该是英文，跟用户此刻界面切到哪儿无关
 * （报错常常是事后翻日志看的）。项目读不到才看请求上的 lang，最后才回落中文。
 * 界面把这些 error 原样显示——不在这里定语言的话，英文用户一遇到问题就掉回中文。
 */
const reqLang = (req) => normLang(req?.query?.lang ?? req?.body?.lang ?? 'zh');
const projLang = (id, req) => {
  try { return normLang(JSON.parse(fs.readFileSync(path.join(projDir(id), 'project.json'), 'utf-8')).lang); }
  catch { return reqLang(req); }
};

kaipian.get('/sources', (req, res) => res.json(sourcesAvailability({ lang: req.query.lang === 'en' ? 'en' : 'zh' })));
kaipian.get('/doctor', async (_req, res, next) => { try { const { doctor } = await import('../src/doctor.mjs'); res.json(await doctor()); } catch (e) { next(e); } });
kaipian.get('/config', (_req, res) => { const c = readConfig(); res.json({ ...c, stock: { pexelsKey: mask(c.stock?.pexelsKey), pixabayKey: mask(c.stock?.pixabayKey), hasPexels: !!c.stock?.pexelsKey, hasPixabay: !!c.stock?.pixabayKey }, aoHome: aoHome() }); });
kaipian.put('/config', (req, res) => {
  const cur = readConfig(); const b = req.body ?? {};
  // 输出目录必须真能写：先建、再试写，失败 400——否则下一次出片才在最后一步炸
  if (b.outputDir) {
    const od = path.resolve(String(b.outputDir));
    if (od === path.parse(od).root) return res.status(400).json({ error: tt(reqLang(req))('输出目录不能是文件系统根目录', 'The output directory cannot be the filesystem root') });
    try { fs.mkdirSync(od, { recursive: true }); fs.accessSync(od, fs.constants.W_OK); } catch { return res.status(400).json({ error: tt(reqLang(req))(`输出目录不可写：${od}`, `Output directory is not writable: ${od}`) }); }
    b.outputDir = od;
  }
  const next = { ...cur, ...(b.outputDir ? { outputDir: b.outputDir } : {}), tts: { ...cur.tts, ...(b.tts ?? {}) }, vision: { ...(cur.vision ?? {}), ...(b.vision ?? {}) }, text: { ...(cur.text ?? {}), ...(b.text ?? {}) }, stock: { ...cur.stock } };
  if (typeof b.pexelsKey === 'string' && b.pexelsKey && !b.pexelsKey.includes('…')) next.stock.pexelsKey = b.pexelsKey.trim();
  if (typeof b.pixabayKey === 'string' && b.pixabayKey && !b.pixabayKey.includes('…')) next.stock.pixabayKey = b.pixabayKey.trim();
  writeConfig(next); res.json({ ok: true });
});
/** 素材库 key 探活（开发计划 M0 就写了"注册 + 粘贴 + 探活"，探活一直没做）：
 *  填错的 key 以前要到出片时才发现。各真发一次最小检索（占 1 次配额）。 */
kaipian.post('/stock/test', async (req, res) => {
  const { searchPexels, searchPixabay } = await import('../src/sources/stock.mjs');
  const cur = readConfig(); const b = req.body ?? {};
  const pick = (v, saved) => (typeof v === 'string' && v && !v.includes('…') ? v.trim() : saved);
  const test = async (fn, key) => {
    if (!key) return { configured: false };
    try { const hits = await fn('nature', { key, limit: 1 }); return { configured: true, ok: true, hits: hits.length }; }
    catch (e) { return { configured: true, ok: false, error: String(e.message).split('\n')[0].slice(0, 120) }; }
  };
  res.json({
    pexels: await test(searchPexels, pick(b.pexelsKey, cur.stock?.pexelsKey)),
    pixabay: await test(searchPixabay, pick(b.pixabayKey, cur.stock?.pixabayKey)),
  });
});
// 出片语言决定音色：英文片配中文音色会把整段英文念成拼音式怪腔（真机试听过一次就明白）
kaipian.get('/voices', (req, res) => res.json(req.query.lang ? voicesFor(req.query.lang) : DEFAULT_VOICES));
kaipian.post('/tts/preview', async (req, res, next) => {
  try {
    const spec = langSpec(req.body?.lang);
    const text = String(req.body?.text ?? spec.ttsSample).slice(0, 80);
    const r = await synthesize(text, { voice: req.body?.voice || spec.voice });
    res.json({ dataUrl: `data:audio/mpeg;base64,${r.buffer.toString('base64')}`, durationMs: r.durationMs });
  } catch (e) { next(e); }
});
kaipian.post('/new', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    if (!String(b.topic ?? '').trim()) return res.status(400).json({ error: tt(reqLang(req))('请输入话题或文案', 'Enter a topic or a script') });
    const cfg = readConfig();
    const lang = normLang(b.lang); const spec = langSpec(lang);
    // 时长/语气从界面上来的一律是中文选项值（英文只是显示层翻译）——英文模板要的是英文，
    // 不翻的话提示词里会出现「{{duration}} = 60秒」，模型多半跟着改用中文写正文
    const inputs = localizeInputs({ topic: String(b.topic).trim(), duration: b.duration || '60秒', tone: b.tone || '科普讲解' }, lang);
    // 侧栏选的模型要真的用上：不传 llmOverride 的话 AO 会用它自己的默认供应商，
    // 用户在界面里选了 agnes 却跑去调 deepseek，报"缺 key"时一头雾水
    const over = cfg.text?.provider ? { llmOverride: { provider: cfg.text.provider, ...(cfg.text.model ? { model: cfg.text.model } : {}) } } : {};
    // 配的中文音色不能带进英文片：英文文本用中文音色念出来是一口怪腔，
    // 而 cfg.tts.voice 是全局默认（用户为中文片选的），语言不匹配时按语言回落
    const voice = b.voice || (String(cfg.tts?.voice ?? '').toLowerCase().startsWith(lang === 'en' ? 'en-' : 'zh-') ? cfg.tts.voice : spec.voice);
    // 与 CLI 同一份编排：脚本长度不达标或 JSON 写坏会自动重写一次（generateKoubo）
    const T = tt(lang);
    const gen = (log) => _pipeline.generateKoubo({ wf: path.join(root, 'templates', spec.template), inputs, lang, log,
      buildDefaults: { voice, captionPreset: b.captions || 'douyin', captionStyle: b.captionStyle && typeof b.captionStyle === 'object' ? b.captionStyle : {}, visualSource: b.source || 'stock', localDirs: b.localDir ? [path.resolve(String(b.localDir))] : [], bgm: b.bgm ? path.resolve(String(b.bgm)) : null },
      aoOpts: { quiet: true, outputDir: path.join(cfg.outputDir, '.ao-runs'), ...over } });
    const finalize = (g) => {
      if (!g.ok && g.kind === 'run') throw Object.assign(new Error(T('脚本生成失败：', 'Script generation failed: ') + g.res.steps.filter((s) => s.status === 'failed').map((s) => `${s.id}: ${s.error}`).join(T('；', '; '))), { status: 502 });
      if (!g.ok) throw Object.assign(new Error(T(`脚本写出来了但解析不了（已自动重写一次仍失败）：${String(g.error.message).split('\n')[0]}。再试一次，或在设置里换个文本模型。`, `The model wrote a script but it could not be parsed (one automatic rewrite also failed): ${String(g.error.message).split('\n')[0]}. Try again, or pick another text model in settings.`)), { status: 502 });
      const project = g.project;
      project.id = uniqueProjectId(cfg.outputDir, safe(project.id));   // 同话题再跑一次不该覆盖上一条片子
      fs.mkdirSync(projDir(project.id), { recursive: true });
      writeJsonAtomic(path.join(projDir(project.id), 'project.json'), project);
      return project;
    };
    // 界面走任务模式：写脚本 20–60 秒是顺利时的数字，供应商限流时能拖到几分钟——以前界面只有一行"正在写"，
    // 服务端日志里的"429 重试 (3/5)"用户看不见。现在立刻回一个任务 key，进度从 /jobs/:key/events 流出来。
    if (b.async) {
      const key = `new:${Date.now().toString(36)}${(newSeq++ % 1296).toString(36)}`;   // 同一毫秒两次点击不能撞同一个 key（撞了 hub.start 会抛）
      const job = hub.start(key, { meta: { kind: 'new', topic: inputs.topic.slice(0, 40) } });
      const log = (m) => hub.emit(job, 'log', { m });
      const t0 = Date.now();
      const beat = setInterval(() => log(T(`已等待 ${Math.round((Date.now() - t0) / 1000)} 秒：模型还在写（供应商限流时会自动退避重试，最长几分钟）`, `${Math.round((Date.now() - t0) / 1000)} s so far: the model is still writing (rate limits are retried with backoff, up to a few minutes)`)), 30_000);
      const untap = tapEngineOutput(log);
      (async () => {
        try { const project = finalize(await gen(log)); hub.finish(job, 'done', { project }); }
        catch (e) { hub.finish(job, 'error', { m: e.message }); }
        finally { clearInterval(beat); untap(); }
      })();
      return res.status(202).json({ job: key });
    }
    const g0 = await gen(() => {});
    let project;
    try { project = finalize(g0); } catch (e) { return res.status(e.status ?? 500).json({ error: e.message }); }
    res.json(project); return;
  } catch (e) { next(e); }
});
kaipian.get('/projects', (_req, res) => {
  const out = readConfig().outputDir; if (!fs.existsSync(out)) return res.json([]);
  const list = [];
  for (const n of fs.readdirSync(out)) { const f = path.join(out, n, 'project.json'); if (!fs.existsSync(f)) continue; try { const p = JSON.parse(fs.readFileSync(f, 'utf-8')); list.push({ id: p.id, title: p.title, line: p.line, shots: p.shots?.length ?? 0, final: !!p.final?.file, updatedAt: fs.statSync(f).mtime.toISOString() }); } catch { /* skip */ } }
  res.json(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});
kaipian.get('/projects/:id', (req, res) => { const f = path.join(projDir(req.params.id), 'project.json'); if (!fs.existsSync(f)) return res.status(404).json({ error: tt(reqLang(req))('项目不存在', 'No such project') }); res.json(JSON.parse(fs.readFileSync(f, 'utf-8'))); });
kaipian.put('/projects/:id', (req, res) => {
  const f = path.join(projDir(req.params.id), 'project.json'); if (!fs.existsSync(f)) return res.status(404).json({ error: tt(reqLang(req))('项目不存在', 'No such project') });
  const cur = JSON.parse(fs.readFileSync(f, 'utf-8')); const b = req.body ?? {};
  // 只允许改文案/画面意图/检索词/音色/字幕预设/来源，不允许改路径类字段
  if (Array.isArray(b.shots)) cur.shots = cur.shots.map((s) => { const e = b.shots.find((x) => x.id === s.id); return e ? { ...s, text: String(e.text ?? s.text), query: String(e.query ?? s.query), visualIntent: String(e.visualIntent ?? s.visualIntent), visual: e.resetVisual ? { ...s.visual, file: null, candidateId: null, source: null } : s.visual } : s; });
  if (b.voice) cur.voice = { ...cur.voice, ...b.voice };
  if (b.captions) cur.captions = { ...cur.captions, ...b.captions, style: { ...(cur.captions?.style ?? {}), ...(b.captions.style ?? {}) } };
  if (b.defaults) cur.defaults = { ...cur.defaults, ...b.defaults };
  writeJsonAtomic(f, cur); res.json(cur);
});
// 同一个项目同时只允许跑一次：两个标签页各点一次「出片」会同时写同一个 work 目录和 project.json，
// 产物互相覆盖且症状难查。
// 任务不挂在 SSE 连接上（lib/job-hub.mjs）：以前 req 'close' 就 abort，刷新页面 / 合盖 / Wi-Fi 抖一下
// 等于把跑了 20 分钟的出片作废。现在连接断了活照跑，重连按 Last-Event-ID 接着看，取消只认 POST /cancel。
const hub = new JobHub();
export const _hub = hub;   // 测试缝：模拟"短剧正在重出这个项目"这类状态
/**
 * 把引擎打在 stdout 上的进度行（"⚠️ script 失败 (429)…6s 后重试"、"⏱️ 90s 内未返回"、"🔄 自动续写"）接到任务日志里。
 * AO 的库函数 run() 没有 onLog 钩子，这些行只在服务端终端能看见——用户那边就是一片沉默。
 * 只截带这几个标记的行，其它输出原样放行；没有任务在听时什么都不做。
 */
const engineTaps = new Set();
const ENGINE_LINE = /^\s*(⚠️|⏱️|🔄|❌)\s*\S/;
// stdout 和 stderr 都要挂：AO 连接器的重试/停滞行走的是 console.warn/error（stderr）——只挂 stdout 时真机上一行也接不到
for (const stream of [process.stdout, process.stderr]) {
  const orig = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => {
    if (engineTaps.size) for (const line of String(chunk).split(/\r?\n/)) { const t = line.trim(); if (ENGINE_LINE.test(t)) for (const tap of engineTaps) tap(t.slice(0, 200)); }
    return orig(chunk, ...rest);
  };
}
const tapEngineOutput = (log) => { engineTaps.add(log); return () => engineTaps.delete(log); };
// 通用任务接口：写脚本这类不绑项目的任务用 key 看进度（页面刷新后凭 key 也能接上）
const jobKey = (k) => String(k).replace(/[^\w:.-]/g, '');
kaipian.get('/jobs/:key/events', (req, res) => {
  const job = hub.get(jobKey(req.params.key));
  if (!job) return res.status(404).json({ error: tt(reqLang(req))('没有这个任务', 'No such job') });
  hub.attach(job, req, res);
});
kaipian.get('/jobs/:key/status', (req, res) => res.json(hub.status(jobKey(req.params.key))));
const kKey = (id) => `koubo:${id}`;
kaipian.get('/projects/:id/run', async (req, res) => {
  const id = safe(req.params.id);
  const f = path.join(projDir(id), 'project.json'); if (!fs.existsSync(f)) return res.status(404).json({ error: tt(reqLang(req))('项目不存在', 'No such project') });
  if (hub.isRunning(kKey(id))) {
    // 浏览器 EventSource 断线自动重连会带 Last-Event-ID：那是"接着看"，不是"再跑一条"
    if (req.headers['last-event-id']) return hub.attach(hub.get(kKey(id)), req, res);
    return res.status(409).json({ error: tt(projLang(id, req))('这个项目正在出片，等它跑完或先取消', 'This project is already rendering — wait for it to finish, or cancel it first') });
  }
  const project = JSON.parse(fs.readFileSync(f, 'utf-8'));
  const only = req.query.only ? String(req.query.only).split(',').map((x) => x.trim()).filter(Boolean) : null;
  const ac = new AbortController();
  const job = hub.start(kKey(id), { cancel: () => ac.abort(), meta: { kind: 'run', only } });
  (async () => {
    try {
      const p = await _pipeline.runKoubo(project, { outDir: path.dirname(f), log: (m) => hub.emit(job, 'log', { m }), vision: readConfig().vision, signal: ac.signal, only,
        localImage: req.query.localImage === '0' ? false : 'auto' });
      hub.finish(job, 'done', { final: p.final, provenance: p.provenance });
    } catch (e) { hub.finish(job, 'error', { m: e.message }); }
  })();
  hub.attach(job, req, res);
});
// 接着看：页面重开 / 换回这个项目时，正在跑的（或刚跑完的）出片从头补发日志
kaipian.get('/projects/:id/events', (req, res) => {
  const id = safe(req.params.id); const job = hub.get(kKey(id));
  if (!job) return res.status(404).json({ error: tt(projLang(id, req))('这个项目没有在跑，也没有上一次的记录', 'This project is not running and has no previous run to show') });
  hub.attach(job, req, res);
});
kaipian.get('/projects/:id/status', (req, res) => res.json(hub.status(kKey(safe(req.params.id)))));
// 删项目：以前界面 / CLI 都没有，用户只能手动 rm 目录。正在出片的不许删（work 目录还在被写）；
// 目录名清洗后为空（"." "…" 之类）会算到输出目录本身，必须拦——rmSync recursive 删错根就是所有项目一起没
kaipian.delete('/projects/:id', (req, res) => {
  const id = safe(req.params.id); const dir = projDir(id);
  if (!id || path.resolve(dir) === path.resolve(readConfig().outputDir) || !fs.existsSync(path.join(dir, 'project.json'))) return res.status(404).json({ error: tt(reqLang(req))('项目不存在', 'No such project') });
  // 口播出片按项目锁；短剧重出的锁是全局 'drama'，得看它记的 projectId——不拦的话 AO 跑完 finishDramaRun 会把刚删的目录再建回来
  if (hub.isRunning(kKey(id)) || (hub.isRunning('drama') && hub.get('drama').meta?.projectId === id)) return res.status(409).json({ error: tt(projLang(id, req))('这个项目正在出片，先取消再删', 'This project is rendering — cancel it before deleting') });
  fs.rmSync(dir, { recursive: true, force: true });
  hub.jobs.delete(kKey(id));
  res.json({ ok: true, id });
});
kaipian.post('/projects/:id/cancel', (req, res) => {
  const id = safe(req.params.id);
  if (!hub.cancel(kKey(id))) return res.status(404).json({ error: tt(projLang(id, req))('这个项目没有在跑', 'This project is not running') });
  res.json({ ok: true });
});


// ───────────── 模型设置（写脚本的文本模型 / 看图把关的视觉模型） ─────────────
// 以前这两样只能去改文件：文本模型靠 AO 密钥页或环境变量，看图把关只能改 ~/.openshorts/config.json
// 或加 --vision-provider。而看图把关恰恰是决定"会不会把一口钟配进猫科普"的那个开关——
// 藏在配置文件里等于没有。
const KEYS_FILE = () => path.join(aoHome(), '.local', 'web-keys.json');
function readAoKeys() { try { return JSON.parse(fs.readFileSync(KEYS_FILE(), 'utf-8')); } catch { return {}; } }
function writeAoKey(provider, apiKey) {
  const keys = readAoKeys();
  keys[provider] = { ...(keys[provider] ?? {}), apiKey };
  fs.mkdirSync(path.dirname(KEYS_FILE()), { recursive: true });
  writeJsonAtomic(KEYS_FILE(), keys);
  try { fs.chmodSync(KEYS_FILE(), 0o600); } catch { /* Windows 上没有 chmod 语义 */ }
  return keys;
}

/** 能配 key 的供应商 + 常见模型名（模型 id 各家不通用，列的是核实过的，其余可手填） */
const KNOWN_TEXT_MODELS = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  openai: ['gpt-5', 'gpt-5-mini'],
  agnes: ['agnes-2.0-flash', 'agnes-2.0-pro'],
  moonshot: ['kimi-k2-turbo-preview'],
  zhipu: ['glm-4.6', 'glm-4-flash', 'glm-4.6v-flash'],   // 后两个是免费档；带 v 的能看图（issue #12 的用户真机验证通过的就是这两个）
  qwen: ['qwen3-max'],
  volcengine: ['doubao-seed-1-6-250615'],
  gemini: ['gemini-3-flash', 'gemini-3-pro'],
  xai: ['grok-4'],
};
// 看图把关的候选型号单列：和文本候选共用的话，选智谱时默认落在 glm-4.6（看不了图）。只列真机上验过能看图的，其余手填
const KNOWN_VISION_MODELS = { agnes: ['agnes-2.0-flash'], zhipu: ['glm-4.6v-flash'] };
// 能看图的（看图把关只能用这些）——CLI 订阅类连接器会把图片剥掉，选了等于没开
const VISION_CAPABLE = ['agnes', 'openai', 'gemini', 'zhipu', 'qwen', 'volcengine', 'moonshot', 'apimart', 'lanox'];

kaipian.get('/providers/text', async (_req, res, next) => {
  try {
    const api = await importAo('connectors', 'api-providers.js');
    const keys = readAoKeys();
    const list = (api.API_PROVIDERS ?? []).map((p) => ({
      id: p.id,
      hasKey: !!(keys[p.id]?.apiKey || (p.envKey && process.env[p.envKey])),
      fromEnv: !!(p.envKey && process.env[p.envKey]),
      envKey: p.envKey ?? null,
      models: KNOWN_TEXT_MODELS[p.id] ?? [],
      visionModels: KNOWN_VISION_MODELS[p.id] ?? [],
      vision: VISION_CAPABLE.includes(p.id),
    }));
    const c = readConfig();
    res.json({ providers: list, vision: c.vision ?? { provider: '', model: '' }, text: c.text ?? { provider: '', model: '' } });
  } catch (e) { next(e); }
});

kaipian.post('/ao-keys', async (req, res) => {
  const provider = String(req.body?.provider ?? '').trim();
  const apiKey = String(req.body?.apiKey ?? '').trim();
  if (!/^[a-z0-9-]{2,32}$/.test(provider)) return res.status(400).json({ error: tt(reqLang(req))('供应商 id 不合法', 'Invalid provider id') });
  if (!apiKey || apiKey.includes('…')) return res.status(400).json({ error: tt(reqLang(req))('请粘贴完整的 key', 'Paste the full key') });
  // key 要放进 HTTP 头，只能是可见 ASCII。从聊天软件 / 网页复制时常带进全角空格、中文引号、零宽字符——
  // 不在这里拦，到写脚本时引擎报的是"Cannot convert argument to a ByteString…可能原因：无法连接"，完全看不出是 key 的事
  const badCh = [...apiKey].find((ch) => !/^[\x21-\x7e]$/.test(ch));
  if (badCh) return res.status(400).json({ error: tt(reqLang(req))(`key 里有不该出现的字符（${/\s/.test(badCh) ? '空格或换行' : `「${badCh}」`}），多半是复制时带进来的——请回到供应商后台重新复制`, `The key contains a character that cannot be part of it (${/\s/.test(badCh) ? 'a space or line break' : `"${badCh}"`}), probably picked up while copying — copy it again from the provider's console`) });
  writeAoKey(provider, apiKey);
  // AO 的库函数只认环境变量：不在这里同步，刚存好的 key 要重启才生效，
  // 新用户"存 key → 写脚本"当场报"缺少 API Key"（issue #12）
  await applyAoKeysToEnv();
  res.json({ ok: true, saved: Object.keys(readAoKeys()).filter((k) => readAoKeys()[k]?.apiKey) });
});

/** 纯色 PNG 的 data URI（64×64，不引依赖）：验视觉模型用。1×1 的图有的供应商会拒收 */
export function solidPngDataUri(r, g, b, size = 64) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** 存之前先拿它真发一次请求：key 打错、余额没了、模型 id 不对，都在这里就说清楚，别等到出片时才炸 */
kaipian.post('/ao-keys/test', async (req, res) => {
  const { provider, model, apiKey, kind } = req.body ?? {};
  const T = tt(reqLang(req));
  if (!provider || !model) return res.status(400).json({ error: T('要选供应商和模型', 'Pick a provider and a model') });
  try {
    const { createConnector } = await import('agency-orchestrator');
    const key = apiKey && !String(apiKey).includes('…') ? String(apiKey) : readAoKeys()[provider]?.apiKey;
    const cfg = { provider, model, api_key: key || undefined, timeout: 60000, retry: 0 };
    if (kind === 'vision') {
      // 看图把关必须真发一张图来验：只发文字的话，看不了图的模型（智谱 glm-4.6、deepseek-chat…）照样"验证通过"、
      // 右栏显示 ✅，出片时每一镜看图才失败，画面退回按检索词字面匹配——又一个"看着好了，后面才炸"。
      // 图片走的路与出片时一致（data URI 嵌在提示词里，见 src/sources/rank.mjs）。
      const r = await createConnector(cfg).chat('Answer with one word.', `What is the main colour of this image? One English word only.\n${solidPngDataUri(220, 30, 30)}`, { ...cfg, max_tokens: 1500, temperature: 0 });
      const reply = String(r.content ?? '').trim();
      if (!/\bred\b|红/i.test(reply)) return res.json({ ok: false, error: T(`这个模型看不了图：给它一张纯红色的图，它回的是「${reply.slice(0, 40) || '空'}」。换成带视觉能力的型号（型号名里通常带 v / vl / vision）。`, `This model cannot see images: shown a plain red image, it answered "${reply.slice(0, 40) || 'nothing'}". Pick a vision-capable model (usually has v / vl / vision in its name).`) });
      return res.json({ ok: true, reply: reply.slice(0, 60), saw: 'red' });
    }
    const r = await createConnector(cfg).chat('只回一个词', '说 ok', { ...cfg, max_tokens: 1500 });
    res.json({ ok: true, reply: String(r.content ?? '').trim().slice(0, 60) });
  } catch (e) {
    const first = String(e.message).split('\n')[0].slice(0, 200);
    res.status(200).json({ ok: false, error: kind === 'vision' ? T(`${first}（验证时发了一张图；如果同一把 key 写脚本是好的，多半是这个模型不支持图片输入）`, `${first} (the check sends an image; if this key works for script writing, the model most likely does not accept image input)`) : first });
  }
});

// 本地文生图（sd.cpp + FLUX.1-schnell，Apache-2.0 可商用）：素材库没命中时本机现画一张，不退纯色底
import { sdImageStatus, installSdImage } from '../src/local/sd-image.mjs';
kaipian.get('/local-image', async (_req, res, next) => { try { res.json(await sdImageStatus()); } catch (e) { next(e); } });
kaipian.get('/local-image/install', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const ac = new AbortController(); req.on('close', () => ac.abort());
  try { send('done', await installSdImage({ model: String(req.query.model || 'flux-schnell-q4'), signal: ac.signal, onLog: (m) => send('log', { m }), onProgress: (p) => send('progress', p) })); }
  catch (e) { send('error', { m: e.message }); }
  res.end();
});

// ffmpeg 能力与一键安装：Homebrew 的 ffmpeg 不含 libass ⇒ 字幕烧不进画面，这是免费路径的硬伤，
// 所以和本地模型一样做成"界面上点一下就装"，装到 ~/.openshorts/bin，不动系统 ffmpeg。
import { ffmpegCaps, installFfmpeg } from '../src/media/ffmpeg.mjs';
kaipian.get('/ffmpeg', async (_req, res, next) => { try { res.json(await ffmpegCaps()); } catch (e) { next(e); } });
kaipian.get('/ffmpeg/install', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const ac = new AbortController(); req.on('close', () => ac.abort());
  try { send('done', await installFfmpeg({ signal: ac.signal, onLog: (m) => send('log', { m }), onProgress: (p) => send('progress', p) })); }
  catch (e) { send('error', { m: e.message }); }
  res.end();
});
/**
 * 项目里的文件。原来只认项目根目录和 assets/,而**每镜的画面根本不在那儿**——
 * 本机出图落在 `<项目>/work/`,检索来的素材落在 `~/.openshorts/cache/stock/`。
 * 于是第 3 屏给每镜配缩略图时全是破图(真机截图才看见:成片能放、每镜画面 404)。
 *
 * 放开这两个目录,但只按**白名单根目录 + 纯文件名**取:safe() 已经把 / 和 .. 剥掉,
 * 拼不出上跳路径;再逐个 resolve 后校验确实落在白名单根里,不给它变成任意文件读取。
 */
kaipian.get('/projects/:id/file/:name', async (req, res) => {
  const dir = projDir(req.params.id);
  const name = safe(req.params.name);
  let stockDir = null;
  try { ({ cacheDir: stockDir } = await import('../src/sources/stock.mjs')); stockDir = stockDir(); } catch { /* 没装/没缓存 */ }
  const roots = [dir, path.join(dir, 'assets'), path.join(dir, 'work'), ...(stockDir ? [stockDir] : [])];
  for (const root0 of roots) {
    const f = path.resolve(root0, name);
    // dotfiles:'allow' 不能省:素材缓存在 `~/.openshorts/cache/stock`,路径里有 `.openshorts`
    // 这个点开头的目录段,而 sendFile 默认 dotfiles:'ignore' 会把整条路径当 dotfile 直接 404——
    // 文件明明在、路由也跑到了,就是取不出来(真机上查了半天才定位到这里)。
    if (f.startsWith(path.resolve(root0) + path.sep) && fs.existsSync(f)) return res.sendFile(f, { dotfiles: 'allow' });
  }
  return res.status(404).end();
});
kaipian.get('/ao-status', (_req, res) => {
  let keys = {}; try { keys = JSON.parse(fs.readFileSync(path.join(aoHome(), '.local', 'web-keys.json'), 'utf-8')); } catch { /* none */ }
  const envs = ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'AGNES_API_KEY', 'APIMART_API_KEY', 'ARK_API_KEY', 'MOONSHOT_API_KEY', 'ZHIPU_API_KEY'].filter((k) => !!process.env[k] && !isEnvAppliedByUs(k));   // 我们自己映射进去的不算"来自环境变量"，它已经列在 saved 里了
  const saved = Object.keys(keys).filter((k) => keys[k]?.apiKey);
  res.json({ hasTextKey: saved.length > 0 || envs.length > 0, saved, envs, aoHome: aoHome(), home: os.homedir() });
});

// ───────────── AI 短剧线（复用 AO 短剧流水线；AO 以子进程跑，stdout 逐行转 SSE） ─────────────
import { spawn } from 'node:child_process';
import { aoResultToProject } from '../src/core/ao-result.mjs';
import { listDramaRuns, pickFreshRunDir } from './lib/ao-run-dir.mjs';
// OPENSHORTS_AO_DIR：指向本地 AO 检出（改工作流 / 技能时不用先发 npm 再验）；不设就用 node_modules 里那份
function aoCli() { const dir = process.env.OPENSHORTS_AO_DIR ? path.resolve(process.env.OPENSHORTS_AO_DIR) : path.resolve(path.dirname(fileURLToPath(import.meta.resolve('agency-orchestrator'))), '..'); return { dir, cli: path.join(dir, 'dist', 'cli.js'), wf: path.join(dir, 'workflows', '短剧流水线.yaml') }; }
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
// 透传给 AO 命令行的值不能以 - 开头：spawn 数组形式没有 shell 注入，但一个 `--` 开头的值
// 会被 AO 的参数解析器当成新开关（provider=--resume 之类）。供应商/模型 id 从来不长这样。
const flagVal = (v) => { const s = String(v ?? '').trim(); return s && !s.startsWith('-') ? s : null; };
// 反馈是自由文本："-镜头太暗"、"——去掉字幕"都是正常人话，不能按 flagVal 一刀切拦掉
// （拦掉的话重出照样跑、钱照样花，就是没带意见——用户拿回一条一样烂的片还以为改了）。
// 只拦"整个值就是一个开关"的形状（--resume 之类），那才是真正的注入口。
const feedbackVal = (v) => { const s = String(v ?? '').trim(); return s && !/^--?[a-zA-Z][a-zA-Z0-9-]*$/.test(s) ? s : null; };
/** AO 子进程跑一条只读命令（doctor/plan），异步收集输出。以前用 spawnSync——express 是单线程，
 *  同步 spawn 会把 event loop 卡住几秒，正在跑的出片 SSE 和整个界面一起冻结。 */
const runAoCapture = (args) => new Promise((resolve) => {
  const child = spawn(process.execPath, args, { env: { ...process.env, AO_NO_MODEL_HINT: '1' } });
  let out = '';
  for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { out += d.toString(); });
  child.on('close', (status) => resolve({ status, out }));
  child.on('error', (e) => resolve({ status: -1, out: String(e.message) }));
});
async function aoProviders() {
  // AO 的 exports 只暴露主入口；按绝对路径 import 同目录文件绕过白名单（同一份 dist，不会漂）
  const api = await importAo('connectors', 'api-providers.js');
  const local = await importAo('connectors', 'local-sdcpp.js').catch(() => null);
  let keys = {}; try { keys = JSON.parse(fs.readFileSync(path.join(aoHome(), '.local', 'web-keys.json'), 'utf-8')); } catch { /* none */ }
  const hasKey = (p) => !!(keys[p.id]?.apiKey || process.env[p.envKey]);
  const localStatus = local?.localSdcppStatus ? local.localSdcppStatus() : null;
  const video = (api.VIDEO_PROVIDERS ?? []).map((v) => ({ id: v.id, shape: v.shape, hasKey: v.shape === 'local' ? !!localStatus?.ok : hasKey(v), models: (v.models ?? []).map((m) => ({ id: m.id, resolutions: m.resolutions ?? [], durations: m.durations ?? [], ratios: m.ratios ?? [] })) }));
  const KNOWN_IMAGE = { agnes: ['agnes-image-2.0-flash', 'agnes-image-2.1-flash'], volcengine: ['doubao-seedream-5-0-260128'], 'volcengine-plan': ['doubao-seedream-5.0-lite'], lanox: ['gpt-image-2'], apimart: ['gpt-image-2'], openai: ['gpt-image-2'] };
  const image = (api.API_PROVIDERS ?? []).filter((p) => hasKey(p)).map((p) => ({ id: p.id, hasKey: true, models: KNOWN_IMAGE[p.id] ?? [] }));
  return { video, image, localStatus };
}
kaipian.get('/drama/providers', async (_req, res, next) => { try { res.json(await aoProviders()); } catch (e) { next(e); } });
// doctor 结果缓存 60s：界面的 refresh() 有十来个调用点（挂载/存 key/每次跑完），
// 每次都 spawn 一个 Node 跑 ao doctor——出片进行中还在跟渲染抢 CPU，而这个状态
// 只有装了新东西才会变
let optionsCache = null;
kaipian.get('/drama/options', async (_req, res) => {
  if (optionsCache && Date.now() - optionsCache.at < 60_000) return res.json(optionsCache.data);
  const { cli } = aoCli();
  const { out } = await runAoCapture([cli, 'doctor', '--no-probe']);
  const localReady = /本地出片可用/.test(out);
  const cloud = (out.match(/文生视频可用（type: video）：([^（\n]+)/) || [])[1]?.split(/,\s*/).map((s) => s.trim()).filter(Boolean) ?? [];
  const data = { tiers: TIERS, localReady, cloudProviders: cloud, doctor: out.split('\n').filter((l) => /本地出片|文生视频|出图/.test(l)) };
  optionsCache = { at: Date.now(), data };
  res.json(data);
});
kaipian.post('/drama/preflight', async (req, res) => {
  const inputs = dramaInputs(req.body ?? {});
  if (!inputs.story) return res.status(400).json({ error: tt(reqLang(req))('请输入故事', 'Enter a story') });
  const { cli, wf } = aoCli();
  const { status, out } = await runAoCapture([cli, 'plan', wf, ...inputArgs(inputs)]);
  const lines = out.split('\n').map((l) => l.trim()).filter((l) => /^(🎬|🎨|🎙|🎞|·|合计)/.test(l));
  res.json({ inputs, lines, ok: status === 0, raw: status !== 0 ? out.slice(-400) : undefined });
});
// 短剧按秒真花钱，且两个 AO 进程会写同一个 project.json / assets/——全局同时只允许一条在跑。
// （口播线的锁按项目分（hub 里 koubo:<id>）；短剧的产物目录在跑完前不知道 id，只能全局单飞，key 固定 'drama'。）
let dramaChild = null;

/** 手上还有没有在跑的活。桌面版退出前要问一句——关窗就把跑了 25 分钟的本地短剧、
 *  或正在按秒计费的云端任务无声杀掉，是最不能接受的那种"静默丢东西"。 */
export function kaipianBusy() {
  // scripting：正在写脚本的任务数（new:*）——退出会把它杀掉，虽然不花钱，也该告诉用户
  return { koubo: hub.runningKeys().filter((k) => k.startsWith('koubo:')).map((k) => k.slice(6)), drama: hub.isRunning('drama'), scripting: hub.runningKeys().filter((k) => k.startsWith('new:')).length };
}
/**
 * 服务要退出了：把手上的活全停掉。口播线走各自的 AbortController（ffmpeg / sd-cli 都认 signal），
 * 短剧线整组杀 AO。不做这一步的话进程退了、ffmpeg 还在后台跑完整条——桌面版退出对话框写的
 * "退出会杀掉本地引擎"就是空话（真机坐实过：SIGTERM 后 ffmpeg ppid 变 1）。
 */
export function kaipianShutdown() {
  const koubo = hub.runningKeys().filter((k) => k.startsWith('koubo:')).map((k) => k.slice(6));
  const drama = hub.isRunning('drama');
  for (const k of hub.runningKeys()) hub.cancel(k);   // 口播 abort（ffmpeg / sd-cli 认 signal）；短剧整组杀 AO
  dramaChild = null;
  return { koubo, drama };
}
/**
 * 以子进程跑 AO 并把输出转 SSE。run 和 redo 以前各复制一份这段逻辑，
 * 运行目录判定、并发锁、断连即杀改哪边都只修了一半——统一到这里。
 */
function streamAoRun({ req, res, args, runsDir, onDone, meta = {} }) {
  const before = new Set(listDramaRuns(runsDir));   // spawn 前快照，跑完取"新出现的那个"当运行目录
  // spawnTree：AO 下面还有 sd-cli / ffmpeg 孙进程，取消或服务退出时要整组杀（见 lib/proc.mjs）
  const child = spawnTree(process.execPath, args, { env: { ...process.env, AO_NO_MODEL_HINT: '1', AO_NO_RESUME_HINT: '1', FORCE_COLOR: '0' } });
  dramaChild = child;
  // 任务挂在 hub 上而不是这条连接上：短剧一跑 25 分钟还按秒计费，页面刷新不能把它杀了。取消只认 POST /drama/cancel
  const job = hub.start('drama', { cancel: () => killTree(child), meta });
  let buf = ''; let runDir = ''; const tail = [];   // 最近的原始行：失败时要拿它说清原因
  const onLine = (line) => {
    const clean = line.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '').trim(); if (!clean) return;
    tail.push(clean); if (tail.length > 12) tail.shift();
    const m = clean.match(/详细输出:\s*(.+)$/); if (m) runDir = m[1].trim();
    if (/^(──|🎬|🎨|🎞|⚠️|⟳|✅|❌|完成|失败|部分失败|🖥|💰|·|🎙|✎)/.test(clean) || /验收|重出|素材|镜头|恢复自|跳过已完成/.test(clean)) hub.emit(job, 'log', { m: clean.slice(0, 300) });
  };
  for (const st of [child.stdout, child.stderr]) st.on('data', (d) => { buf += d.toString(); const parts = buf.split('\n'); buf = parts.pop(); parts.forEach(onLine); });
  // spawn 本身失败（EMFILE/EAGAIN 等）只发 'error' 不发 'close'：不接的话任务永远"在跑"，
  // 之后每次出短剧都 409，直到重启服务
  child.on('error', (e) => { dramaChild = null; hub.finish(job, 'error', { m: `引擎进程起不来：${e.message}` }); });
  child.on('close', (code) => {
    dramaChild = null;
    if (buf) onLine(buf);
    // 非 0 退出（中断/失败）不回填：否则会拿半截的运行目录覆盖项目。
    // 但原因必须带出来——AO 报"缺少必填输入 image_model"这种一句话能解决的事，
    // 以前用户只看得到"退出码 1"
    if (code !== 0) {
      const why = tail.filter((l) => /错误|Error|缺少|失败|❌/.test(l)).slice(-2).join('；') || tail.slice(-2).join('；');
      return hub.finish(job, 'error', { m: `引擎退出码 ${code}，项目未改动${why ? `：${why.slice(0, 400)}` : ''}` });
    }
    if (!runDir) runDir = pickFreshRunDir(before, runsDir);
    try { const id = onDone(runDir); hub.finish(job, 'done', { id, code }); }
    catch (e) { hub.finish(job, 'error', { m: `${e.message}（退出码 ${code}）` }); }
  });
  hub.attach(job, req, res);
}
// 短剧全局只有一条：接着看 / 状态 / 取消
kaipian.get('/drama/events', (req, res) => {
  const job = hub.get('drama');
  if (!job) return res.status(404).json({ error: tt(reqLang(req))('没有在跑的短剧，也没有上一次的记录', 'No mini-drama is running and there is no previous run to show') });
  hub.attach(job, req, res);
});
kaipian.get('/drama/status', (_req, res) => res.json(hub.status('drama')));
kaipian.post('/drama/cancel', (req, res) => {
  if (!hub.cancel('drama')) return res.status(404).json({ error: tt(reqLang(req))('没有在跑的短剧', 'No mini-drama is running') });
  res.json({ ok: true });
});
kaipian.get('/drama/run', (req, res) => {
  const q = req.query; const inputs = dramaInputs(q);
  if (!inputs.story) return res.status(400).json({ error: tt(reqLang(req))('请输入故事', 'Enter a story') });
  // 工作流里 image_model 是必填无默认（定妆图用）：这里不拦的话 AO 会在 spawn 后立刻退出码 1
  if (!inputs.image_model) return res.status(400).json({ error: tt(reqLang(req))('请选择定妆图的图片模型（image_model）——界面在「画面来源」里选，API 传 image_provider / image_model', 'Pick an image model for the character sheet (image_model) — in the UI it is under "Visual sources"; over the API pass image_provider / image_model') });
  if (hub.isRunning('drama')) { if (req.headers['last-event-id']) return hub.attach(hub.get('drama'), req, res); return res.status(409).json({ error: tt(reqLang(req))('已有一条短剧在跑（按秒计费，不允许并行）——等它跑完，或先取消', 'A mini-drama is already running (billed per second, no parallel runs) — wait for it, or cancel it first') }); }
  const { cli, wf } = aoCli(); const cfg = readConfig();
  const runsDir = path.join(cfg.outputDir, '.ao-runs'); fs.mkdirSync(runsDir, { recursive: true });
  const args = [cli, 'run', wf, '--output', runsDir, ...inputArgs(inputs)];
  const pv = flagVal(q.provider); if (pv) args.push('--provider', pv);
  const md = flagVal(q.model); if (md) args.push('--model', md);
  const vp = flagVal(q.verify_provider); if (vp) args.push('--verify-provider', vp, '--verify-model', flagVal(q.verify_model) ?? '');
  // 文本供应商要记进项目：redo 不带它的话会回落到工作流默认的 deepseek——
  // 用户用 agnes 跑通的项目，一点"重出这镜"就报"deepseek 没配 key"（真机撞过）
  streamAoRun({ req, res, args, runsDir, meta: { kind: 'run' }, onDone: (runDir) => finishDramaRun({ runDir, inputs, tier: q.tier || 'cloud', llm: pv ? { provider: pv, model: md || '' } : null }) });
});

/** AO 运行目录 → 项目（新建或覆盖同 id）：回填 shots/验收、按输入标来源、拷贝 assets、记住 aoRun 供 resume。 */
function finishDramaRun({ runDir, inputs, tier, existingId, shotSources, llm = null }) {
  // runDir 由调用方确定（stdout 刮到的，或 spawn 后新出现的目录）。确定不了就报错，
  // 绝不猜"最新的那个"——resume 时最新的就是上一次自己，旧产物会被当成新成片报成功
  if (!runDir) throw new Error('没有从引擎输出里识别出本次运行目录（可能引擎输出格式变了），项目未改动');
  if (!fs.existsSync(path.join(runDir, 'metadata.json'))) throw new Error(`运行目录里没有 metadata.json（${runDir}），项目未改动`);
  const meta = JSON.parse(fs.readFileSync(path.join(runDir, 'metadata.json'), 'utf-8'));
  const tpl = JSON.parse(fs.readFileSync(path.join(root, 'templates', 'ai-drama.template.json'), 'utf-8'));
  const id = existingId || safe(`短剧-${inputs.story.slice(0, 16)}-${new Date().toISOString().slice(5, 16).replace(/[:T]/g, '')}`);
  const project = aoResultToProject(meta, tpl, { id, assetsBase: 'assets' });
  project.line = 'drama'; project.title = inputs.story.slice(0, 30); project.topic = inputs.story; project.inputs = inputs; project.tier = tier; project.shotSources = shotSources ?? {};
  if (llm) project.llm = llm;
  // 每镜的提示词与全片的氛围锁定块回填进项目：界面能看、能复制去别的模型抽卡——
  // 这是 ai-shortfilm-prompts 五段式进短剧线的可见面；老运行目录没有这些文件就是 null
  const atmosphere = readStepOutput(runDir, 'atmosphere_lock'); if (atmosphere) project.atmosphere = atmosphere;
  for (const s of project.shots) {
    const prompt = readStepOutput(runDir, `${s.id}_prompt`); if (prompt) s.visual.prompt = prompt;
    const ov = shotSources?.[s.id];
    const vp = ov?.video_provider ?? inputs.video_provider, vm = ov?.video_model ?? inputs.video_model;
    s.visual.provider = s.kind === 'video' ? vp : inputs.image_provider || null; s.visual.model = s.kind === 'video' ? vm : inputs.image_model || null;
    s.visual.source = s.kind === 'video' && vp === 'local-sdcpp' ? 'local' : 'cloud';
  }
  const dir = projDir(id); fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  // AO 在 script 步就失败时不会有 assets/——别在这儿甩 ENOENT
  const srcAssets = path.join(runDir, 'assets');
  if (fs.existsSync(srcAssets)) for (const f of fs.readdirSync(srcAssets)) fs.copyFileSync(path.join(srcAssets, f), path.join(dir, 'assets', f));
  project.final = project.final ? { file: path.join(dir, project.final.file), aoRun: runDir, notes: [] } : { file: null, aoRun: runDir, notes: ['本次运行没有成片'] };
  project.shots.forEach((s) => { s.visual.file = path.join(dir, s.visual.file); });
  // 保留上次的镜头级来源记录（未重出的镜头沿用）
  if (existingId) { try { const prev = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf-8')); project.redoHistory = [...(prev.redoHistory ?? []), { at: new Date().toISOString(), aoRun: runDir }]; } catch { /* first */ } }
  writeJsonAtomic(path.join(dir, 'project.json'), project);
  return id;
}

// 单镜重出：AO --resume <上次运行> --from <镜头> [--feedback 意见] [-i video_provider=…]（换来源）。
// 下游（合成）会自动跟着重跑；上游（剧本/定妆图/其他镜头）原样复用，不再花钱。
kaipian.get('/projects/:id/drama/redo', (req, res) => {
  const f = path.join(projDir(req.params.id), 'project.json'); if (!fs.existsSync(f)) return res.status(404).json({ error: tt(reqLang(req))('项目不存在', 'No such project') });
  const prev = JSON.parse(fs.readFileSync(f, 'utf-8')); const q = req.query;
  const shot = String(q.shot || ''); if (!/^(shot[123]|character)$/.test(shot)) return res.status(400).json({ error: tt(reqLang(req))('只能重出 character / shot1 / shot2 / shot3', 'Only character / shot1 / shot2 / shot3 can be redone') });
  if (!prev.final?.aoRun || !fs.existsSync(prev.final.aoRun)) return res.status(409).json({ error: tt(reqLang(req))('找不到上次的 AO 运行目录，无法续跑（可能被清理了）', 'Cannot find the previous engine run directory, so there is nothing to resume from (it may have been cleaned up)') });
  if (hub.isRunning('drama')) { if (req.headers['last-event-id']) return hub.attach(hub.get('drama'), req, res); return res.status(409).json({ error: tt(reqLang(req))('已有一条短剧在跑（按秒计费，不允许并行）——等它跑完，或先取消', 'A mini-drama is already running (billed per second, no parallel runs) — wait for it, or cancel it first') }); }
  const { cli, wf } = aoCli(); const cfg = readConfig(); const runsDir = path.join(cfg.outputDir, '.ao-runs');
  // 换来源：本镜的 tier 覆盖只影响这次 -i；记进 shotSources 让标注正确
  const inputs = { ...prev.inputs };
  const shotSources = {};
  if (q.tier === 'local') { Object.assign(inputs, { video_provider: TIERS.local.video_provider, video_model: TIERS.local.video_model, video_resolution: inputs.video_ratio === '9:16' ? '384x640' : '640x384', video_duration: TIERS.local.video_duration }); }
  else if (q.tier === 'cloud') { for (const k of ['video_provider', 'video_model', 'video_resolution', 'video_duration']) { const v = flagVal(q[k]); if (v) inputs[k] = v; } }
  shotSources[shot] = { video_provider: inputs.video_provider, video_model: inputs.video_model };
  const args = [cli, 'run', wf, '--output', runsDir, '--resume', prev.final.aoRun, '--from', shot, ...inputArgs(inputs)];
  // 文本供应商沿用首跑存的（q 可覆盖）：不带的话 AO 回落到工作流默认的 deepseek，
  // 用 agnes 跑通的项目一点重出就报"deepseek 没配 key"（真机撞过）
  const pv = flagVal(q.provider) ?? prev.llm?.provider; if (pv) args.push('--provider', pv);
  const md = flagVal(q.model) ?? prev.llm?.model; if (md) args.push('--model', md);
  const fb = feedbackVal(q.feedback); if (fb) args.push('--feedback', fb);
  const vp = flagVal(q.verify_provider); if (vp) args.push('--verify-provider', vp, '--verify-model', flagVal(q.verify_model) ?? '');
  streamAoRun({ req, res, args, runsDir, meta: { kind: 'redo', projectId: prev.id, shot }, onDone: (runDir) => finishDramaRun({ runDir, inputs: prev.inputs, tier: prev.tier, existingId: prev.id, shotSources: { ...(prev.shotSources ?? {}), ...shotSources }, llm: pv ? { provider: pv, model: md || '' } : prev.llm ?? null }) });
});

// ───────────── 本地生成：状态 / 安装 sd-cli / 下载模型（SSE 进度；下载前必须确认许可证） ─────────────
import { downloadWithResume, pickSdcppAsset, hfExpectedSha256 } from '../src/local/download.mjs';
const HF = 'https://huggingface.co/unsloth/MiniMax-H3-GGUF/resolve/main';
const MODEL_FILES = (m) => [[m.diffusion, `${HF}/${m.diffusion}`], [m.llm, `${HF}/${m.llm}`], ['minimax_h3_video_vae_fp16.safetensors', `${HF}/vae/minimax_h3_video_vae_fp16.safetensors`], ['minimax_h3_audio_vae_fp32.safetensors', `${HF}/vae/minimax_h3_audio_vae_fp32.safetensors`]];
async function localModule() { return importAo('connectors', 'local-sdcpp.js'); }
kaipian.get('/local/status', async (_req, res, next) => { try { const m = await localModule(); res.json({ ...m.localSdcppStatus(), catalog: m.LOCAL_MODELS, license: 'MiniMax-H3 Community License（含适用地域与用途限制）：https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE' }); } catch (e) { next(e); } });
kaipian.get('/local/install', async (req, res) => {
  const q = req.query; const what = String(q.what || ''); const modelId = String(q.model || 'minimax-h3-q2');
  if (q.agree !== '1') return res.status(400).json({ error: tt(reqLang(req))('下载前需确认已阅读 MiniMax-H3 Community License 与 stable-diffusion.cpp 的 MIT 许可', 'Confirm you have read the MiniMax-H3 Community License and the MIT license of stable-diffusion.cpp before downloading') });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const ac = new AbortController(); req.on('close', () => ac.abort());
  try {
    const m = await localModule(); const { cli, modelsDir } = m.sdcppPaths();
    if (what === 'sdcli' || what === 'all') {
      // 走跟 CLI 同一份逻辑：会按本机 macOS 版本挑跑得动的包，并在装完当场验一次
      const { installSdCli } = await import('../src/local/sd-image.mjs');
      await installSdCli({ signal: ac.signal, onLog: (msg) => send('log', { m: msg }), onProgress: (p) => send('progress', p) });
    }
    if (what === 'model' || what === 'all') {
      const cat = m.LOCAL_MODELS.find((x) => x.id === modelId); if (!cat) throw new Error(`未知档位 ${modelId}`);
      for (const [name, url] of MODEL_FILES(cat)) {
        const expected = await hfExpectedSha256(url, { signal: ac.signal });
        if (!expected) send('log', { m: `（${name} 拿不到官方 sha256，本次不校验）` });
        send('log', { m: `下载 ${name}` });
        await downloadWithResume(url, path.join(modelsDir, name), { signal: ac.signal, expectedSha256: expected, onProgress: (p) => send('progress', { file: name, ...p }) });
      }
      send('log', { m: `模型就绪：${modelsDir}` });
    }
    send('done', m.localSdcppStatus());
  } catch (e) { send('error', { m: e.message }); }
  res.end();
});
// 链接 → 正文（口播线输入）：只抓公开页，超时 20 s，正文 ≤ 6000 字
import { fetchArticle } from '../src/input/url-text.mjs';
kaipian.post('/fetch-url', async (req, res, next) => { try { res.json(await fetchArticle(String(req.body?.url ?? '').trim(), { lang: reqLang(req) })); } catch (e) { res.status(400).json({ error: e.message }); } });

// 批量（口播线）：SSE，逐版进度；产物在 <项目>/variants/<id>/
kaipian.get('/projects/:id/batch', async (req, res) => {
  const id = safe(req.params.id);
  const f = path.join(projDir(id), 'project.json'); if (!fs.existsSync(f)) return res.status(404).json({ error: tt(reqLang(req))('项目不存在', 'No such project') });
  const project = JSON.parse(fs.readFileSync(f, 'utf-8')); const T = tt(normLang(project.lang)); if (project.line !== 'koubo') return res.status(400).json({ error: T('批量目前只支持口播线', 'Batch versions are only supported on the talking-head line') });
  if (hub.isRunning(kKey(id))) {
    if (req.headers['last-event-id']) return hub.attach(hub.get(kKey(id)), req, res);
    return res.status(409).json({ error: T('这个项目正在出片，等它跑完或先取消', 'This project is already rendering — wait for it to finish, or cancel it first') });
  }
  const split = (x) => (x ? String(x).split(',').map((t) => t.trim()).filter(Boolean) : []);
  const variants = planVariants({ voices: split(req.query.voices), captions: split(req.query.captions), rates: split(req.query.rates).map(Number) }, project);
  if (variants.length > 12) return res.status(400).json({ error: T('一次最多 12 版', 'At most 12 versions at a time') });
  const ac = new AbortController();
  const job = hub.start(kKey(id), { cancel: () => ac.abort(), meta: { kind: 'batch', variants: variants.length } });
  hub.emit(job, 'plan', { variants });
  (async () => {
    try { const results = await _pipeline.runBatch(project, variants, { baseDir: path.dirname(f), log: (m) => hub.emit(job, 'log', { m }), onVariant: (r) => hub.emit(job, 'variant', r), vision: readConfig().vision, signal: ac.signal }); hub.finish(job, 'done', { results }); }
    catch (e) { hub.finish(job, 'error', { m: e.message }); }
  })();
  hub.attach(job, req, res);
});

// 发布包：/projects/:id/publish-pack?platform=douyin → 目录 + zip（不自动发布）
import { makePublishPack, PLATFORMS } from '../src/publish/pack.mjs';
kaipian.get('/platforms', (_req, res) => res.json(PLATFORMS));
kaipian.post('/projects/:id/publish-pack', (req, res) => {
  const f = path.join(projDir(req.params.id), 'project.json'); if (!fs.existsSync(f)) return res.status(404).json({ error: tt(reqLang(req))('项目不存在', 'No such project') });
  try { const r = makePublishPack(JSON.parse(fs.readFileSync(f, 'utf-8')), { platform: req.body?.platform || 'douyin' }); res.json({ ...r, zipName: r.zip ? path.basename(r.zip) : null }); } catch (e) { res.status(400).json({ error: e.message }); }
});

kaipian.get('/projects/:id/variant/:vid', (req, res) => {
  const dir = path.join(projDir(req.params.id), 'variants', safe(req.params.vid)); if (!fs.existsSync(dir)) return res.status(404).end();
  const mp4 = fs.readdirSync(dir).find((f) => f.endsWith('.mp4')); if (!mp4) return res.status(404).end();
  res.download(path.join(dir, mp4));
});
