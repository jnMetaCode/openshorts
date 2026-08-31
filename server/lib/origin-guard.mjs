// 本地优先不等于没有攻击面：Studio 开着的时候，你访问的任何网页都能向 127.0.0.1 发请求，
// 覆盖工程、触发渲染、读取工程内容。
//
// 只配 cors() 是不够的——CORS 只让浏览器「读不到响应」，请求本身照样会在服务端执行。
// 所以对会改状态的方法必须在服务端显式按 Origin 拦截。

const DEV_PORTS = [4173];

export const defaultAllowedOrigins = (port) => {
  const ports = [...new Set([Number(port), ...DEV_PORTS])];
  return ports.flatMap((item) => [
    `http://127.0.0.1:${item}`,
    `http://localhost:${item}`,
    `http://[::1]:${item}`,
  ]);
};

export const resolveAllowedOrigins = ({port, configured}) => {
  const list = String(configured ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return list.length ? list : defaultAllowedOrigins(port);
};

export const isAllowedOrigin = (origin, allowlist) => {
  if (!origin) return true;              // curl、脚本和同源导航不带 Origin
  if (allowlist.includes('*')) return true;
  return allowlist.includes(origin);
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 拦截跨站的写请求。读请求交给 CORS 头处理即可。 */
export const createOriginGuard = (allowlist) => (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (isAllowedOrigin(origin, allowlist)) return next();
  return res.status(403).json({
    error: `拒绝来自 ${origin} 的跨站写请求。若确实需要从该地址访问，请设置 OPENSHORTS_ALLOWED_ORIGINS。`,
    allowed: allowlist,
  });
};

/**
 * 会动状态的 GET（SSE 接口只能是 GET）也必须拦。
 *
 * 上面那条 guard 只管非安全方法，而 v2 的接口——出片、下模型、跑短剧——全是 GET，
 * 因为 EventSource 只支持 GET。于是本文件开头描述的那个威胁模型对它们完全没生效：
 * 你开着 Studio 时访问的任何网页，一个 <img src="http://127.0.0.1:4174/api/kaipian/local/install?…">
 * 就能让你的机器开始下 27 GB 模型，或者用你配好的 key 去调云端视频供应商——那是真花钱的。
 * （CORS 拦不住：它只让浏览器读不到响应，请求照样在服务端执行；<img> / <iframe> 连 Origin 都不带。）
 *
 * 用 Sec-Fetch-Site 兜这一层：浏览器发的请求一定带它，跨站时值是 cross-site / same-site；
 * curl 和脚本不带，所以命令行和自动化不受影响。
 */
const isBrowserCrossSite = (req) => {
  const site = req.get('sec-fetch-site');
  if (!site) return false;                     // 非浏览器（curl / 脚本 / CLI）
  return site !== 'same-origin' && site !== 'none';
};

/** 这些路径会写盘、下大文件或花钱，即使是 GET 也要按写请求对待 */
export const ACTION_PATHS = [
  /^\/api\/kaipian\/projects\/[^/]+\/(run|batch)$/,
  /^\/api\/kaipian\/projects\/[^/]+\/drama\/redo$/,
  /^\/api\/kaipian\/drama\/run$/,
  /^\/api\/kaipian\/(local|ffmpeg|local-image)\/install$/,
];
export const isActionPath = (p) => ACTION_PATHS.some((re) => re.test(p));

export const createActionGuard = (allowlist) => (req, res, next) => {
  if (!isActionPath(req.path)) return next();
  const origin = req.get('origin');
  if (isAllowedOrigin(origin, allowlist) && !isBrowserCrossSite(req)) return next();
  return res.status(403).json({
    error: `拒绝跨站触发「${req.path}」——这个接口会写盘/下大文件/花钱。若确实需要，请设置 OPENSHORTS_ALLOWED_ORIGINS。`,
    allowed: allowlist,
  });
};

export const corsOptions = (allowlist) => ({
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin, allowlist)),
});
