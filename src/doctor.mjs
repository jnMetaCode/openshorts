/** `openshorts doctor` 本机体检：把同类项目 FAQ 里的坑先查一遍（MPT：ffmpeg 路径 / ulimit / whisper 模型 / 中文字体），再转 AO doctor。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readConfig } from './config.mjs';
import { sourcesAvailability } from './sources/availability.mjs';
const run = promisify(execFile);

const has = (cmd) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0;
async function ffFilters() { try { const r = await run(process.env.OPENSHORTS_FFMPEG || process.env.AO_FFMPEG || 'ffmpeg', ['-hide_banner', '-filters']); return new Set(String(r.stdout).split('\n').map((l) => l.trim().split(/\s+/)[1]).filter(Boolean)); } catch { return null; } }
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
  const ffmpeg = has(process.env.OPENSHORTS_FFMPEG || process.env.AO_FFMPEG || 'ffmpeg');
  add(ffmpeg ? 'ok' : 'fail', ffmpeg ? 'ffmpeg 就绪' : '缺 ffmpeg：macOS `brew install ffmpeg`，Windows `winget install ffmpeg`，Ubuntu `apt install ffmpeg`；装在别处设 OPENSHORTS_FFMPEG');
  const filters = ffmpeg ? await ffFilters() : null;
  if (filters) { add(filters.has('subtitles') ? 'ok' : 'warn', filters.has('subtitles') ? '字幕可烧进画面（libass）' : '这台 ffmpeg 没有 libass：字幕只能挂软轨（抖音上传会忽略）。macOS 可 `brew reinstall ffmpeg` 换带 libass 的构建，或用 static build'); add(filters.has('drawtext') ? 'ok' : 'warn', filters.has('drawtext') ? 'AI 标识角标可叠加（drawtext）' : '缺 drawtext：AI 标识只写元数据'); add(filters.has('ebur128') ? 'ok' : 'warn', filters.has('ebur128') ? '响度可测（ebur128）' : '缺 ebur128：质检测不出响度'); }
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
