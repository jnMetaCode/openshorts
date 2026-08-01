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
    error: `拒绝来自 ${origin} 的跨站写请求。若确实需要从该地址访问，请设置 PAPERCUT_ALLOWED_ORIGINS。`,
    allowed: allowlist,
  });
};

export const corsOptions = (allowlist) => ({
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin, allowlist)),
});
