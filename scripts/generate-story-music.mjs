// 为单个故事生成专属配乐：npm run story -- <故事名> music
// 调式、速度和情绪从 content/<故事名>/storyboard.json 的 music 块读取。
import fs from 'node:fs/promises';
import path from 'node:path';
import {MOODS, renderMusic, wavBuffer} from './lib/music.mjs';

const root = process.cwd();
const name = process.argv.slice(2).find((item) => !item.startsWith('-'));
if (!name) throw new Error('用法：node scripts/generate-story-music.mjs <故事名> [--force]');
const force = process.argv.includes('--force');

const storyDir = path.join(root, 'content', name);
const story = JSON.parse(await fs.readFile(path.join(storyDir, 'story.json'), 'utf8'));
const board = JSON.parse(await fs.readFile(path.join(storyDir, 'storyboard.json'), 'utf8'));
const music = board.music ?? {};

// 自带配乐优先：storyboard.json 里写 "music": {"file": "audio/custom/xxx.mp3"} 即可，
// 合成器只是没有素材时的兜底。路径相对 public/。
if (music.file) {
  const source = path.resolve(root, 'public', String(music.file).replace(/^\/+/, ''));
  if (!source.startsWith(`${path.join(root, 'public')}${path.sep}`)) throw new Error(`配乐路径必须位于 public/ 内：${music.file}`);
  await fs.access(source).catch(() => { throw new Error(`配乐文件不存在：public/${music.file}`); });
  console.log(`✓ 《${story.title}》使用自带配乐：public/${music.file}`);
  process.exit(0);
}

const mood = music.mood ?? 'epic';
if (!MOODS[mood]) throw new Error(`未知情绪 ${mood}，可选：${Object.keys(MOODS).join('、')}`);

// 时长取旁白总长；没生成旁白时回落到分镜的兜底时长。
const timingPath = path.join(root, 'public/audio', name, 'timings.json');
const timings = await fs.readFile(timingPath, 'utf8').then(JSON.parse).catch(() => null);
const fallback = (board.fallbackDurations ?? []).reduce((sum, item) => sum + item, 0);
const seconds = Math.ceil((timings?.totalDuration ?? fallback ?? 60) + (story.segments?.length ?? 0) * 0.55 + 2);

const outDir = path.join(root, 'public/audio', name);
const outFile = path.join(outDir, 'underscore.wav');
// 换音色会改变旁白时长，配乐必须跟着重算——只看文件存不存在会留下长度对不上的旧曲子。
// WAV 头里就有帧数，不必调 ffprobe。
const existingSeconds = await fs.open(outFile, 'r').then(async (handle) => {
  try {
    const header = Buffer.alloc(44);
    await handle.read(header, 0, 44, 0);
    return header.readUInt32LE(40) / (header.readUInt32LE(24) * header.readUInt16LE(22) * 2);
  } finally { await handle.close(); }
}).catch(() => null);
if (!force && existingSeconds !== null && Math.abs(existingSeconds - seconds) <= 2) {
  console.log(`✓ 《${story.title}》配乐已存在且长度匹配，跳过：${path.relative(root, outFile)}（重建请加 --force）`);
  process.exit(0);
}
if (existingSeconds !== null && !force) console.log(`· 旁白时长已变（配乐 ${existingSeconds.toFixed(1)}s → 需要 ${seconds}s），重新生成配乐`);

// seed 由故事 id 决定：同一个故事永远得到同一首曲子，成片可复现；不同故事天然不同。
const seed = music.seed ?? [...name].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
const {data, notes} = renderMusic({mood, seconds, seed});
await fs.mkdir(outDir, {recursive: true});
await fs.writeFile(outFile, wavBuffer(data));
console.log(`✓ 《${story.title}》配乐已生成：${path.relative(root, outFile)}`);
console.log(`  情绪 ${mood} · ${seconds} 秒 · ${notes.length} 个音 · seed ${seed}`);
