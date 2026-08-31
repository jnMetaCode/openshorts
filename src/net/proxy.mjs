/**
 * 让 Node 的 fetch 认代理环境变量。
 *
 * 为什么需要：curl / git / pip 都认 `HTTPS_PROXY`，**Node 的 fetch 不认**
 * （`NODE_USE_ENV_PROXY` 要 Node 24+，22 上无效）。在设了代理的机器上，命令行里 curl 得通的地址，
 * OpenShorts 里一律 ECONNRESET——报错还长得像对面把你墙了。影响面是全部联网功能：
 * 素材检索、ffmpeg 安装、本地模型下载、抓正文。
 *
 * **直接用 AO 的实现，不要自己写。** 第一版我用了 undici 的 `EnvHttpProxyAgent`，
 * 单测和素材检索都正常，却把 AO 的**流式**响应打断了（"streaming terminated，已收到 0 字符"，
 * 重试五次全挂，而同一把 key 同一个代理下 curl 流式完全正常）——写脚本这一步因此彻底不能用。
 * AO 的 `installEnvProxy` 是按 origin 分流的：回环地址（Ollama / ComfyUI / 本机服务）直连，
 * 命中 `no_proxy` 的直连，其余走 ProxyAgent，并且带 `AO_NO_PROXY=1` 逃生开关。
 * 它自己的注释里也点名了 `EnvHttpProxyAgent` 会忽略显式传入的代理地址这个坑。
 * 两边都调 `setGlobalDispatcher` 只会互相打架，所以这里只做转发。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];

/** 环境里配的代理（没有返回 null）——只用来在 doctor 里显示，匹配规则交给 AO */
export function proxyFromEnv(env = process.env) {
  for (const v of VARS) if (env[v]) return { via: v, url: env[v] };
  return null;
}

let result = null;

/**
 * 装上代理调度器（转发给 AO 的实现，它是幂等的）。没配代理时什么都不做。
 * 返回 { via, url, installed }，给 doctor 和日志用；AO 不可用时降级为不代理而不是报错。
 */
export async function installProxy(env = process.env) {
  const p = proxyFromEnv(env);
  if (!p) { result = null; return null; }
  if (result) return result;
  try {
    const main = fileURLToPath(import.meta.resolve('agency-orchestrator'));
    const { installEnvProxy } = await import(path.join(path.dirname(main), 'utils', 'env-proxy.js'));
    const r = await installEnvProxy(env);
    result = { ...p, installed: !!r?.installed, reason: r?.reason };
  } catch (e) {
    result = { ...p, installed: false, error: e.message };
  }
  return result;
}

export const proxyInstalled = () => !!result?.installed;
