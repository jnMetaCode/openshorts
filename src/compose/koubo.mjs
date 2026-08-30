/**
 * 口播线合成（架构 §4）：每段 = 画面（裁到 9:16、裁到配音时长）+ 配音 → 拼接 → 字幕（libass 有就烧、没有挂软轨）→ BGM ducking → 1080×1920。
 * 只用本机 ffmpeg；每一步失败都报清楚是哪一段。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ffmpegPath, ffprobePath } from '../media/ffmpeg.mjs';
const run = promisify(execFile);
const FFMPEG = ffmpegPath;
const FFPROBE = ffprobePath;

async function ff(args, label, signal) {
  try { return await run(FFMPEG(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 64 << 20, signal }); }
  catch (e) { const err = e; if (err.name === 'AbortError' || signal?.aborted) throw new Error('已取消'); if (err.code === 'ENOENT') throw new Error('找不到 ffmpeg：跑 `openshorts install-ffmpeg` 装一份带 libass 的（约 40 MB，只装到 ~/.openshorts/bin），或自行安装后设 OPENSHORTS_FFMPEG'); throw new Error(`${label} 失败：${String(err.stderr || err.message).split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 300)}`); }
}
export async function probeDuration(file) {
  const r = await run(FFPROBE(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const n = Number(String(r.stdout).trim().split(/[\r\n,]/)[0]); return Number.isFinite(n) ? n : 0;
}
// 按二进制路径缓存：装完 `install-ffmpeg` 后 ffmpegPath() 会变，同一进程里不能再用旧结论
const _filters = new Map();
export async function hasFilter(name) {
  const bin = FFMPEG();
  if (!_filters.has(bin)) { try { const r = await run(bin, ['-hide_banner', '-filters']); _filters.set(bin, new Set(String(r.stdout).split('\n').map((l) => l.trim().split(/\s+/)[1]).filter(Boolean))); } catch { _filters.set(bin, new Set()); } }
  return _filters.get(bin).has(name);
}

/**
 * 一段：把素材裁成 w×h、时长 = 配音时长（素材短了就循环补足），配音铺上去。
 *
 * 画面滤镜必须写在 -filter_complex 里，不能用 -vf：两者同时出现时 ffmpeg 6.x 会**静默**丢掉音频
 * （输出里 audio 流声明还在，实际 0 个包，退出码 0，一句警告都没有）。Ubuntu 24.04 / Debian 12
 * 默认就是 6.x，等于整条片没声音还查不出来。ffmpeg 8 上恰好正常，所以只在别人机器上炸——真机踩到的。
 * -t 已经框死时长，-shortest 也就不需要了。
 */
export async function renderSegment({ clip, audio, durationSec, w = 1080, h = 1920, fps = 30, out, clipVolume = 0, signal }) {
  const vchain = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps},format=yuv420p[v]`;
  const achain = clipVolume > 0 ? `[0:a]volume=${clipVolume}[c];[1:a][c]amix=inputs=2:duration=first[a]` : `[1:a]anull[a]`;
  const args = ['-stream_loop', '-1', '-i', clip, '-i', audio, '-t', String(durationSec),
    '-filter_complex', `${vchain};${achain}`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', out];
  await ff(args, `渲染分段 ${path.basename(out)}`, signal);
  // 出过"退出码 0 但没有声音"的事，所以这里当场验一次，别让无声片一路跑到成片
  const packets = await audioPackets(out);
  if (!packets) throw new Error(`渲染分段 ${path.basename(out)} 出来没有声音（ffmpeg ${await ffVersion()} 可能不吃这套参数），请提 issue 附上这行`);
  return out;
}

/** 音频包数（0 = 这段是哑的） */
export async function audioPackets(file) {
  try { const r = await run(FFPROBE(), ['-v', 'error', '-select_streams', 'a', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file]); return Number(String(r.stdout).trim().split(/[\r\n,]/)[0]) || 0; }
  catch { return 0; }
}
async function ffVersion() { try { return String((await run(FFMPEG(), ['-version'])).stdout).split('\n')[0].replace(/^ffmpeg version /, '').split(' ')[0]; } catch { return '?'; } }

export async function concatSegments(files, out, { signal } = {}) {
  const list = out + '.txt';
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], '拼接', signal);
  fs.rmSync(list, { force: true });
  return out;
}

/** 字幕 + BGM + AI 标识角标；libass 缺失 → 软字幕轨并返回 note */
export async function finalize({ video, ass, srt, bgm, bgmVolume = 0.2, aiLabel = true, out, w = 1080, h = 1920, signal }) {
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
  else if (ass) notes.push('这台 ffmpeg 没有 libass（subtitles 滤镜），字幕只能挂软轨——抖音/视频号上传会丢掉它，纯色底的镜头会是一块空屏。跑 `openshorts install-ffmpeg` 装一份带 libass 的再重出（Homebrew 的 ffmpeg 已不含 libass，重装它没用）');
  // 角标也按宽度缩放（和字幕同一套 1080 基准），否则 540 宽的项目上会显得很大
  const k = w / 1080; const px = (n) => Math.max(1, Math.round(n * k));
  if (aiLabel && (await hasFilter('drawtext'))) { fc.push(`${v.startsWith('[') ? v : '[0:v]'}drawtext=text='AI 生成':fontsize=${px(28)}:fontcolor=white@0.7:x=w-tw-${px(36)}:y=${px(36)}[lv]`); v = '[lv]'; }
  else if (aiLabel) notes.push('ffmpeg 缺 drawtext，AI 标识只写入文件元数据（未叠加角标）；`openshorts install-ffmpeg` 可一并解决');
  const args = [...inputs];
  if (srt && !canBurn) args.push('-i', srt);
  if (fc.length) args.push('-filter_complex', fc.join(';'));
  args.push('-map', v, '-map', a);
  if (srt && !canBurn) args.push('-map', `${bgm ? 2 : 1}:0`, '-c:s', 'mov_text', '-metadata:s:s:0', 'language=chi');
  args.push('-metadata', 'comment=Generated with OpenShorts; contains AI-generated content', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out);
  await ff(args, '成片合成', signal);
  return { out, notes };
}
