// 试听候选音色：node scripts/preview-voices.mjs [--text=...] [--out=目录]
// 用同一句话把所有候选音色各念一遍，方便直接对比，选定后写进 storyboard.json 的 voice 块。
//
// 以前这里 spawn 的是 Python 版 edge-tts（还得 pip install，报错是一整段 traceback）；
// 仓里 v2 本来就有纯 Node 的 synthesize（msedge-tts，同一个微软端点）——直接用它，
// 这条命令从此不需要 Python。
import fs from 'node:fs/promises';
import path from 'node:path';
import { synthesize } from '../src/voice/edge-tts.mjs';

// Node 的 fetch/ws 不认 HTTPS_PROXY：设了代理的机器上不装这个，端点必 ECONNRESET
const { installProxy } = await import('../src/net/proxy.mjs');
await installProxy();

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

// '+6%' / '-6%' → synthesize 要的倍率 1.06 / 0.94
const rateOf = (r) => 1 + (Number(String(r).replace(/[%+]/g, '')) || 0) / 100;

// 一个音色挂掉不该带走整条命令：微软的非官方端点抖一下很常见，
// 真机上出过第 5 个音色失败、前面成好的 4 个也白费的事。
const failed = [];
let made = 0;
for (const [index, candidate] of CANDIDATES.entries()) {
  // label 里的 /（如「新闻/小说」）会被 path.join 当成子目录——文件名里换成 ·
  const file = path.join(outDir, `${String(index + 1).padStart(2, '0')}-${candidate.label.replace(/[\\/:*?"<>|]/g, '·')}.mp3`);
  try {
    await synthesize(text, { voice: candidate.name, rate: rateOf(candidate.rate), outFile: file });
    console.log(`✓ ${path.basename(file)}`);
    made++;
  } catch (error) {
    console.warn(`⚠️ ${candidate.label}：${String(error?.message).split('\n')[0].slice(0, 140)}`);
    failed.push(candidate.label);
  }
}
console.log(`\n${made}/${CANDIDATES.length} 个音色已生成 → ${outDir}`);
if (failed.length) {
  console.warn(`没成的：${failed.join('、')}——重跑一次通常就好（端点会抖）。`);
  process.exitCode = 1;
}
