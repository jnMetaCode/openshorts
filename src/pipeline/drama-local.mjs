/**
 * 短剧线的本机草稿档（sd.cpp 跑 MiniMax-H3 Q2）只有一个出处：界面和命令行都从这里取。
 * 以前只有界面带 640×384 / 2 秒；命令行照 `drama --help` 抄 local-sdcpp 参数时落到工作流默认的
 * 720p / 8 秒，在 32 GB 的机器上是草稿档的十几倍工作量。
 */
export const LOCAL_DRAMA = { video_provider: 'local-sdcpp', video_model: 'minimax-h3-q2', video_duration: '2' };
export const localResolution = (ratio) => (ratio === '9:16' ? '384x640' : '640x384');

/** 从 `-i k=v` 参数里读出输入；用户显式给了的一律不动，只补本机档缺的分辨率/时长 */
export function localDramaDefaults(args) {
  const inputs = {};
  for (let i = 0; i < args.length - 1; i++) if (args[i] === '-i') { const [k, ...v] = args[i + 1].split('='); inputs[k] = v.join('='); }
  if (inputs.video_provider !== LOCAL_DRAMA.video_provider) return [];
  const add = {};
  if (!inputs.video_resolution) add.video_resolution = localResolution(inputs.video_ratio);
  if (!inputs.video_duration) add.video_duration = LOCAL_DRAMA.video_duration;
  return Object.entries(add).flatMap(([k, v]) => ['-i', `${k}=${v}`]);
}
