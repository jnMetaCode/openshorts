/** `openshorts doctor` 本机体检：把同类项目 FAQ 里的坑先查一遍（MPT：ffmpeg 路径 / ulimit / whisper 模型 / 中文字体），再转 AO doctor。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readConfig } from './config.mjs';
import { sourcesAvailability } from './sources/availability.mjs';
import { ffmpegCaps } from './media/ffmpeg.mjs';
import { proxyFromEnv, installProxy } from './net/proxy.mjs';
import { tt, normLang } from './project/lang.mjs';

const has = (cmd) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0;
function chineseFont() {
  const cands = process.platform === 'darwin' ? ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Light.ttc', '/Library/Fonts/Arial Unicode.ttf']
    : process.platform === 'win32' ? ['C:\\Windows\\Fonts\\msyh.ttc', 'C:\\Windows\\Fonts\\simhei.ttf']
    : ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc'];
  const f = cands.find((p) => fs.existsSync(p)); if (f) return f;
  try { const r = spawnSync('fc-list', [], { encoding: 'utf-8' }); if (r.status === 0 && /Noto Sans CJK|Source Han|WenQuanYi|PingFang|Microsoft YaHei|SimHei/i.test(r.stdout)) return 'fc-list 命中'; } catch { /* no fontconfig */ }
  return null;
}
function ulimit() { if (process.platform === 'win32') return null; const r = spawnSync('sh', ['-c', 'ulimit -n'], { encoding: 'utf-8' }); const n = Number(String(r.stdout).trim()); return Number.isFinite(n) ? n : null; }

/**
 * 本机体检。**必须按语言说话**：README 和 SKILL.md 都让英文用户第一步先跑 `doctor`，
 * 而在 9-23 之前它只有标题是英文、十几行正文全是中文——英文用户装完看到的第一屏就是一堵中文墙。
 * 语言来自调用方（CLI 跟系统 locale，接口跟 ?lang=），不自己猜。
 */
export async function doctor({ lang = 'zh' } = {}) {
  const L = normLang(lang); const T = tt(L); const en = L === 'en';
  const C = en ? ': ' : '：';   // 冒号也要跟着语言：英文行里嵌一个全角「：」一眼就看得出是没翻干净
  const items = []; const add = (s, m) => items.push({ status: s, msg: m });
  const caps = await ffmpegCaps();
  const where = caps.managed ? T('（开片自己装的 ~/.openshorts/bin）', ' (the one OpenShorts installed in ~/.openshorts/bin)') : caps.bin === 'ffmpeg' ? '' : `（${caps.bin}）`;
  add(caps.found ? 'ok' : 'fail', caps.found ? `ffmpeg ${caps.version} ${T('就绪', 'ready')}${where}`
    : T('缺 ffmpeg：跑 `openshorts install-ffmpeg` 装一份（约 40 MB，只装到 ~/.openshorts/bin，不动系统）', 'No ffmpeg: run `openshorts install-ffmpeg` (about 40 MB, installed into ~/.openshorts/bin only, your system copy is untouched)'));
  if (caps.found) {
    // 字幕烧不进画面 = 成片在抖音/视频号上没有字，纯色底的镜头是空屏。这是 fail，不是提醒。
    // 注意：Homebrew 现在的 ffmpeg formula 已不再依赖 libass/freetype，所以"重装 brew 的 ffmpeg"解决不了，别再这么建议。
    add(caps.subtitles ? 'ok' : 'fail', caps.subtitles ? T('字幕可烧进画面（libass）', 'Subtitles can be burned in (libass)')
      : T('这台 ffmpeg 没有 libass：字幕烧不进画面，成片传到抖音/视频号后没有字，退纯色底的镜头会是空屏。跑 `openshorts install-ffmpeg` 装一份带 libass 的（Homebrew 的 ffmpeg 已不含 libass，`brew reinstall ffmpeg` 没用）',
        'This ffmpeg has no libass: subtitles cannot be burned in, so uploads to TikTok/Reels/Shorts will have no text and solid-colour shots will be blank. Run `openshorts install-ffmpeg` to get one with libass (Homebrew\'s ffmpeg no longer ships libass, so reinstalling it will not help)'));
    add(caps.drawtext ? 'ok' : 'warn', caps.drawtext ? T('AI 标识角标可叠加（drawtext）', 'The AI-generated badge can be overlaid (drawtext)')
      : T('缺 drawtext：AI 标识只写元数据（`openshorts install-ffmpeg` 一并解决）', 'No drawtext: the AI label goes into metadata only (`openshorts install-ffmpeg` fixes this too)'));
    add(caps.ebur128 ? 'ok' : 'warn', caps.ebur128 ? T('响度可测（ebur128）', 'Loudness can be measured (ebur128)') : T('缺 ebur128：质检测不出响度', 'No ebur128: the quality check cannot measure loudness'));
  }
  const font = chineseFont();
  add(font ? 'ok' : 'warn', font ? `${T('中文字体', 'CJK font')}${C}${font}` : T('未找到中文字体：字幕会成方块。Linux `apt install fonts-noto-cjk`', 'No CJK font found: Chinese subtitles would render as tofu boxes. On Linux: `apt install fonts-noto-cjk`'));
  const ul = ulimit();
  if (ul != null) add(ul >= 2048 ? 'ok' : 'warn', `${T('文件句柄上限', 'Open-file limit')} ulimit -n = ${ul}${ul < 2048 ? T('（批量出片可能 "too many open files"，先 `ulimit -n 4096`）', ' (batch renders may hit "too many open files"; run `ulimit -n 4096` first)') : ''}`);
  // 代理：Node 的 fetch 默认不认 HTTPS_PROXY，配了却没生效时所有下载都会以 ECONNRESET 失败
  const px = proxyFromEnv();
  if (px) { const r = await installProxy(); add(r?.installed ? 'ok' : 'warn', r?.installed ? T(`走代理 ${px.url}（${px.via}，回环地址直连）`, `Using proxy ${px.url} (${px.via}; loopback addresses go direct)`) : T(`检测到 ${px.via}=${px.url}，但代理没装上——联网功能可能失败`, `Found ${px.via}=${px.url} but the proxy did not install — network calls may fail`)); }
  else add('ok', T('未设代理（直连）', 'No proxy configured (direct connection)'));
  const mem = Math.round(os.totalmem() / 1024 ** 3); add('ok', `${T('内存', 'RAM')} ${mem} GB · ${os.cpus().length} ${T('核', 'cores')} · ${process.platform}/${process.arch}`);
  const cfg = readConfig();
  try { fs.mkdirSync(cfg.outputDir, { recursive: true }); fs.accessSync(cfg.outputDir, fs.constants.W_OK); add('ok', `${T('输出目录可写', 'Output directory is writable')}${C}${cfg.outputDir}`); }
  catch { add('fail', `${T('输出目录不可写', 'Output directory is not writable')}${C}${cfg.outputDir}${T('（在 ~/.openshorts/config.json 改 outputDir）', ' (change outputDir in ~/.openshorts/config.json)')}`); }
  // Edge TTS 是免费路径唯一的配音来源，微软改一次接口它就整条挂（同类项目 2024–2025 都栽过）。
  // 体检里真发一次最短的合成：通不了就是"现在出不了片"，不能等用户跑到第 3 步才撞上。10 秒超时。
  try {
    const { synthesize, DEFAULT_VOICES } = await import('./voice/edge-tts.mjs');
    const voice = cfg.voice?.voice ?? DEFAULT_VOICES[0]?.id ?? 'zh-CN-XiaoxiaoNeural';
    const r = await Promise.race([synthesize('你好', { voice }), new Promise((_, rej) => setTimeout(() => rej(new Error(T('10 秒没响应', 'no response within 10 s'))), 10_000))]);
    add(r?.buffer?.length ? 'ok' : 'fail', r?.buffer?.length ? T(`Edge TTS 可用（免费配音，${voice}）`, `Edge TTS works (free voice-over, ${voice})`) : T('Edge TTS 返回空音频：免费路径的配音会失败', 'Edge TTS returned empty audio: the free voice-over path will fail'));
  } catch (e) {
    const why = String(e.message).split('\n')[0].slice(0, 80);
    add('fail', T(`Edge TTS 不通（${why}）：免费路径的配音会失败——多半是网络/代理或微软端点变动，稍后重试；急用可在模板里改用 AO 的 tts 供应商`,
      `Edge TTS unreachable (${why}): the free voice-over path will fail — usually network/proxy or a Microsoft endpoint change. Retry later, or switch the template to an engine TTS provider`));
  }
  { const fb = cfg.tts?.fallback;
    add('ok', fb?.provider && fb?.model && fb?.voice ? T(`回落配音已配：${fb.provider}/${fb.model}/${fb.voice}（Edge TTS 挂了自动改走）`, `Fallback voice configured: ${fb.provider}/${fb.model}/${fb.voice} (used automatically if Edge TTS breaks)`)
      : T('回落配音未配（Edge TTS 挂了就出不了片；可在 config.tts.fallback 配 AO 里有语音端点的供应商 { provider, model, voice }）', 'No fallback voice (if Edge TTS breaks, rendering stops; set config.tts.fallback = { provider, model, voice } to an engine provider with a speech endpoint)')); }
  add(has('whisper-cli') ? 'ok' : 'warn', has('whisper-cli') ? T('whisper.cpp 就绪（无词级时间戳时可对齐字幕）', 'whisper.cpp ready (aligns captions when word-level timestamps are missing)') : T('未装 whisper.cpp（可选；Edge TTS 自带词级时间戳时不需要）', 'whisper.cpp not installed (optional; not needed while Edge TTS provides word-level timestamps)'));
  try { const { cacheStats } = await import('./sources/stock.mjs'); const cs = cacheStats();
    if (cs.files) add('ok', T(`素材缓存 ${cs.files} 个文件 · ${(cs.bytes / 1048576).toFixed(0)} MB（${cs.dir}，出片时自动清理 30 天未用的，上限 2 GB）`,
      `Footage cache: ${cs.files} files · ${(cs.bytes / 1048576).toFixed(0)} MB (${cs.dir}; entries unused for 30 days are pruned on each render, 2 GB cap)`)); } catch { /* 无缓存 */ }
  const src = sourcesAvailability({ lang: L });
  add(src.stock.ok ? 'ok' : 'warn', `${T('素材库', 'Footage libraries')}${C}${src.stock.reason}`);
  // 本机出图（口播线找不到素材时顶上）以前在体检里完全没有——用户不知道有这么个选项
  try {
    const { sdImageStatus } = await import('./local/sd-image.mjs');
    const g = await sdImageStatus({ lang: L });
    add(g.ok ? 'ok' : 'warn', g.ok ? T(`本机出图：${g.models.find((m) => m.id === g.ready)?.label} 就绪（素材库没命中时顶上，不花钱）`, `On-device image generation: ${g.models.find((m) => m.id === g.ready)?.label} ready (paints a frame when stock has nothing, free)`)
      : !g.cliFound ? T('本机出图：未装 sd-cli（`openshorts install-image` 会提示怎么装；不装的话找不到素材的镜头退纯色底）', 'On-device image generation: sd-cli not installed (`openshorts install-image` explains how; without it, shots with no footage fall back to a solid colour)')
      : T(`本机出图：模型没下（\`openshorts install-image\`，${g.models.find((m) => m.usable)?.sizeGB ?? '?'} GB，Apache-2.0 可商用）`, `On-device image generation: model not downloaded (\`openshorts install-image\`, ${g.models.find((m) => m.usable)?.sizeGB ?? '?'} GB, Apache-2.0, commercial use allowed)`));
  } catch { /* 模块不可用就跳过 */ }
  add(src.image.ok ? 'ok' : 'warn', `${T('云端出图（短剧线）', 'Cloud image generation (mini-drama)')}${C}${src.image.reason}`);
  add(src.local.ok ? 'ok' : 'warn', `${T('本机出片（短剧线 H3）', 'On-device video generation (mini-drama, H3)')}${C}${src.local.reason}`);
  add(src.cloud.ok ? 'ok' : 'warn', `${T('云端出片（短剧线）', 'Cloud video generation (mini-drama)')}${C}${src.cloud.reason}`);

  // 一句话结论：新用户看完十几行也答不上"我现在到底能不能出片"
  const blockers = items.filter((i) => i.status === 'fail').map((i) => i.msg.split(en ? ': ' : '：')[0].split(en ? '. ' : '。')[0]);
  items.unshift({ status: blockers.length ? 'fail' : 'ok',
    msg: blockers.length ? T(`现在还出不了片：${blockers.join('；')}`, `Cannot render yet: ${blockers.join('; ')}`) : T('现在就能出片（口播线 0 元 0 key；短剧线要配供应商 key）', 'Ready to render (talking-head line costs $0 and needs no key; the mini-drama line needs provider keys)') });
  return items;
}
export function formatDoctor(items) { return items.map((i) => `  ${i.status === 'ok' ? '✅' : i.status === 'warn' ? '⚠️ ' : '⛔'} ${i.msg}`).join('\n'); }
