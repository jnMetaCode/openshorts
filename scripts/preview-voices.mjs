// 试听候选音色：node scripts/preview-voices.mjs [--text=...] [--out=目录]
// 用同一句话把所有候选音色各念一遍，方便直接对比，选定后写进 storyboard.json 的 voice 块。
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const arg = (key, fallback) => process.argv.slice(2).find((item) => item.startsWith(`--${key}=`))?.split('=').slice(1).join('=') ?? fallback;

// 微软标注的定位写在括号里——选错定位是「听着不对味」最常见的原因。
export const CANDIDATES = [
  {name: 'zh-CN-YunyangNeural', rate: '+0%', label: '云扬-新闻播报（专业可靠）'},
  {name: 'zh-CN-YunyangNeural', rate: '-6%', label: '云扬-放慢6%'},
  {name: 'zh-CN-YunxiNeural', rate: '+0%', label: '云希-小说朗读（年轻明快）'},
  {name: 'zh-CN-YunjianNeural', rate: '+6%', label: '云健-体育解说（激情）'},
  {name: 'zh-CN-XiaoxiaoNeural', rate: '+0%', label: '晓晓-女声温暖（新闻/小说）'},
  {name: 'zh-CN-XiaoyiNeural', rate: '+0%', label: '晓依-女声活泼' },
];

const text = arg('text', '如果天上同时挂着十个太阳，河干了，地裂了，庄稼一晒就冒烟。你会怎么办？上古的答案只有三个字：射下来。');
const outDir = path.resolve(arg('out', 'out/voice-preview'));
await fs.mkdir(outDir, {recursive: true});

// 一个音色挂掉不该带走整条命令：edge-tts 走的是微软的非官方端点，抖一下很常见，
// 而它挂掉时抛的是一整段 Python traceback——真机上第 5 个音色失败，前面成好的 4 个也白费了。
const failed = [];
let made = 0;
let missingTool = false;
for (const [index, candidate] of CANDIDATES.entries()) {
  const file = path.join(outDir, `${String(index + 1).padStart(2, '0')}-${candidate.label}.mp3`);
  // 语速可能是负值，必须用 --rate=xx 形式，否则会被当成命令行标志。
  try {
    await run('edge-tts', ['--voice', candidate.name, `--rate=${candidate.rate}`, '--text', text, '--write-media', file]);
    console.log(`✓ ${path.basename(file)}`);
    made++;
  } catch (error) {
    const why = error?.code === 'ENOENT'
      ? '没装 edge-tts（这是 v1 脚本用的 Python 版：pip install edge-tts；v2 的开片界面用的是自带的 Node 版，不需要它）'
      : String(error?.stderr || error?.message).split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 140);
    console.warn(`⚠️ ${candidate.label}：${why}`);
    failed.push(candidate.label);
    if (error?.code === 'ENOENT') { missingTool = true; break; }   // 命令都没有，后面几个不必再试
  }
}
// 数真正成了几个，别拿"总数减去失败数"算——ENOENT 时会 break，failed 里只有一条，
// 那样会报成"5/6 已生成"，而实际一个都没有。
console.log(`\n${made}/${CANDIDATES.length} 个音色已生成 → ${outDir}`);
if (failed.length) {
  console.warn(missingTool ? '装上 edge-tts 再跑一次。' : `没成的：${failed.join('、')}——重跑一次通常就好（端点会抖）。`);
  process.exitCode = 1;
}
