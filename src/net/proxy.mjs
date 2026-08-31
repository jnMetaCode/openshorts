/**
 * 让 Node 的 fetch 认代理环境变量。
 *
 * 这是个坑得离谱的默认行为：curl / git / pip 都认 `HTTPS_PROXY`，**Node 的 fetch 不认**
 * （`NODE_USE_ENV_PROXY` 要 Node 24+，22 上无效）。所以在设了代理的机器上，
 * 命令行里 curl 得通的地址，OpenShorts 里一律 ECONNRESET——而且报错长得像对面把你墙了，
 * 完全看不出是自己没走代理。真机上就是这么误判的：先以为 Openverse 有 WAF 在 TLS 层拦 Node，
 * 加上代理之后一次就通了。
 *
 * 影响面是全部联网功能：素材检索、ffmpeg 安装、本地模型下载、封面抓取。
 * 对需要代理才能连 HuggingFace / GitHub 的用户来说，不修等于整个"免费路径"都用不了。
 *
 * undici 的 EnvHttpProxyAgent 的语义跟 curl 一致（认 HTTP_PROXY / HTTPS_PROXY / NO_PROXY，
 * 大小写都认），所以这里不自己解析规则，交给它。
 */
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

const VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];

/** 环境里配的代理（没有返回 null）——只用来显示，实际匹配规则交给 undici */
export function proxyFromEnv(env = process.env) {
  for (const v of VARS) if (env[v]) return { via: v, url: env[v] };
  return null;
}

let installed = false;

/**
 * 装上代理调度器。没配代理时什么都不做（不改变原有行为）。
 * 幂等：多次调用只装一次。返回装了什么，给 doctor 和日志用。
 */
export function installProxy(env = process.env) {
  const p = proxyFromEnv(env);
  if (!p || installed) return p ? { ...p, installed } : null;
  try { setGlobalDispatcher(new EnvHttpProxyAgent()); installed = true; return { ...p, installed: true }; }
  catch (e) { return { ...p, installed: false, error: e.message }; }
}

export const proxyInstalled = () => installed;
