// 音频母带：配乐循环补齐 → 旁白闪避 → 混音 → 平台响度归一。
// 这是 Remotion 和 FFmpeg 两条渲染路径唯一的音频真源，避免「哪个渲染器出的片声音不一样」。

// 抖音/B站/YouTube 的播放归一化目标。
export const PLATFORM_TARGET_LUFS = -14;
export const PLATFORM_TRUE_PEAK_DBFS = -1.5;
export const PLATFORM_LOUDNESS_RANGE = 7;
// 旁白响起时把配乐压低约 10 dB，人声不必靠调大音量去压过背景。
export const DUCKING = {threshold: 0.03, ratio: 8, attack: 5, release: 350, makeup: 1};
// 片尾淡出时长；旁白通常在此之前就结束了，淡的是配乐尾巴。
export const TAIL_FADE_SECONDS = 1.6;

export const collectAudioSources = (project) => [...new Set([
  project.soundtrackSrc,
  ...project.scenes.flatMap((scene) => [scene.narrationSrc, ...(scene.audioCues ?? []).map((cue) => cue.src)]),
].filter(Boolean))];

/**
 * 生成 ffmpeg -filter_complex 的音频部分。
 * @returns {{sources: string[], filters: string[], outLabel: string}} sources 按顺序对应
 *   ffmpeg 的第 firstAudioInput、firstAudioInput+1 … 个输入。
 */
export const buildAudioGraph = ({project, totalSeconds, firstAudioInput = 1}) => {
  const sources = collectAudioSources(project);
  const filters = [];
  const indexOf = (src) => sources.indexOf(src) + firstAudioInput;
  const duration = totalSeconds.toFixed(3);

  const hasMusic = Boolean(project.soundtrackSrc) && sources.includes(project.soundtrackSrc);
  // 配乐短于成片时循环补齐，否则片尾会突然没有音乐。
  if (hasMusic) filters.push(`[${indexOf(project.soundtrackSrc)}:a]aloop=loop=-1:size=2147483647,atrim=0:${duration},volume=${project.soundtrackVolume ?? 0.18}[music]`);

  const voices = [];
  const cues = [];
  let sceneStart = 0;
  for (const scene of project.scenes) {
    if (scene.narrationSrc) {
      const delay = Math.round(sceneStart / project.fps * 1000);
      const name = `voice${voices.length}`;
      filters.push(`[${indexOf(scene.narrationSrc)}:a]adelay=${delay}|${delay},volume=1.0[${name}]`);
      voices.push(`[${name}]`);
    }
    for (const cue of scene.audioCues ?? []) {
      const delay = Math.round((sceneStart + cue.fromFrame) / project.fps * 1000);
      const name = `cue${cues.length}`;
      filters.push(`[${indexOf(cue.src)}:a]adelay=${delay}|${delay},volume=${cue.volume}[${name}]`);
      cues.push(`[${name}]`);
    }
    sceneStart += scene.durationFrames;
  }

  const mix = [];
  if (hasMusic && voices.length) {
    if (voices.length > 1) filters.push(`${voices.join('')}amix=inputs=${voices.length}:duration=longest:normalize=0[voicebus]`);
    else filters.push(`${voices[0]}anull[voicebus]`);
    filters.push('[voicebus]asplit=2[voiceout][voicekey]');
    filters.push(`[music][voicekey]sidechaincompress=threshold=${DUCKING.threshold}:ratio=${DUCKING.ratio}:attack=${DUCKING.attack}:release=${DUCKING.release}:makeup=${DUCKING.makeup}[ducked]`);
    mix.push('[ducked]', '[voiceout]', ...cues);
  } else {
    if (hasMusic) mix.push('[music]');
    mix.push(...voices, ...cues);
  }
  if (!mix.length) return {sources, filters: [], outLabel: null};

  // 片尾淡出：配乐长度和成片长度几乎不可能正好相等，不淡出就会在最后一帧硬切。
  const fadeStart = Math.max(0, totalSeconds - TAIL_FADE_SECONDS).toFixed(3);
  filters.push(`${mix.join('')}amix=inputs=${mix.length}:duration=longest:normalize=0,apad=whole_dur=${duration},atrim=0:${duration},afade=t=out:st=${fadeStart}:d=${TAIL_FADE_SECONDS},loudnorm=I=${PLATFORM_TARGET_LUFS}:LRA=${PLATFORM_LOUDNESS_RANGE}:TP=${PLATFORM_TRUE_PEAK_DBFS}[a]`);
  return {sources, filters, outLabel: '[a]'};
};

export const AAC_ARGS = ['-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '192k', '-ar', '48000', '-ac', '2'];
