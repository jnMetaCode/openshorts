export const audioSummaryFromProbe = (probe) => {
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
  return {
    codec: audio?.codec_name ?? null,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    channels: audio?.channels ? Number(audio.channels) : null,
    duration: Number(audio?.duration ?? probe.format?.duration ?? 0),
  };
};

export const validateNarrationMedia = ({label, timing, media}) => {
  const errors = [];
  if (!media.codec) errors.push(`${label} 没有可读音轨`);
  if (media.codec && media.codec !== 'pcm_s16le') errors.push(`${label} 编码为 ${media.codec}，期望 PCM 16-bit WAV`);
  if (media.sampleRate !== 48000) errors.push(`${label} 采样率为 ${media.sampleRate ?? '未知'} Hz，期望 48000 Hz`);
  if (media.channels !== 1) errors.push(`${label} 为 ${media.channels ?? '未知'} 声道，期望单声道`);
  if (!Number.isFinite(media.duration) || Math.abs(media.duration - timing.duration) > 0.002) errors.push(`${label} WAV ${media.duration.toFixed(3)}s 与 timings ${timing.duration.toFixed(3)}s 不一致`);
  return errors;
};
