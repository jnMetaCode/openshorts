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
const run = promisify(execFile);

export async function frameOf(file, atSec = 1) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'os-frame-')), 'f.jpg');
  await run(process.env.OPENSHORTS_FFMPEG || process.env.AO_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(atSec), '-i', file, '-frames:v', '1', '-vf', 'scale=512:-2', '-q:v', '5', '-update', '1', out]);
  const b = fs.readFileSync(out); fs.rmSync(path.dirname(out), { recursive: true, force: true });
  return `data:image/jpeg;base64,${b.toString('base64')}`;
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
export async function rankCandidates(candidates, intent, { connector, cfg, threshold = 4, log = () => {} }) {
  if (!connector || candidates.length <= 1) return candidates.map((c) => ({ ...c, score: null }));
  const frames = [];
  for (const c of candidates) { try { frames.push(await frameOf(c.file)); } catch { frames.push(null); } }
  const usable = candidates.map((c, i) => ({ c, i, f: frames[i] })).filter((x) => x.f);
  if (!usable.length) return candidates.map((c) => ({ ...c, score: null }));
  const zh = /[一-鿿]/.test(intent);
  const prompt = (zh
    ? [`你是短视频剪辑师。下面是同一段口播要配的画面意图，以及 ${usable.length} 条候选素材各一帧。给每条打分 0–10：画面主体、场景与意图是否匹配（主体对得上给 6 分起，完全无关 0–2 分，图表/文字/标题卡一律 ≤ 2）。`, `画面意图：${intent}`, ...usable.map((x, k) => `候选 ${k}：${x.f}`), '只输出 JSON 数组：[{"i":0,"score":7,"why":"一句话"}, …]']
    : [`You are a video editor. Below is the visual intent for one narration segment and one frame from each of ${usable.length} candidate clips. Score each 0–10 for how well subject/scene match the intent (subject matches → ≥6; unrelated → 0–2; charts/text/title cards ≤ 2).`, `Intent: ${intent}`, ...usable.map((x, k) => `Candidate ${k}: ${x.f}`), 'Output only a JSON array: [{"i":0,"score":7,"why":"…"}, …]']).join('\n');
  let scores = null;
  try { const r = await connector.chat(zh ? '只输出 JSON。' : 'Output JSON only.', prompt, { ...cfg, max_tokens: 400, temperature: 0 }); scores = parseScores(r.content, usable.length); } catch (e) { log(`素材排序不可用：${e.message.split('\n')[0]}`); }
  if (!scores) return candidates.map((c) => ({ ...c, score: null }));
  const ranked = usable.map((x, k) => ({ ...x.c, score: scores[k].score, why: scores[k].why })).sort((a, b) => b.score - a.score);
  const rest = candidates.filter((c) => !usable.some((x) => x.c.id === c.id)).map((c) => ({ ...c, score: null }));
  return [...ranked.filter((c) => c.score >= threshold), ...rest, ...ranked.filter((c) => c.score < threshold).map((c) => ({ ...c, rejected: true }))];
}
