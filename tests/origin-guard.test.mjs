import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginGuard, defaultAllowedOrigins, isAllowedOrigin, resolveAllowedOrigins} from '../server/lib/origin-guard.mjs';

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
