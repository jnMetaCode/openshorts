/**
 * 按包目录取 AO 的内部模块。AO 的 exports 只声明了主入口，连接器 / 工具得拼绝对路径绕过白名单。
 *
 * **必须转成 file:// URL 再 import**：Windows 上 `import('D:\\…')` 会被当成 `d:` 协议直接抛
 * ERR_UNSUPPORTED_ESM_URL_SCHEME；macOS / Linux 上裸路径恰好能用，所以这个坑在本机永远撞不到。
 * 以前八处各自把拼出来的路径直接交给 import()，外面多半还包着 catch——Windows 上界面存的 key 重启也不生效、
 * 设置面板列不出供应商、代理装不上，全都静默（issue #12 的测试在 Windows CI 上红了才发现）。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function aoModuleUrl(segments, { resolve = (s) => import.meta.resolve(s), sep = path } = {}) {
  const main = fileURLToPath(resolve('agency-orchestrator'));
  return pathToFileURL(sep.join(sep.dirname(main), ...segments)).href;
}
export const importAo = (...segments) => import(aoModuleUrl(segments));
