/**
 * 原子写文件：先写同目录的临时文件，再 rename 覆盖。
 * project.json / config.json 都是"一次写整个文件"——直接 writeFileSync 被杀在半路（Ctrl+C、桌面版退出、
 * 断电、磁盘满）就留下半截 JSON，下次打开整个项目读不出来。rename 在同一文件系统上是原子的。
 */
import fs from 'node:fs';
import path from 'node:path';

export function writeFileAtomic(file, data) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}
export const writeJsonAtomic = (file, obj) => writeFileAtomic(file, JSON.stringify(obj, null, 2));
