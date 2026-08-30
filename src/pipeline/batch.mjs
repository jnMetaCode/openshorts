/**
 * 批量（M3）：同一脚本 × 音色 × 字幕样式 → N 版，串行出片（本机 ffmpeg/TTS 一次一条最稳），每版独立目录。
 * 变量只改"不影响脚本"的维度（音色 / 字幕 / 语速），脚本与画面检索词共用，所以素材缓存全命中、第二版起很快。
 */
import fs from 'node:fs';
import path from 'node:path';
import { runKoubo } from './koubo-run.mjs';

export function planVariants({ voices = [], captions = [], rates = [] }, base) {
  const vs = voices.length ? voices : [base.voice?.voice ?? 'zh-CN-XiaoxiaoNeural'];
  const cs = captions.length ? captions : [base.captions?.preset ?? 'douyin'];
  const rs = rates.length ? rates : [base.voice?.rate ?? 1.0];
  const out = [];
  for (const v of vs) for (const c of cs) for (const r of rs) out.push({ id: `${v.replace(/^zh-CN-|Neural$/g, '')}-${c}${r !== 1 ? `-x${r}` : ''}`, voice: v, captions: c, rate: Number(r) });
  return out;
}

export async function runBatch(project, variants, { baseDir, log = () => {}, onVariant = () => {}, fetchImpl, config, vision } = {}) {
  const results = [];
  for (const [i, v] of variants.entries()) {
    const dir = path.join(baseDir, 'variants', v.id); fs.mkdirSync(dir, { recursive: true });
    // 深拷贝项目，只改音色/字幕/语速；清掉上次的音频与产物路径，画面选择保留（同一检索词、同一候选）
    const p = JSON.parse(JSON.stringify(project));
    p.id = `${project.id}-${v.id}`; p.voice = { ...p.voice, voice: v.voice, rate: v.rate }; p.captions = { ...p.captions, preset: v.captions };
    p.final = null; for (const s of p.shots) { s.audio = null; s.durationSec = null; s.status = 'planned'; }
    log(`▶ 版本 ${i + 1}/${variants.length}：${v.id}`);
    try { const r = await runKoubo(p, { outDir: dir, log: (m) => log(`   ${m}`), fetchImpl, config, vision }); results.push({ id: v.id, ok: true, file: r.final.file, durationSec: r.final.durationSec, quality: r.final.quality }); }
    catch (e) { results.push({ id: v.id, ok: false, error: e.message }); log(`   ⛔ ${e.message}`); }
    onVariant(results[results.length - 1]);
  }
  fs.writeFileSync(path.join(baseDir, 'variants', 'index.json'), JSON.stringify({ at: new Date().toISOString(), variants: results }, null, 2));
  return results;
}
