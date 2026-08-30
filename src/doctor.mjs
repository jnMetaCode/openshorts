/** `openshorts doctor` 本机体检：把同类项目 FAQ 里的坑先查一遍（MPT：ffmpeg 路径 / ulimit / whisper 模型 / 中文字体），再转 AO doctor。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readConfig } from './config.mjs';
import { sourcesAvailability } from './sources/availability.mjs';
import { ffmpegCaps } from './media/ffmpeg.mjs';

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

export async function doctor() {
  const items = []; const add = (s, m) => items.push({ status: s, msg: m });
  const caps = await ffmpegCaps();
  const where = caps.managed ? '（开片自己装的 ~/.openshorts/bin）' : caps.bin === 'ffmpeg' ? '' : `（${caps.bin}）`;
  add(caps.found ? 'ok' : 'fail', caps.found ? `ffmpeg ${caps.version} 就绪${where}` : '缺 ffmpeg：跑 `openshorts install-ffmpeg` 装一份（约 40 MB，只装到 ~/.openshorts/bin，不动系统）');
  if (caps.found) {
    // 字幕烧不进画面 = 成片在抖音/视频号上没有字，纯色底的镜头是空屏。这是 fail，不是提醒。
    // 注意：Homebrew 现在的 ffmpeg formula 已不再依赖 libass/freetype，所以"重装 brew 的 ffmpeg"解决不了，别再这么建议。
    add(caps.subtitles ? 'ok' : 'fail', caps.subtitles ? '字幕可烧进画面（libass）'
      : '这台 ffmpeg 没有 libass：字幕烧不进画面，成片传到抖音/视频号后没有字，退纯色底的镜头会是空屏。跑 `openshorts install-ffmpeg` 装一份带 libass 的（Homebrew 的 ffmpeg 已不含 libass，`brew reinstall ffmpeg` 没用）');
    add(caps.drawtext ? 'ok' : 'warn', caps.drawtext ? 'AI 标识角标可叠加（drawtext）' : '缺 drawtext：AI 标识只写元数据（`openshorts install-ffmpeg` 一并解决）');
    add(caps.ebur128 ? 'ok' : 'warn', caps.ebur128 ? '响度可测（ebur128）' : '缺 ebur128：质检测不出响度');
  }
  const font = chineseFont(); add(font ? 'ok' : 'warn', font ? `中文字体：${font}` : '未找到中文字体：字幕会成方块。Linux `apt install fonts-noto-cjk`');
  const ul = ulimit(); if (ul != null) add(ul >= 2048 ? 'ok' : 'warn', `文件句柄上限 ulimit -n = ${ul}${ul < 2048 ? '（批量出片可能 "too many open files"，先 `ulimit -n 4096`）' : ''}`);
  const mem = Math.round(os.totalmem() / 1024 ** 3); add('ok', `内存 ${mem} GB · ${os.cpus().length} 核 · ${process.platform}/${process.arch}`);
  const cfg = readConfig(); try { fs.mkdirSync(cfg.outputDir, { recursive: true }); fs.accessSync(cfg.outputDir, fs.constants.W_OK); add('ok', `输出目录可写：${cfg.outputDir}`); } catch { add('fail', `输出目录不可写：${cfg.outputDir}（在 ~/.openshorts/config.json 改 outputDir）`); }
  add(has('whisper-cli') ? 'ok' : 'warn', has('whisper-cli') ? 'whisper.cpp 就绪（无词级时间戳时可对齐字幕）' : '未装 whisper.cpp（可选；Edge TTS 自带词级时间戳时不需要）');
  const src = sourcesAvailability();
  for (const [k, label] of [['stock', '素材库'], ['image', 'AI 配图'], ['local', '本地生成'], ['cloud', '云端出片']]) add(src[k].ok ? 'ok' : 'warn', `${label}：${src[k].reason}`);
  return items;
}
export function formatDoctor(items) { return items.map((i) => `  ${i.status === 'ok' ? '✅' : i.status === 'warn' ? '⚠️ ' : '⛔'} ${i.msg}`).join('\n'); }
