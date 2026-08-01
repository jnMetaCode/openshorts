// 接入自备配乐：node scripts/import-music.mjs <故事名> <音频文件> [选项]
//
// 为什么不能直接把文件路径写进 storyboard.json 就完事：
// 外来音乐的响度千差万别（-8 到 -25 LUFS 都常见），而旁白闪避的 sidechain 是按幅度判定的。
// 一首本身很响的曲子会让压缩器全程压着，很轻的又根本触发不了。
// 所以导入时统一归一到固定的垫底电平，之后 soundtrackVolume 才是个有确定含义的数字。
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const root = process.cwd();

// 垫底音乐归一目标。比成片的 -14 低一截，留出人声空间；母带那一步还会做整体归一。
export const BED_TARGET_LUFS = -20;
export const BED_TRUE_PEAK = -2;

const positional = process.argv.slice(2).filter((item) => !item.startsWith('-'));
const flag = (key) => process.argv.slice(2).find((item) => item.startsWith(`--${key}=`))?.split('=').slice(1).join('=');
const [name, source] = positional;

if (!name || !source) {
  console.error(`用法：node scripts/import-music.mjs <故事名> <音频文件> [选项]

选项：
  --start=12.5        跳过开头多少秒（很多曲子前奏太长）
  --volume=0.42       配乐在成片里的相对音量，默认沿用分镜设置
  --credit="作者 - 曲名"   署名，很多免费音乐要求标注
  --license="CC BY 4.0"   许可协议
  --name=my-track     存放的文件名，默认取原文件名

例：
  node scripts/import-music.mjs nine-suns ~/Downloads/track.mp3 \\
    --start=8 --credit="Kevin MacLeod - Ancient Winds" --license="CC BY 4.0"`);
  process.exit(1);
}

const storyDir = path.join(root, 'content', name);
const boardPath = path.join(storyDir, 'storyboard.json');
const board = JSON.parse(await fs.readFile(boardPath, 'utf8').catch(() => {
  throw new Error(`找不到 ${path.relative(root, boardPath)}，请确认故事名`);
}));

const input = path.resolve(source);
await fs.access(input).catch(() => { throw new Error(`音频文件不存在：${input}`); });

const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input])).stdout);
const audio = probe.streams?.find((item) => item.codec_type === 'audio');
if (!audio) throw new Error(`${path.basename(input)} 里没有音频流`);
const sourceSeconds = Number(probe.format?.duration ?? 0);

const measured = await run('ffmpeg', ['-hide_banner', '-i', input, '-af', 'ebur128', '-f', 'null', '-']).catch((error) => ({stderr: error.stderr ?? ''}));
const sourceLufs = [...String(measured.stderr ?? '').matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s+LUFS/g)].map((m) => Number(m[1])).at(-1);

const slug = (flag('name') ?? path.parse(input).name).normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'track';
const start = Number(flag('start') ?? 0);
if (!Number.isFinite(start) || start < 0) throw new Error('--start 必须是非负数字');
if (start >= sourceSeconds) throw new Error(`--start=${start} 超过了曲子时长 ${sourceSeconds.toFixed(1)}s`);

const relative = `audio/custom/${slug}.wav`;
const output = path.join(root, 'public', relative);
await fs.mkdir(path.dirname(output), {recursive: true});

const filters = [
  `loudnorm=I=${BED_TARGET_LUFS}:LRA=11:TP=${BED_TRUE_PEAK}`,
  'aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo',
].join(',');
await run('ffmpeg', ['-y', '-v', 'error', ...(start ? ['-ss', String(start)] : []), '-i', input, '-af', filters, '-map', '0:a:0', output]);

const outProbe = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', output])).stdout);
const outSeconds = Number(outProbe.format?.duration ?? 0);

board.music = {
  file: relative,
  ...(flag('volume') ? {volume: Number(flag('volume'))} : {}),
  ...(flag('credit') ? {credit: flag('credit')} : {}),
  ...(flag('license') ? {license: flag('license')} : {}),
  source: path.basename(input),
  importedLufs: BED_TARGET_LUFS,
};
await fs.writeFile(boardPath, `${JSON.stringify(board, null, 2)}\n`);

console.log(`✓ 已接入配乐：public/${relative}`);
console.log(`  原始 ${sourceSeconds.toFixed(1)}s${sourceLufs != null ? ` · ${sourceLufs.toFixed(1)} LUFS` : ''}${start ? ` · 跳过前 ${start}s` : ''}`);
console.log(`  归一后 ${outSeconds.toFixed(1)}s · ${BED_TARGET_LUFS} LUFS · 48kHz 立体声`);
if (!flag('credit')) console.log('! 未填 --credit：多数免费音乐要求署名，验收会提醒');
console.log(`\n下一步：npm run story -- ${name} render`);
