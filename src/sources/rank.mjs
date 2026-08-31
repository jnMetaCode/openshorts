/**
 * 素材候选排序（架构 §3.1）：每条候选抽一帧交给能看图的模型，按"画面意图"打 0–10 分，选最贴合的；
 * 全部低于阈值 → 视为没找到（宁可纯色底也别放一段量子物理动图进猫科普）。
 * 模型来自 AO 连接器（Agnes 2.0-flash 免费可看图）；没配置 vision 时跳过排序，按检索顺序取第一条。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ffmpegPath, ffprobePath } from '../media/ffmpeg.mjs';
const run = promisify(execFile);

const FF = ffmpegPath;
const FFP = ffprobePath;

/** 素材时长（拿不到返回 0）——用来决定抽哪一帧 */
export async function clipDuration(file) {
  try { const r = await run(FFP(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]); const n = Number(String(r.stdout).trim().split(/[\r\n,]/)[0]); return Number.isFinite(n) ? n : 0; }
  catch { return 0; }
}

/**
 * 抽一帧做证据。默认抽**正片中段**而不是第 1 秒：真机踩过——一段 1920 年代动画的第 1 秒是英文标题卡，
 * 模型看到标题卡本该判 ≤2 分，但只要它是唯一候选就压根没送去打分（见 rankCandidates），于是整镜变成大写英文字幕板。
 * 抽中段既躲开片头卡，也更能代表这条素材真正的画面。
 */
export async function frameOf(file, atSec = null) {
  const at = atSec ?? (await clipDuration(file)) * 0.5;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-frame-'));
  const out = path.join(dir, 'f.jpg');
  const shot = async (t) => run(FF(), ['-hide_banner', '-loglevel', 'error', '-y', ...(t > 0.05 ? ['-ss', String(t.toFixed ? t.toFixed(2) : t)] : []), '-i', file, '-frames:v', '1', '-vf', 'scale=512:-2', '-q:v', '5', '-update', '1', out]);
  try {
    try { await shot(at); } catch { /* 定位失败（素材比 at 短 / 关键帧稀疏）→ 从头抽 */ }
    if (!fs.existsSync(out) || !fs.statSync(out).size) await shot(0);
    const b = fs.readFileSync(out);
    return `data:image/jpeg;base64,${b.toString('base64')}`;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/**
 * 候选的"证据帧"：优先用来源自带的缩略图（Wikimedia 的 seek=10 缩略图 / Pexels 的 image /
 * Pixabay 的 thumbnail），几十 KB 就够看清主体是什么；只有没有缩略图的候选才退回"下整条片再抽帧"。
 * 这一步以前是把 3 条候选全下下来再扔掉 2 条——Commons 上一条 75 秒的猫视频原文件 50 MB，
 * 6 镜就是 1 GB 起步，而我们只是要看一眼画面里是什么。
 */
export async function evidenceFrame(candidate, { fetchImpl = fetch, timeoutMs = 20_000, getFile = null } = {}) {
  if (candidate.thumb) {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetchImpl(candidate.thumb, { headers: { 'User-Agent': 'OpenShorts/2.0' }, redirect: 'follow', signal: ac.signal });
      if (r.ok) {
        const mime = String(r.headers?.get?.('content-type') || 'image/jpeg').split(';')[0];
        if (/^image\/(jpeg|png|webp|gif)$/.test(mime)) return `data:${mime};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
      }
    } catch { /* 缩略图取不到就走下面的抽帧 */ }
    finally { clearTimeout(timer); }
  }
  // 缩略图拿不到（来源没有 / 还没生成）就退回"下整条片再抽中段帧"——宁可慢一条，
  // 也不能让一条没被打分的候选混进成片（"没证据"和"判过了"是两回事）
  if (candidate.file) return frameOf(candidate.file);
  if (getFile) { const f = await getFile(candidate); if (f) return frameOf(f); }
  return null;
}

/** 解析回复里的 JSON 数组 [{i, score, why}] */
export function parseScores(text, n) {
  const m = String(text).match(/\[[\s\S]*\]/); if (!m) return null;
  try { const arr = JSON.parse(m[0]); const out = Array.from({ length: n }, (_, i) => ({ i, score: 0, why: '' })); for (const x of arr) { const i = Number(x.i ?? x.index); if (i >= 0 && i < n) out[i] = { i, score: Math.max(0, Math.min(10, Number(x.score) || 0)), why: String(x.why ?? '') }; } return out; } catch { return null; }
}

/**
 * candidates: [{ id, file }]（已 materialize）；返回按分排序的 [{ ...cand, score, why }]。
 * connector: AO 的 LLMConnector（chat(system, user, cfg)）；cfg: { provider, model, api_key? }
 */
export async function rankCandidates(candidates, intent, { connector, cfg, threshold = 4, log = () => {}, fetchImpl = fetch, getFile = null }) {
  // 只有一条候选也要过关："唯一候选"恰恰是最容易混进标题卡/无关画面的情况，
  // 以前这里直接放行，真机就漏过了一整镜英文标题卡。
  if (!connector || !candidates.length) return candidates.map((c) => ({ ...c, score: null }));
  const frames = [];
  for (const c of candidates) { try { frames.push(await evidenceFrame(c, { fetchImpl, getFile })); } catch { frames.push(null); } }
  const usable = candidates.map((c, i) => ({ c, i, f: frames[i] })).filter((x) => x.f);
  if (!usable.length) return candidates.map((c) => ({ ...c, score: null }));
  const zh = /[一-鿿]/.test(intent);
  const prompt = (zh
    ? [`你是短视频剪辑师。下面是同一段口播要配的画面意图，以及 ${usable.length} 条候选素材各一帧。给每条打分 0–10：画面主体、场景与意图是否匹配（主体对得上给 6 分起，完全无关 0–2 分，图表/文字/标题卡一律 ≤ 2）。`, `画面意图：${intent}`, ...usable.map((x, k) => `候选 ${k}：${x.f}`), '只输出 JSON 数组：[{"i":0,"score":7,"why":"一句话"}, …]']
    : [`You are a video editor. Below is the visual intent for one narration segment and one frame from each of ${usable.length} candidate clips. Score each 0–10 for how well subject/scene match the intent (subject matches → ≥6; unrelated → 0–2; charts/text/title cards ≤ 2).`, `Intent: ${intent}`, ...usable.map((x, k) => `Candidate ${k}: ${x.f}`), 'Output only a JSON array: [{"i":0,"score":7,"why":"…"}, …]']).join('\n');
  let scores = null;
  // 推理模型（Agnes 2.0-flash）会先吐几百字思考再给 JSON：预算给足；网络抖一次就再试一次
  for (let attempt = 0; attempt < 2 && !scores; attempt++) {
    try { const r = await connector.chat(zh ? '只输出一行 JSON 数组，不要解释。' : 'Output one line of JSON only.', prompt, { ...cfg, max_tokens: 1500, temperature: 0 }); scores = parseScores(r.content, usable.length); }
    catch (e) { if (attempt === 1) log(`素材排序不可用：${e.message.split('\n')[0].slice(0, 120)}`); }
  }
  if (!scores) return candidates.map((c) => ({ ...c, score: null }));
  const ranked = usable.map((x, k) => ({ ...x.c, score: scores[k].score, why: scores[k].why })).sort((a, b) => b.score - a.score);
  const rest = candidates.filter((c) => !usable.some((x) => x.c.id === c.id)).map((c) => ({ ...c, score: null, unjudged: true }));
  if (rest.length) log(`⚠️ ${rest.length} 条候选取不到画面证据，没能打分：${rest.map((c) => c.id).join('、')}`);
  return [...ranked.filter((c) => c.score >= threshold), ...rest, ...ranked.filter((c) => c.score < threshold).map((c) => ({ ...c, rejected: true }))];
}
