export const validateStoryTimings = ({story, timings}) => {
  const errors = [];
  if (!timings || typeof timings !== 'object') return ['timings.json 不是有效对象'];
  if (timings.storyId !== story.id) errors.push(`storyId 为 ${timings.storyId ?? '缺失'}，期望 ${story.id}`);
  // 读音词典只被本地 Kokoro 链路（pypinyin 注音）消费；edge/macos 引擎原生朗读，不受词典约束。
  const usesPronunciations = timings.provider === 'kokoro-local'
    || (Array.isArray(timings.segments) && timings.segments.some((segment) => segment?.provider === 'kokoro-local'));
  if (usesPronunciations && JSON.stringify(timings.pronunciations ?? {}) !== JSON.stringify(story.pronunciations ?? {})) errors.push('读音词典与 story.json 不一致，需要重新生成旁白');
  if (!Array.isArray(timings.segments)) return [...errors, 'segments 不是数组'];
  if (timings.segments.length !== story.segments.length) errors.push(`旁白段数为 ${timings.segments.length}，期望 ${story.segments.length}`);

  let cursor = 0;
  for (const [index, expected] of story.segments.entries()) {
    const actual = timings.segments[index];
    if (!actual) continue;
    const label = `第 ${index + 1} 段`;
    if (actual.id !== expected.id) errors.push(`${label} id 为 ${actual.id ?? '缺失'}，期望 ${expected.id}`);
    if (actual.text !== expected.text) errors.push(`${label}文案与 story.json 不一致`);
    if (!actual.file || typeof actual.file !== 'string') errors.push(`${label}缺少音频路径`);
    if (!Number.isFinite(actual.duration) || actual.duration <= 0) errors.push(`${label}时长无效`);
    if (!Number.isFinite(actual.start) || Math.abs(actual.start - cursor) > 0.002) errors.push(`${label}开始时间不连续`);
    if (Number.isFinite(actual.duration) && (!Number.isFinite(actual.end) || Math.abs(actual.end - actual.start - actual.duration) > 0.002)) errors.push(`${label}结束时间与时长不一致`);
    if (Number.isFinite(actual.end)) cursor = actual.end;
  }
  if (!Number.isFinite(timings.totalDuration) || Math.abs(timings.totalDuration - cursor) > 0.002) errors.push('totalDuration 与分段累计时长不一致');
  return errors;
};
