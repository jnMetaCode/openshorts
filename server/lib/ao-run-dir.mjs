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

/**
 * 读一个步骤的文本产出。AO 把每步产出写成 `steps/<序号>-<id>.md`，开头几行是
 * `> emoji **名字** | 步骤 n/m` 与 `> ✅ 验收标准: …` 的引用块，再一条 `---`，之后才是正文。
 * 这里只要正文：镜头提示词回填进项目，用户能看见、能复制到别的模型去抽卡。
 * 找不到（步骤被跳过 / 老版本运行目录）返回 null，不抛。
 */
export const readStepOutput = (runDir, id) => {
  const dir = path.join(runDir, 'steps');
  let files; try { files = fs.readdirSync(dir); } catch { return null; }
  const f = files.find((x) => new RegExp(`^\\d+-${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.md$`).test(x));
  if (!f) return null;
  const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length && /^\s*>/.test(lines[i])) i++;          // 引用块头
  while (i < lines.length && /^\s*$/.test(lines[i])) i++;
  if (i < lines.length && /^---\s*$/.test(lines[i])) i++;           // 分隔线
  const body = lines.slice(i).join('\n').trim();
  return body || null;
};
