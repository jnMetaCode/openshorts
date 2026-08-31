import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginGuard, defaultAllowedOrigins, isAllowedOrigin, resolveAllowedOrigins, createActionGuard} from '../server/lib/origin-guard.mjs';

const request = ({method = 'POST', origin}) => ({method, get: (name) => (name.toLowerCase() === 'origin' ? origin : undefined)});
const response = () => {
  const res = {statusCode: null, body: null};
  res.status = (code) => {res.statusCode = code; return res;};
  res.json = (body) => {res.body = body; return res;};
  return res;
};
const run = (guard, req) => {
  const res = response();
  let passed = false;
  guard(req, res, () => {passed = true;});
  return {passed, res};
};

test('默认放行本机的服务端口和 Vite 开发端口', () => {
  const list = defaultAllowedOrigins(4174);
  for (const origin of ['http://127.0.0.1:4174', 'http://localhost:4174', 'http://127.0.0.1:4173', 'http://localhost:4173']) {
    assert.ok(list.includes(origin), `缺少 ${origin}`);
  }
});

test('环境变量可覆盖默认允许列表', () => {
  assert.deepEqual(resolveAllowedOrigins({port: 4174, configured: 'http://192.168.1.5:4174, http://nas.local'}), ['http://192.168.1.5:4174', 'http://nas.local']);
  assert.ok(resolveAllowedOrigins({port: 4174, configured: '  '}).includes('http://127.0.0.1:4174'), '空值应回落到默认列表');
});

test('没有 Origin 的请求放行：curl 和脚本不是浏览器攻击面', () => {
  assert.equal(isAllowedOrigin(undefined, ['http://127.0.0.1:4174']), true);
});

test('恶意网页的跨站写请求被服务端拒绝', () => {
  const guard = createOriginGuard(defaultAllowedOrigins(4174));
  for (const origin of ['http://evil.example', 'https://evil.example', 'http://127.0.0.1:9999', 'null']) {
    const {passed, res} = run(guard, request({origin}));
    assert.equal(passed, false, `${origin} 不应通过`);
    assert.equal(res.statusCode, 403);
    assert.ok(res.body.error.includes('OPENSHORTS_ALLOWED_ORIGINS'), '错误信息应告诉用户怎么放行');
  }
});

test('同源与开发端口的写请求正常通过', () => {
  const guard = createOriginGuard(defaultAllowedOrigins(4174));
  for (const origin of ['http://127.0.0.1:4174', 'http://localhost:4173']) {
    assert.equal(run(guard, request({origin})).passed, true, `${origin} 应通过`);
  }
});

test('读请求和预检不受拦截，交给 CORS 头处理', () => {
  const guard = createOriginGuard(defaultAllowedOrigins(4174));
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(run(guard, request({method, origin: 'http://evil.example'})).passed, true, `${method} 不应被拦`);
  }
});

test('所有会改状态的方法都受保护', () => {
  const guard = createOriginGuard(defaultAllowedOrigins(4174));
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(run(guard, request({method, origin: 'http://evil.example'})).passed, false, `${method} 应被拦`);
  }
});

test('显式配置 * 可以退回旧的全开行为', () => {
  assert.equal(run(createOriginGuard(['*']), request({origin: 'http://evil.example'})).passed, true);
});

/**
 * v2 的接口——出片、下 27 GB 模型、跑短剧（会用你配好的 key 调云端视频供应商，真花钱）——
 * 全是 GET，因为 EventSource 只支持 GET。而上面那条 guard 只管非安全方法，于是本文件开头
 * 描述的威胁模型对它们完全没生效：开着 Studio 时访问的任何网页，一个 <img src="…/local/install">
 * 就能触发。CORS 拦不住（只让浏览器读不到响应，请求照样执行），<img> 连 Origin 都不带。
 */
test('会花钱/写盘的 GET 接口，跨站触发要拦（靠 Sec-Fetch-Site，<img> 不带 Origin）', () => {
  const guard = createActionGuard(['http://127.0.0.1:4174']);
  const run = (path, headers = {}) => {
    const req = {path, method: 'GET', get: (h) => headers[h.toLowerCase()]};
    let status = null, body = null;
    const res = {status(s) { status = s; return this; }, json(b) { body = b; return this; }};
    let passed = false;
    guard(req, res, () => { passed = true; });
    return {passed, status, body};
  };

  // 恶意网页里的 <img src="http://127.0.0.1:4174/api/kaipian/local/install?what=all&agree=1">
  assert.equal(run('/api/kaipian/local/install', {'sec-fetch-site': 'cross-site'}).passed, false);
  assert.equal(run('/api/kaipian/local/install', {'sec-fetch-site': 'cross-site'}).status, 403);
  assert.equal(run('/api/kaipian/drama/run', {'sec-fetch-site': 'cross-site'}).passed, false, '这个会花钱，尤其不能漏');
  assert.equal(run('/api/kaipian/projects/abc/run', {'sec-fetch-site': 'same-site'}).passed, false);

  // 界面自己的 EventSource：同源
  assert.equal(run('/api/kaipian/projects/abc/run', {'sec-fetch-site': 'same-origin'}).passed, true);
  // 直接在地址栏打开：导航
  assert.equal(run('/api/kaipian/ffmpeg/install', {'sec-fetch-site': 'none'}).passed, true);
  // curl / CLI / 脚本：不带 Sec-Fetch-*，不能误伤
  assert.equal(run('/api/kaipian/projects/abc/batch', {}).passed, true);
  // 跨站但带了不在白名单里的 Origin，一样拦
  assert.equal(run('/api/kaipian/projects/abc/run', {origin: 'https://evil.example'}).passed, false);

  // 只读接口不受影响
  assert.equal(run('/api/kaipian/projects', {'sec-fetch-site': 'cross-site'}).passed, true);
  assert.equal(run('/api/kaipian/sources', {'sec-fetch-site': 'cross-site'}).passed, true);
});
