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

/**
 * 把路径塞进 ffmpeg **滤镜图**里（subtitles=… 这种）时的转义。
 *
 * Windows 上不转义就是死路：`C:\Users\yx\captions.ass` 进了滤镜图，`\U`、`\y` 会被滤镜解析器
 * 当成转义序列吃掉，剩下 `C:Usersyxcaptions.ass`——字幕文件找不到，整条合成失败。
 * 而 Windows 上 winget / gyan 装的 ffmpeg 都带 libass，所以这条路径一定会走到（不像 mac 那样
 * 因为没有 libass 反而绕开了）。做法是反斜杠换成正斜杠（ffmpeg 在 Windows 上认），冒号再转义。
 * POSIX 下文件名里可以合法地带反斜杠，所以只在 win32 上做这一步。
 */
export function escapeFilterPath(p, platform = process.platform) {
  const slashed = platform === 'win32' ? String(p).replace(/\\/g, '/') : String(p);
  return slashed.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

/**
 * concat 分离器的清单行。它有自己的解析器：单引号内反斜杠同样是转义符，
 * 所以 Windows 路径直接写进去也会被吃掉——同一个坑的另一半。
 */
export function concatListLine(file, platform = process.platform) {
  const p = platform === 'win32' ? String(file).replace(/\\/g, '/') : String(file);
  return `file '${p.replace(/\\/g, '\\\\').replace(/'/g, "'\\''")}'`;
}

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

/** 图片/视频的像素尺寸（拿不到返回 null） */
export async function probeSize(file) {
  try {
    const r = await run(FFPROBE(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
    const [w, h] = String(r.stdout).trim().split(/[\r\n,]/).map(Number);
    return w > 0 && h > 0 ? { w, h } : null;
  } catch { return null; }
}

/**
 * 一张图在竖屏画面里怎么摆。
 *
 * 两个极端都不行：**铺满裁切**会把主体切掉（真机：横构图的猫在纸箱里，猫脸正好裁在框外）；
 * **完整放下**又会把 3:2 的横图压成只占 37.5% 高度的一条窄带，手机上根本看不清是什么
 * （真机截图确认过）。所以取中间：允许放大到裁掉一部分宽度，好让主体做大，
 * 但**放大倍数设上限**——最多比"完整放下"再放大 maxZoom 倍（默认 1.45，即最多裁掉约 31% 宽度）。
 * 竖图 / 方图本来就能填满，不受影响。
 *
 * 竖直位置压在偏上（中心落在 42% 高度）：下面三分之一留给字幕，不让字压在主体上。
 */
export function imageLayout(iw, ih, w = 1080, h = 1920, { maxZoom = 1.45, minFill = 0.60, centerY = 0.42 } = {}) {
  const fit = Math.min(w / iw, h / ih);
  const cover = Math.max(w / iw, h / ih);
  const wanted = (minFill * h) / ih;                    // 想让高度至少占到 minFill
  const scale = Math.max(fit, Math.min(wanted, fit * maxZoom, cover));
  const sw = Math.round((iw * scale) / 2) * 2;          // 偶数，libx264 要
  const sh = Math.round((ih * scale) / 2) * 2;
  const cw = Math.min(sw, w), ch = Math.min(sh, h);
  const y = Math.max(0, Math.min(h - ch, Math.round(centerY * h - ch / 2)));
  return { scaleW: sw, scaleH: sh, cropW: cw, cropH: ch, x: Math.round((w - cw) / 2), y, fill: ch / h };
}

/**
 * 一段：把素材裁成 w×h、时长 = 配音时长（素材短了就循环补足），配音铺上去。
 *
 * 画面滤镜必须写在 -filter_complex 里，不能用 -vf：两者同时出现时 ffmpeg 6.x 会**静默**丢掉音频
 * （输出里 audio 流声明还在，实际 0 个包，退出码 0，一句警告都没有）。Ubuntu 24.04 / Debian 12
 * 默认就是 6.x，等于整条片没声音还查不出来。ffmpeg 8 上恰好正常，所以只在别人机器上炸——真机踩到的。
 * -t 已经框死时长，-shortest 也就不需要了。
 */
export async function renderSegment({ clip, audio, durationSec, w = 1080, h = 1920, fps = 30, out, clipVolume = 0, signal, kind = 'video', panReverse = false }) {
  const isImage = kind === 'image';
  // 先量一下这张图多大，取景的比例在 JS 里算好——比在滤镜表达式里推可读得多，也能单测
  const size = isImage ? await probeSize(clip) : null;
  const L = size ? imageLayout(size.w, size.h, w, h) : null;
  // 视频直接裁满屏：视频的取景本来就以主体为中心，加上画面在动，裁掉边角不碍事。
  //
  // 图片不能这么裁。真机试过：一张横构图的猫在纸箱里，裁 9:16 正好把猫脸切在框外，剩下半只身子。
  // 素材库里的照片主体在哪儿是没法预知的，所以改用短视频里常见的做法——完整图居中放，
  // 背后垫一层自己的放大虚化版：主体一定不丢，留白也不显廉价。
  //
  // 动效放在背景上：完整的前景一动就会露边，而背景怎么飘都看不出来。幅度绕中心各走 6%，
  // 方向按镜次交替，连着几镜不会像幻灯片。（用 crop 的时间表达式而不是 zoompan：
  // zoompan 的缩放按帧量化会抖，而 crop/scale/gblur/overlay 都是核心滤镜，任何构建都有。）
  const D = durationSec.toFixed(2);
  const sign = panReverse ? -1 : 1;
  const pan = (span, out) => `(${span})/2 + ${sign}*min((${span})/2, ${out}*0.06)*(2*min(1,t/${D}) - 1)`;
  const bgW = Math.round(w * 1.12); const bgH = Math.round(h * 1.12);
  const vchain = isImage
    ? `[0:v]split[bg][fg];`
      + `[bg]scale=${bgW}:${bgH}:force_original_aspect_ratio=increase,crop=${w}:${h}:x='${pan('iw-ow', 'ow')}':y='${pan('ih-oh', 'oh')}',gblur=sigma=${Math.round(w / 24)},eq=brightness=-0.08[bgb];`
      + (L
        ? `[fg]scale=${L.scaleW}:${L.scaleH},crop=${L.cropW}:${L.cropH}:${Math.round((L.scaleW - L.cropW) / 2)}:${Math.round((L.scaleH - L.cropH) / 2)}[fgs];`
        : `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgs];`)
      + `[bgb][fgs]overlay=${L ? `${L.x}:${L.y}` : '(W-w)/2:(H-h)/2'},fps=${fps},format=yuv420p[v]`
    : `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps},format=yuv420p[v]`;
  const achain = clipVolume > 0 ? `[0:a]volume=${clipVolume}[c];[1:a][c]amix=inputs=2:duration=first[a]` : `[1:a]anull[a]`;
  const args = [...(isImage ? ['-loop', '1'] : ['-stream_loop', '-1']), '-i', clip, '-i', audio, '-t', String(durationSec),
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
  fs.writeFileSync(list, files.map((f) => concatListLine(f)).join('\n'));
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
  if (canBurn) { fc.push(`[0:v]subtitles='${escapeFilterPath(ass)}'[sv]`); v = '[sv]'; }
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
