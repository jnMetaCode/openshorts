import path from 'node:path';
import fs from 'node:fs';
import {captionReadingRate, subtitleBottomRatio} from '../../shared/captions.mjs';
import {unresolvedAssets} from './asset-provenance.mjs';

const isRemote = (src) => /^(https?:|data:|blob:)/.test(src);
// 中文舒适阅读速度约 7 字/秒；单条字幕超过 30 字在竖屏必然折行。
const MAX_READING_RATE = 9;
const MAX_CAPTION_CHARS = 30;
// 抖音/快手/视频号底部约 20% 是账号名、话题和进度条。
export const PLATFORM_UNSAFE_BOTTOM_RATIO = 0.2;

export const mediaSummaryFromProbe = (probe) => {
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
  const [rateA = '0', rateB = '1'] = String(video?.r_frame_rate ?? '0/1').split('/');
  return {
    duration: Number(probe.format?.duration ?? 0), size: Number(probe.format?.size ?? 0),
    width: Number(video?.width ?? 0), height: Number(video?.height ?? 0), fps: Number(rateA) / Number(rateB || 1),
    videoCodec: video?.codec_name ?? null, audioCodec: audio?.codec_name ?? null,
    audioProfile: audio?.profile ?? null,
    audioSampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    audioChannels: audio?.channels ? Number(audio.channels) : null,
    audioChannelLayout: audio?.channel_layout ?? null,
    audioDuration: audio?.duration ? Number(audio.duration) : null,
  };
};

export const analyzeProject = ({project, media, publicDir}) => {
  const errors = [];
  const warnings = [];
  const passes = [];
  const expectedDuration = project.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0) / project.fps;

  if (media.width !== project.width || media.height !== project.height) errors.push(`视频尺寸 ${media.width}×${media.height} 与项目 ${project.width}×${project.height} 不一致`);
  else passes.push(`分辨率 ${media.width}×${media.height}`);
  if (Math.abs(media.fps - project.fps) > 0.01) errors.push(`视频帧率 ${media.fps} 与项目 ${project.fps} 不一致`);
  else passes.push(`帧率 ${media.fps} FPS`);
  if (Math.abs(media.duration - expectedDuration) > 0.15) warnings.push(`成片 ${media.duration.toFixed(2)}s 与项目 ${expectedDuration.toFixed(2)}s 相差超过 0.15s`);
  else passes.push(`时长 ${media.duration.toFixed(2)}s`);
  if (!media.videoCodec) errors.push('没有检测到视频轨'); else passes.push(`视频编码 ${media.videoCodec}`);
  if (!media.audioCodec) warnings.push('没有检测到音轨');
  else {
    passes.push(`音频编码 ${media.audioCodec}${media.audioProfile ? ` ${media.audioProfile}` : ''}`);
    if (media.audioCodec === 'aac' && media.audioProfile && media.audioProfile !== 'LC') warnings.push(`AAC profile 为 ${media.audioProfile}，期望 LC`);
    if (media.audioSampleRate && media.audioSampleRate !== 48000) warnings.push(`音频采样率为 ${media.audioSampleRate} Hz，期望 48000 Hz`);
    else if (media.audioSampleRate) passes.push(`音频采样率 ${media.audioSampleRate} Hz`);
    if (media.audioChannels && media.audioChannels !== 2) warnings.push(`音轨为 ${media.audioChannels} 声道，期望双声道`);
    else if (media.audioChannels) passes.push(`音轨 ${media.audioChannelLayout ?? '双声道'}`);
    if (media.audioDuration && Math.abs(media.audioDuration - expectedDuration) > 0.15) warnings.push(`音轨 ${media.audioDuration.toFixed(2)}s 与项目 ${expectedDuration.toFixed(2)}s 尾长相差超过 0.15s`);
    else if (media.audioDuration) passes.push(`音轨尾长 ${media.audioDuration.toFixed(2)}s`);
  }

  const audioSources = [project.soundtrackSrc, ...project.scenes.flatMap((scene) => [scene.narrationSrc, ...(scene.audioCues ?? []).map((cue) => cue.src)])].filter(Boolean);
  for (const src of new Set(audioSources)) if (!isRemote(src) && !fs.existsSync(path.join(publicDir, src.replace(/^\//, '')))) errors.push(`音频素材不存在：${src}`);

  for (const scene of project.scenes) {
    const roles = new Set(scene.layers.map((layer) => layer.role));
    if (!roles.has('background')) warnings.push(`${scene.name} 缺少 background 图层`);
    if (!roles.has('primary')) warnings.push(`${scene.name} 缺少 primary 主体图层`);
    const sortedCaptions = [...(scene.captions ?? [])].sort((a, b) => a.fromFrame - b.fromFrame);
    for (let index = 0; index < sortedCaptions.length; index += 1) {
      const caption = sortedCaptions[index];
      if (caption.fromFrame < 0 || caption.toFrame > scene.durationFrames || caption.toFrame <= caption.fromFrame) errors.push(`${scene.name} 字幕“${caption.text}”超出镜头范围`);
      for (const word of caption.words ?? []) if (word.fromFrame < caption.fromFrame || word.toFrame > caption.toFrame || word.toFrame <= word.fromFrame) errors.push(`${scene.name} 字幕“${caption.text}”的逐字时间戳越界`);
      if (index > 0 && caption.fromFrame < sortedCaptions[index - 1].toFrame) warnings.push(`${scene.name} 的两段字幕发生重叠`);
      const rate = captionReadingRate(caption, project.fps);
      if (rate > MAX_READING_RATE) warnings.push(`${scene.name} 字幕“${caption.text}”停留 ${((caption.toFrame - caption.fromFrame) / project.fps).toFixed(1)}s，约 ${rate.toFixed(1)} 字/秒，超过 ${MAX_READING_RATE} 字/秒的舒适阅读速度`);
      if (caption.text.length > MAX_CAPTION_CHARS) warnings.push(`${scene.name} 字幕“${caption.text}”共 ${caption.text.length} 字，超过 ${MAX_CAPTION_CHARS} 字会折行并侵占画面`);
      if (index < sortedCaptions.length - 1 && !/[。，、；：？！,.;:?!…—]$/.test(caption.text)) warnings.push(`${scene.name} 字幕“${caption.text}”没有停在标点上，可能在词中间断行`);
    }
    for (const layer of scene.layers) {
      // 文字图层没有文件，跳过素材存在性检查
      if (layer.kind !== 'text' && !isRemote(layer.src) && !fs.existsSync(path.join(publicDir, layer.src.replace(/^\//, '')))) errors.push(`素材不存在：${layer.src}`);
      if (layer.x + layer.width < 0 || layer.x > project.width || layer.y > project.height) warnings.push(`${scene.name} / ${layer.name} 完全位于画布外`);
      if (layer.delayFrames >= scene.durationFrames) warnings.push(`${scene.name} / ${layer.name} 的入场延迟超过镜头时长`);
      for (const keyframe of layer.keyframes ?? []) {
        if (keyframe.frame >= scene.durationFrames) warnings.push(`${scene.name} / ${layer.name} 的关键帧 ${keyframe.frame} 超出镜头 ${scene.durationFrames} 帧，这段运动走不完`);
      }
    }
  }

  // 素材溯源。来源不明的素材不能商用，但也不该挡住本地预览——
  // 所以默认告警，公开发布前用 QUALITY_REQUIRE_PROVENANCE=1 升级为错误。
  const assetPlan = project.production?.assetPlan ?? [];
  if (assetPlan.length) {
    const unresolved = unresolvedAssets(assetPlan);
    const strict = process.env.QUALITY_REQUIRE_PROVENANCE === '1';
    if (unresolved.length) {
      const message = `${unresolved.length}/${assetPlan.length} 个素材来源未知：${unresolved.map((item) => item.src.split('/').pop()).join('、')}。公开发布或商用前需重新生成并补齐溯源`;
      (strict ? errors : warnings).push(message);
    } else passes.push(`${assetPlan.length} 个素材来源可查`);
  } else if (project.scenes.some((scene) => scene.layers.length)) {
    warnings.push('工程没有记录任何素材溯源');
  }

  // 第三方配乐几乎都要求署名。合成配乐不需要，所以只在用了外部文件时提醒。
  const music = project.production?.music;
  if (music?.file) {
    if (!music.credit) warnings.push(`配乐使用了外部文件 ${music.file}，但没有记录署名；多数免费音乐要求标注作者`);
    else passes.push(`配乐署名：${music.credit}${music.license ? `（${music.license}）` : ''}`);
  }

  const bottomRatio = subtitleBottomRatio(project.width, project.height);
  if (project.height > project.width) {
    if (bottomRatio < PLATFORM_UNSAFE_BOTTOM_RATIO) errors.push(`竖屏字幕底边距为画面高度的 ${(bottomRatio * 100).toFixed(0)}%，会被平台 UI 遮挡，至少需要 ${PLATFORM_UNSAFE_BOTTOM_RATIO * 100}%`);
    else passes.push(`竖屏字幕位于底部 ${(bottomRatio * 100).toFixed(0)}% 安全区之上`);
  }

  return {status: errors.length ? 'failed' : warnings.length ? 'warning' : 'passed', expectedDuration, errors, warnings, passes};
};
