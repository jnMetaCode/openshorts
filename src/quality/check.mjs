/**
 * 出片后的自动质检（口播线，架构 §10）：只报事实，不拦下载。
 * 项目：分辨率/帧率、时长 vs 各镜之和、有无音轨、响度（EBU R128 综合，目标 -16 LUFS ±3，抖音/视频号口播常用）、
 * 字幕（烧进画面或软轨）、封面存在、AI 标识元数据。每项 pass/warn/fail + 原话。
 */
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ffmpegPath, ffprobePath } from '../media/ffmpeg.mjs';
const run = promisify(execFile);
const FFMPEG = ffmpegPath;
const FFPROBE = ffprobePath;

export async function probe(file) {
  const r = await run(FFPROBE(), ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { maxBuffer: 8 << 20 });
  return JSON.parse(r.stdout);
}
export async function loudness(file) {
  try {
    const r = await run(FFMPEG(), ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { maxBuffer: 8 << 20 });
    const m = String(r.stderr).match(/I:\s*(-?[\d.]+)\s*LUFS/);
    return m ? Number(m[1]) : null;
  } catch (e) { const m = String(e.stderr ?? '').match(/I:\s*(-?[\d.]+)\s*LUFS/); return m ? Number(m[1]) : null; }
}

export async function checkKoubo(project, { file = project.final?.file, burnedCaptions = false, targetLufs = -16 } = {}) {
  const items = [];
  const add = (id, status, msg) => items.push({ id, status, msg });
  if (!file || !fs.existsSync(file)) { add('file', 'fail', '成片文件不存在'); return { pass: false, items }; }
  const p = await probe(file);
  const v = p.streams.find((s) => s.codec_type === 'video'); const a = p.streams.find((s) => s.codec_type === 'audio'); const sub = p.streams.find((s) => s.codec_type === 'subtitle');
  const { w, h } = project.output ?? { w: 1080, h: 1920 };
  add('resolution', v && v.width === w && v.height === h ? 'pass' : 'fail', v ? `${v.width}×${v.height}（要求 ${w}×${h}）` : '无视频流');
  const dur = Number(p.format?.duration ?? 0); const expect = project.shots.reduce((n, s) => n + (s.durationSec ?? 0), 0);
  const drift = expect ? Math.abs(dur - expect) / expect : 0;
  add('duration', drift <= 0.08 ? 'pass' : drift <= 0.2 ? 'warn' : 'fail', `成片 ${dur.toFixed(1)}s，各镜配音之和 ${expect.toFixed(1)}s（偏差 ${(drift * 100).toFixed(0)}%）`);
  add('audio', a ? 'pass' : 'fail', a ? `${a.codec_name} ${a.sample_rate}Hz` : '无音轨');
  if (a) { const lufs = await loudness(file); if (lufs == null) add('loudness', 'warn', '测不出响度（ffmpeg 缺 ebur128）'); else add('loudness', Math.abs(lufs - targetLufs) <= 3 ? 'pass' : 'warn', `综合响度 ${lufs.toFixed(1)} LUFS（目标 ${targetLufs} ±3）`); }
  // 短视频平台一律不认软字幕轨，观众看到的就是没有字——这是 fail，不是"提醒"
  add('captions', burnedCaptions ? 'pass' : 'fail', burnedCaptions ? '字幕已烧进画面' : sub ? '字幕只有软轨：抖音/视频号上传后不显示，纯色底的镜头会是空屏。跑 `openshorts install-ffmpeg` 后重出' : '没有字幕');
  // 发布信息缺失以前只能靠用户自己发现"标题是空的"
  if (project.publish?.error) add('publish-meta', 'warn', project.publish.error);
  else if (project.publish && !project.publish.titles?.length) add('publish-meta', 'warn', '没有标题候选，发布文案要自己填');
  add('cover', project.final?.cover && fs.existsSync(project.final.cover) ? 'pass' : 'warn', project.final?.cover ? '有封面' : '无封面');
  add('ai-label', /AI-generated|AI 生成/.test(String(p.format?.tags?.comment ?? '')) ? 'pass' : 'warn', p.format?.tags?.comment ? '元数据含 AI 生成标识' : '元数据无 AI 标识');
  add('shots', project.shots.every((s) => s.status === 'ready') ? 'pass' : 'warn', `${project.shots.filter((s) => s.status === 'ready').length}/${project.shots.length} 镜头就绪`);
  const solid = project.shots.filter((s) => s.visual?.source === 'solid').length; if (solid) add('solid', 'warn', `${solid} 个镜头是纯色底（没找到素材）`);
  // 画面有没有被看过，是这条片能不能直接发的关键事实之一——技术项全绿不等于画面对
  const gen = project.shots.filter((s) => s.visual?.source === 'local-image').length;
  if (gen) add('generated', 'pass', `${gen} 个镜头的画面是本机生成的（不是检索来的）——发布时的 AI 标识要保留`);
  // 本地生成的画面不算"靠字面匹配选的"，它是照着画面意图画出来的
  const stockShots = project.shots.filter((s) => s.visual?.source && !['solid', 'local-image'].includes(s.visual.source)).length;
  if (stockShots) add('vision', project.vision?.used ? 'pass' : 'warn', project.vision?.used
    ? `${stockShots} 个镜头的画面经过看图排序把关`
    : `${stockShots} 个镜头的画面只按检索词字面匹配选的，没经过看图把关（配一个能看图的模型：config.vision 或 --vision-provider），发之前自己过一遍`);
  return { pass: !items.some((i) => i.status === 'fail'), warnings: items.filter((i) => i.status === 'warn').length, items };
}
