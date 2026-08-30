/**
 * 口播线合成（架构 §4）：每段 = 画面（裁到 9:16、裁到配音时长）+ 配音 → 拼接 → 字幕（libass 有就烧、没有挂软轨）→ BGM ducking → 1080×1920。
 * 只用本机 ffmpeg；每一步失败都报清楚是哪一段。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const FFMPEG = () => process.env.AO_FFMPEG || process.env.OPENSHORTS_FFMPEG || 'ffmpeg';
const FFPROBE = () => process.env.AO_FFPROBE || process.env.OPENSHORTS_FFPROBE || (FFMPEG().replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1'));

async function ff(args, label) {
  try { return await run(FFMPEG(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 64 << 20 }); }
  catch (e) { const err = e; if (err.code === 'ENOENT') throw new Error('找不到 ffmpeg：macOS `brew install ffmpeg`，Windows `winget install ffmpeg`，或设 OPENSHORTS_FFMPEG'); throw new Error(`${label} 失败：${String(err.stderr || err.message).split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 300)}`); }
}
export async function probeDuration(file) {
  const r = await run(FFPROBE(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const n = Number(String(r.stdout).trim().split(/[\r\n,]/)[0]); return Number.isFinite(n) ? n : 0;
}
let _filters = null;
export async function hasFilter(name) {
  if (!_filters) { try { const r = await run(FFMPEG(), ['-hide_banner', '-filters']); _filters = new Set(String(r.stdout).split('\n').map((l) => l.trim().split(/\s+/)[1]).filter(Boolean)); } catch { _filters = new Set(); } }
  return _filters.has(name);
}

/** 一段：把素材裁成 w×h、时长 = 配音时长（素材短了就循环补足），配音铺上去 */
export async function renderSegment({ clip, audio, durationSec, w = 1080, h = 1920, fps = 30, out, clipVolume = 0 }) {
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps},format=yuv420p`;
  const args = ['-stream_loop', '-1', '-i', clip, '-i', audio, '-t', String(durationSec), '-vf', vf,
    '-filter_complex', clipVolume > 0 ? `[0:a]volume=${clipVolume}[c];[1:a][c]amix=inputs=2:duration=first[a]` : `[1:a]anull[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-shortest', out];
  await ff(args, `渲染分段 ${path.basename(out)}`);
  return out;
}

export async function concatSegments(files, out) {
  const list = out + '.txt';
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], '拼接');
  fs.rmSync(list, { force: true });
  return out;
}

/** 字幕 + BGM + AI 标识角标；libass 缺失 → 软字幕轨并返回 note */
export async function finalize({ video, ass, srt, bgm, bgmVolume = 0.2, aiLabel = true, out, w = 1080, h = 1920 }) {
  const notes = [];
  const canBurn = ass && (await hasFilter('subtitles'));
  const inputs = ['-i', video]; const fc = [];
  // 直接映射流写 0:v / 0:a；经过 filter_complex 的才用 [label]——`-map [0:a]` 会被 ffmpeg 当非法参数拒掉
  let v = '0:v', a = '0:a';
  // 响度归一化到 -16 LUFS（抖音/视频号口播常用；Edge TTS 原始约 -23，质检真机抓到的）。有 BGM 先混再归一。
  const norm = 'loudnorm=I=-16:TP=-1.5:LRA=11';
  if (bgm && fs.existsSync(bgm)) { inputs.push('-stream_loop', '-1', '-i', bgm); fc.push(`[1:a]volume=${bgmVolume}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2,${norm}[am]`); a = '[am]'; }
  else { fc.push(`[0:a]${norm}[am]`); a = '[am]'; }
  if (canBurn) { fc.push(`[0:v]subtitles='${ass.replace(/'/g, "\\'").replace(/:/g, '\\:')}'[sv]`); v = '[sv]'; }
  else if (ass) notes.push('这台 ffmpeg 没有 libass（subtitles 滤镜），字幕挂为软字幕轨（播放器可开关）；要烧进画面请装带 libass 的 ffmpeg');
  if (aiLabel && (await hasFilter('drawtext'))) { fc.push(`${v.startsWith('[') ? v : '[0:v]'}drawtext=text='AI 生成':fontsize=28:fontcolor=white@0.7:x=w-tw-36:y=36[lv]`); v = '[lv]'; }
  else if (aiLabel) notes.push('ffmpeg 缺 drawtext，AI 标识只写入文件元数据（未叠加角标）');
  const args = [...inputs];
  if (srt && !canBurn) args.push('-i', srt);
  if (fc.length) args.push('-filter_complex', fc.join(';'));
  args.push('-map', v, '-map', a);
  if (srt && !canBurn) args.push('-map', `${bgm ? 2 : 1}:0`, '-c:s', 'mov_text', '-metadata:s:s:0', 'language=chi');
  args.push('-metadata', 'comment=Generated with OpenShorts; contains AI-generated content', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out);
  await ff(args, '成片合成');
  return { out, notes };
}
