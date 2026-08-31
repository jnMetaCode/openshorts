import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyFromEnv } from '../src/net/proxy.mjs';

/**
 * Node 的 fetch 不认 HTTPS_PROXY（NODE_USE_ENV_PROXY 要 Node 24+）。这条真机上坑了一次：
 * curl 通、node 全部 ECONNRESET，报错长得像对面有 WAF，其实只是自己没走代理。
 */
test('识别代理环境变量，大小写都认，按 curl 的优先级', () => {
  assert.equal(proxyFromEnv({}), null, '没配代理就返回 null，不改变原有行为');
  assert.deepEqual(proxyFromEnv({ HTTPS_PROXY: 'http://127.0.0.1:7890' }), { via: 'HTTPS_PROXY', url: 'http://127.0.0.1:7890' });
  assert.deepEqual(proxyFromEnv({ https_proxy: 'http://p:1' }), { via: 'https_proxy', url: 'http://p:1' });
  assert.equal(proxyFromEnv({ HTTP_PROXY: 'http://a:1', HTTPS_PROXY: 'http://b:2' }).url, 'http://b:2', 'HTTPS_PROXY 优先于 HTTP_PROXY');
  assert.equal(proxyFromEnv({ ALL_PROXY: 'socks5://x:1' }).via, 'ALL_PROXY');
});
