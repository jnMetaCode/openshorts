// 统一的故事流水线入口：npm run story -- <故事名> [阶段]
//
// 以前每个故事都要在 package.json 里抄一遍 build / render / release 六条脚本，
// 而 build-story.mjs 早就泛化了——脚本层没跟上。这里只认约定：
//   content/<名字>/story.json + storyboard.json  →  projects/<名字>.json  →  out/<名字>.mp4
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((item) => !item.startsWith('-'));
const flags = new Set(process.argv.slice(2).filter((item) => item.startsWith('-')));
const name = args[0];
const stage = args[1] ?? 'render';
const STAGES = ['audio', 'audio:local', 'build', 'render', 'release'];

const usage = async () => {
  const dirs = await fs.readdir(path.join(root, 'content'), {withFileTypes: true}).catch(() => []);
  const stories = dirs.filter((item) => item.isDirectory()).map((item) => item.name);
  console.error(`用法：npm run story -- <故事名> [${STAGES.join('|')}] [--fallback]

阶段：
  audio        用 edge-tts 生成旁白，再按真实语音时长重建工程
  audio:local  同上，但用完全离线的 Kokoro
  build        只重建 projects/<故事名>.json
  render       构建 + Remotion 渲染 + 音频母带 + 验收（默认）
  release      render 之后再做原子发布、Whisper 反识别和 SHA-256 清单

  --fallback  用纯 FFmpeg 渲染（无 Chrome 时的降级，没有入场动画）
  --voice=<音色>  临时覆盖 storyboard.json 里的旁白音色
  --rate=<语速>   例如 --rate=-6%（负号必须用等号形式）
  --pitch=<音高>  例如 --pitch=-10Hz

试听音色：node scripts/preview-voices.mjs

已有故事：${stories.length ? stories.join('、') : '（content/ 下没有故事目录）'}`);
  process.exit(1);
};

if (!name || !STAGES.includes(stage)) await usage();
const storyDir = path.join(root, 'content', name);
for (const file of ['story.json', 'storyboard.json']) {
  if (!await fs.access(path.join(storyDir, file)).then(() => true).catch(() => false)) {
    console.error(`✗ 缺少 content/${name}/${file}`);
    await usage();
  }
}

const project = `projects/${name}.json`;
const video = `out/${name}.mp4`;
const fallback = flags.has('--fallback');

const run = (command, commandArgs) => new Promise((resolve, reject) => {
  const child = spawn(command, commandArgs, {cwd: root, stdio: 'inherit', env: process.env});
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${commandArgs.join(' ')} 退出码 ${code}`)));
  child.once('error', reject);
});
const node = (script, ...rest) => run(process.execPath, [path.join('scripts', script), ...rest]);

// 音色从 storyboard.json 的 voice 块读；命令行可临时覆盖，方便试听不同音色。
const board = JSON.parse(await fs.readFile(path.join(storyDir, 'storyboard.json'), 'utf8'));
const flagValue = (key) => process.argv.slice(2).find((item) => item.startsWith(`--${key}=`))?.split('=').slice(1).join('=');
const voice = {name: 'zh-CN-YunyangNeural', rate: '+0%', pitch: '+0Hz', ...(board.voice ?? {})};
const chosen = {
  name: flagValue('voice') ?? voice.name,
  rate: flagValue('rate') ?? voice.rate,
  pitch: flagValue('pitch') ?? voice.pitch,
};

if (stage === 'audio') {
  console.log(`旁白音色：${chosen.name} · 语速 ${chosen.rate} · 音高 ${chosen.pitch}`);
  await node('generate-macos-story-audio.mjs', `--story=content/${name}/story.json`, `--output=public/audio/${name}`,
    `--voice=${chosen.name}`, `--rate=${chosen.rate}`, `--pitch=${chosen.pitch}`);
}
if (stage === 'audio:local') await node('run-local-kokoro.mjs', name);

await node('generate-story-soundscape.mjs');
await node('generate-story-music.mjs', name);
await node('build-story.mjs', `content/${name}`);
if (stage === 'build' || stage.startsWith('audio')) process.exit(0);

if (fallback) await node('render-story-ffmpeg.mjs', project);
else {
  await node('render.mjs', project);
  await node('master-audio.mjs', video, project);
}
await node('quality-report.mjs', video, project);
if (stage === 'render') process.exit(0);

await node('finalize-story.mjs', video, `out/${name}-final-voice.mp4`, project);
await node('run-local-whisper.mjs', `out/${name}-final-voice.mp4`);
await node('create-story-manifest.mjs', project, `content/${name}/story.json`, `public/audio/${name}/timings.json`, `out/${name}-final-voice.mp4`);
