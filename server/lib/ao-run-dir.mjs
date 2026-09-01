// AO 每次运行——包括 --resume——都会在输出目录下新建「短剧流水线-<时间戳>」目录
// （AO 的 saveResults 无条件拼新时间戳）。所以"这次跑出来的目录"有一个可靠判据：
// spawn 之后新出现的那一个。
//
// 以前的兜底是按 mtime 取最新，对 --resume 是致命的：最新的极可能就是上一次运行自己，
// 于是旧产物被原样拷回、界面报"重出成功"，画面一帧没变。宁可报错也不能猜。
import fs from 'node:fs';
import path from 'node:path';

export const listDramaRuns = (runsDir) => {
  try { return fs.readdirSync(runsDir).filter((d) => d.startsWith('短剧流水线')).map((d) => path.join(runsDir, d)); }
  catch { return []; }
};

/** spawn 前快照 → spawn 后找新目录。恰好一个才算数；零个或多个（并发写入）都返回 null 交给上层报错。 */
export const pickFreshRunDir = (before, runsDir) => {
  const fresh = listDramaRuns(runsDir).filter((d) => !before.has(d));
  return fresh.length === 1 ? fresh[0] : null;
};
