import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildAssetPlan} from './lib/asset-provenance.mjs';
import {splitCaptions} from '../shared/captions.mjs';
import {validateStoryTimings} from './lib/story-timings.mjs';
import {audioSummaryFromProbe, validateNarrationMedia} from './lib/audio-probe.mjs';

const fps = 30;
const root = process.cwd();
const run = promisify(execFile);
const storyDir = path.resolve(process.argv[2] ?? 'content/nine-suns');
const story = JSON.parse(await fs.readFile(path.join(storyDir, 'story.json'), 'utf8'));
const board = JSON.parse(await fs.readFile(path.join(storyDir, 'storyboard.json'), 'utf8'));
const provenance = await fs.readFile(path.join(storyDir, 'assets.json'), 'utf8').then(JSON.parse).catch((error) => {
  if (error.code !== 'ENOENT') throw new Error(`无法读取 ${storyDir}/assets.json：${error.message}`);
  return {};
});
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

// 关键帧的 frame 可以写 'end'，表示本镜最后一帧——旁白时长一变，运动终点自动跟上。
const resolveFrame = (frame, durationFrames) => frame === 'end' ? durationFrames - 1 : frame;
const layerDefaults = (layer, durationFrames) => ({
  entrance: 'none', delayFrames: 0, rotation: 0, opacity: 1, flipX: false,
  paperEdge: layer.role !== 'background', keyframes: [], ...layer,
  ...(layer.keyframes?.length ? {keyframes: layer.keyframes.map((item) => ({...item, frame: resolveFrame(item.frame, durationFrames)}))} : {}),
});
// holdSeconds：镜头在旁白结束后多停留几秒。片尾定格（署名/品牌卡要看得清）靠它，
// 否则最后一层往往刚入场就黑屏——旁白多长，镜头就多长，留不出定格时间。
const durationFor = (i) => (timings?.segments?.[i]?.duration ? timings.segments[i].duration + 0.55 : board.fallbackDurations[i])
  + (board.scenes[i]?.holdSeconds ?? 0);
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
    layers: scene.layers.map((layer) => layerDefaults(layer, durationFrames)),
    captions: splitCaptions(segment.text, durationFrames),
    ...(narration ? {narrationSrc: narration} : {}),
    audioCues: scene.audioCues ?? [],
  };
});

const project = {
  schemaVersion: 1, id: story.id, title: story.title,
  width: 1080, height: 1920, fps,
  theme: board.theme,
  // 自带配乐优先，否则用按故事情绪合成的那首
  soundtrackSrc: board.music?.file ?? `audio/${story.id}/underscore.wav`,
  soundtrackVolume: board.music?.volume ?? board.soundtrackVolume ?? 0.42,
  production: {
    plannerVersion: 1,
    sourceText: story.segments.map((x) => x.text).join('\n'),
    style: board.production?.style ?? {},
    characters: board.production?.characters ?? [],
    // 溯源存在 content/<故事>/assets.json，构建时才 materialize 进工程——
    // 工程是生成物，直接往里写会被下次构建覆盖（以前 assetPlan 一直是空的就是这个原因）。
    assetPlan: buildAssetPlan({board, provenance}),
    // 署名随工程走，验收和发布清单才能查到；第三方音乐大多要求标注
    music: board.music ?? {mood: 'epic'},
  },
  scenes,
};
await fs.mkdir(path.join(root, 'projects'), {recursive: true});
await fs.writeFile(path.join(root, 'projects', `${story.id}.json`), `${JSON.stringify(project, null, 2)}\n`);
const total = scenes.reduce((n, s) => n + s.durationFrames, 0) / fps;
console.log(`✓ 已构建《${story.title}》：${total.toFixed(1)} 秒${timings ? '，已挂载分段旁白' : '，当前为配乐音效预览版'}`);
