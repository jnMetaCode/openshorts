import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {validateStoryTimings} from './lib/story-timings.mjs';
import {audioSummaryFromProbe, validateNarrationMedia} from './lib/audio-probe.mjs';

const fps = 30;
const root = process.cwd();
const run = promisify(execFile);
const storyDir = path.resolve(process.argv[2] ?? 'content/nine-suns');
const story = JSON.parse(await fs.readFile(path.join(storyDir, 'story.json'), 'utf8'));
const board = JSON.parse(await fs.readFile(path.join(storyDir, 'storyboard.json'), 'utf8'));
if (board.scenes.length !== story.segments.length) throw new Error(`storyboard 有 ${board.scenes.length} 镜，story 有 ${story.segments.length} 段`);

const timingPath = path.join(root, 'public/audio', story.id, 'timings.json');
let timings = null;
try {
  timings = JSON.parse(await fs.readFile(timingPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw new Error(`无法读取 ${timingPath}：${error.message}`);
}
if (timings) {
  const timingErrors = validateStoryTimings({story, timings});
  if (timingErrors.length) throw new Error(`旁白时序与故事不一致：\n- ${timingErrors.join('\n- ')}`);
  for (const segment of timings.segments) {
    const audioPath = path.resolve(root, segment.file);
    if (!audioPath.startsWith(`${path.join(root, 'public')}${path.sep}`)) throw new Error(`旁白路径必须位于 public/ 内：${segment.file}`);
    await fs.access(audioPath).catch(() => { throw new Error(`旁白文件不存在：${segment.file}`); });
    const {stdout} = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', audioPath]);
    const mediaErrors = validateNarrationMedia({label: segment.file, timing: segment, media: audioSummaryFromProbe(JSON.parse(stdout))});
    if (mediaErrors.length) throw new Error(`旁白文件与时序不一致：\n- ${mediaErrors.join('\n- ')}`);
  }
}

const splitCaptions = (text, frames) => {
  const bits = text.split(/(?<=[。？！；])/).filter(Boolean).flatMap((part) => part.length > 24 ? [part.slice(0, Math.ceil(part.length / 2)), part.slice(Math.ceil(part.length / 2))] : [part]);
  let cursor = 4;
  return bits.map((part, index) => {
    const available = frames - 8;
    const share = index === bits.length - 1 ? frames - 4 - cursor : Math.max(24, Math.round(available * part.length / text.length));
    const item = {text: part, fromFrame: cursor, toFrame: Math.min(frames - 2, cursor + share), words: []};
    cursor = item.toFrame;
    return item;
  });
};

const layerDefaults = (layer) => ({
  entrance: 'none', delayFrames: 0, rotation: 0, opacity: 1, flipX: false,
  paperEdge: layer.role !== 'background', keyframes: [], ...layer,
});
const durationFor = (i) => timings?.segments?.[i]?.duration ? timings.segments[i].duration + 0.55 : board.fallbackDurations[i];
const narrationFor = (i) => timings?.segments?.[i]?.file?.replace(/^public\//, '');

const scenes = story.segments.map((segment, i) => {
  const scene = board.scenes[i];
  const durationFrames = Math.ceil(durationFor(i) * fps);
  const narration = narrationFor(i);
  return {
    id: segment.id,
    name: `${i + 1}. ${segment.purpose}`,
    durationFrames,
    backgroundColor: scene.backgroundColor ?? board.backgroundColor,
    cameraZoom: scene.cameraZoom ?? board.cameraZoom ?? 1.035,
    layers: scene.layers.map(layerDefaults),
    captions: splitCaptions(segment.text, durationFrames),
    ...(narration ? {narrationSrc: narration} : {}),
    audioCues: scene.audioCues ?? [],
  };
});

const project = {
  schemaVersion: 1, id: story.id, title: story.title,
  width: 1080, height: 1920, fps,
  theme: board.theme,
  soundtrackSrc: `audio/${story.id}/original-underscore.wav`,
  soundtrackVolume: board.soundtrackVolume ?? 0.42,
  production: {
    plannerVersion: 1,
    sourceText: story.segments.map((x) => x.text).join('\n'),
    style: board.production?.style ?? {},
    characters: board.production?.characters ?? [],
    assetPlan: [],
  },
  scenes,
};
await fs.mkdir(path.join(root, 'projects'), {recursive: true});
await fs.writeFile(path.join(root, 'projects', `${story.id}.json`), `${JSON.stringify(project, null, 2)}\n`);
const total = scenes.reduce((n, s) => n + s.durationFrames, 0) / fps;
console.log(`✓ 已构建《${story.title}》：${total.toFixed(1)} 秒${timings ? '，已挂载分段旁白' : '，当前为配乐音效预览版'}`);
