/**
 * 出片后的自动质检（口播线，架构 §10）：只报事实，不拦下载。
 * 项目：分辨率/帧率、时长 vs 各镜之和、有无音轨、响度（EBU R128 综合，目标 -16 LUFS ±3，抖音/视频号口播常用）、
 * 字幕（烧进画面或软轨）、封面存在、AI 标识元数据。每项 pass/warn/fail + 原话。
 */
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ffmpegPath, ffprobePath } from '../media/ffmpeg.mjs';
import { normLang } from '../project/lang.mjs';
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

/**
 * 质检原话按成片语言给。这几行不只进发布包，界面第 4 步的质检面板读的也是它——
 * 英文用户以前每出一条片就收到一屏中文事实陈述（交接表里"服务端状态值仍中文"的那半）。
 * 每条都写成 (zh, en) 两版，缺省中文；语言只从 project.lang 来，不猜。
 */
export async function checkKoubo(project, { file = project.final?.file, burnedCaptions = false, targetLufs = -16, lang = project.lang } = {}) {
  const en = normLang(lang) === 'en';
  const T = (zh, enText) => (en ? enText : zh);
  const items = [];
  const add = (id, status, msg) => items.push({ id, status, msg });
  if (!file || !fs.existsSync(file)) { add('file', 'fail', T('成片文件不存在', 'The rendered file does not exist')); return { pass: false, warnings: 0, items }; }
  const p = await probe(file);
  const v = p.streams.find((s) => s.codec_type === 'video'); const a = p.streams.find((s) => s.codec_type === 'audio'); const sub = p.streams.find((s) => s.codec_type === 'subtitle');
  const { w, h } = project.output ?? { w: 1080, h: 1920 };
  add('resolution', v && v.width === w && v.height === h ? 'pass' : 'fail', v ? `${v.width}×${v.height}${T(`（要求 ${w}×${h}）`, ` (expected ${w}×${h})`)}` : T('无视频流', 'no video stream'));
  const dur = Number(p.format?.duration ?? 0); const expect = project.shots.reduce((n, s) => n + (s.durationSec ?? 0), 0);
  const drift = expect ? Math.abs(dur - expect) / expect : 0;
  add('duration', drift <= 0.08 ? 'pass' : drift <= 0.2 ? 'warn' : 'fail', T(`成片 ${dur.toFixed(1)}s，各镜配音之和 ${expect.toFixed(1)}s（偏差 ${(drift * 100).toFixed(0)}%）`, `Video is ${dur.toFixed(1)}s, shot voice-overs total ${expect.toFixed(1)}s (${(drift * 100).toFixed(0)}% off)`));
  add('audio', a ? 'pass' : 'fail', a ? `${a.codec_name} ${a.sample_rate}Hz` : T('无音轨', 'no audio track'));
  if (a) { const lufs = await loudness(file); if (lufs == null) add('loudness', 'warn', T('测不出响度（ffmpeg 缺 ebur128）', 'Cannot measure loudness (this ffmpeg has no ebur128)')); else add('loudness', Math.abs(lufs - targetLufs) <= 3 ? 'pass' : 'warn', T(`综合响度 ${lufs.toFixed(1)} LUFS（目标 ${targetLufs} ±3）`, `Integrated loudness ${lufs.toFixed(1)} LUFS (target ${targetLufs} ±3)`)); }
  // 短视频平台一律不认软字幕轨，观众看到的就是没有字——这是 fail，不是"提醒"
  add('captions', burnedCaptions ? 'pass' : 'fail', burnedCaptions ? T('字幕已烧进画面', 'Captions are burned into the picture')
    : sub ? T('字幕只有软轨：抖音/视频号上传后不显示，纯色底的镜头会是空屏。跑 `openshorts install-ffmpeg` 后重出', 'Captions exist only as a soft track: short-video platforms drop it on upload, so solid-color shots become blank screens. Run `openshorts install-ffmpeg` and re-render')
      : T('没有字幕', 'no captions'));
  // 发布信息缺失以前只能靠用户自己发现"标题是空的"
  for (const [i, w] of (project.scriptWarnings ?? []).entries()) add(`script-${i}`, 'warn', w);
  if (project.publish?.error) add('publish-meta', 'warn', project.publish.error);
  else if (project.publish && !project.publish.titles?.length) add('publish-meta', 'warn', T('没有标题候选，发布文案要自己填', 'No title options — you will have to write the publishing copy yourself'));
  add('cover', project.final?.cover && fs.existsSync(project.final.cover) ? 'pass' : 'warn', project.final?.cover ? T('有封面', 'cover image present') : T('无封面', 'no cover image'));
  add('ai-label', /AI-generated|AI 生成/.test(String(p.format?.tags?.comment ?? '')) ? 'pass' : 'warn', p.format?.tags?.comment ? T('元数据含 AI 生成标识', 'Metadata carries the AI-generated label') : T('元数据无 AI 标识', 'Metadata has no AI label'));
  add('shots', project.shots.every((s) => s.status === 'ready') ? 'pass' : 'warn', T(`${project.shots.filter((s) => s.status === 'ready').length}/${project.shots.length} 镜头就绪`, `${project.shots.filter((s) => s.status === 'ready').length}/${project.shots.length} shots ready`));
  // 个别镜头退纯色底是提醒；过半就不是"降级"而是"这条片没有画面"了——素材检索整体失败
  // （断网/key 全废）时以前也只是 warn，产物是一条全深蓝底的片子还报质检通过
  const solid = project.shots.filter((s) => s.visual?.source === 'solid').length;
  if (solid) add('solid', solid * 2 > project.shots.length ? 'fail' : 'warn', T(
    `${solid}/${project.shots.length} 个镜头是纯色底（没找到素材）${solid * 2 > project.shots.length ? '——过半，先查素材源（openshorts sources）再重跑' : ''}`,
    `${solid}/${project.shots.length} shots fell back to a solid color (no footage found)${solid * 2 > project.shots.length ? ' — that is over half; check your sources (openshorts sources) before re-running' : ''}`));
  // 画面有没有被看过，是这条片能不能直接发的关键事实之一——技术项全绿不等于画面对
  const gen = project.shots.filter((s) => s.visual?.source === 'local-image').length;
  if (gen) add('generated', 'pass', T(`${gen} 个镜头的画面是本机生成的（不是检索来的）——发布时的 AI 标识要保留`, `${gen} shots were generated on this machine (not retrieved) — keep the AI label when you publish`));
  // 本地生成的画面不算"靠字面匹配选的"，它是照着画面意图画出来的
  const stockShots = project.shots.filter((s) => s.visual?.source && !['solid', 'local-image'].includes(s.visual.source)).length;
  if (stockShots) add('vision', project.vision?.used ? 'pass' : 'warn', project.vision?.used
    ? T(`${stockShots} 个镜头的画面经过看图排序把关`, `${stockShots} shots had their footage vetted by visual ranking`)
    : T(`${stockShots} 个镜头的画面只按检索词字面匹配选的，没经过看图把关（配一个能看图的模型：config.vision 或 --vision-provider），发之前自己过一遍`,
        `${stockShots} shots were picked by literal keyword match with no visual check (configure a vision-capable model: config.vision or --vision-provider) — review them yourself before publishing`));
  return { pass: !items.some((i) => i.status === 'fail'), warnings: items.filter((i) => i.status === 'warn').length, items };
}
