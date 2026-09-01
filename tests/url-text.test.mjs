import test from 'node:test';
import assert from 'node:assert/strict';
import { extractArticle, fetchArticle, isPrivateAddress } from '../src/input/url-text.mjs';

test('抽正文：优先 article，去脚本样式，解实体', () => {
  const html = '<html><head><title>猫 &amp; 纸箱</title><style>.x{}</style><script>alert(1)</script></head><body><nav><p>菜单</p></nav><article><h1>为什么</h1><p>第一段&nbsp;内容</p><p>第二段</p></article></body></html>';
  const a = extractArticle(html, 'https://x');
  assert.equal(a.title, '猫 & 纸箱'); assert.ok(a.text.includes('第一段 内容') && a.text.includes('第二段') && !a.text.includes('菜单') && !a.text.includes('alert'));
});
test('公众号页取 js_content；无 article 时取 p 最多的容器', () => {
  const wx = '<div class="rich_media"><div id="js_content"><p>公众号正文一</p><p>正文二</p></div></div><div><p>侧栏</p></div>';
  assert.ok(extractArticle(wx).text.startsWith('公众号正文一'));
  const plain = '<div><p>a</p></div><div><p>b</p><p>c</p><p>d</p></div>';
  assert.equal(extractArticle(plain).text.replace(/\s/g, ''), 'bcd');
});
test('fetchArticle：非 http 拒绝；正文太短报可操作错误', async () => {
  await assert.rejects(() => fetchArticle('ftp://x'), /http/);
  await assert.rejects(() => fetchArticle('https://x', { resolve: async () => [{ address: '8.8.8.8' }], fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<p>短</p>' }) }), /粘贴/);
});

test('SSRF：本机 / 内网 / 解析到内网的域名一律拒绝', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', '0.0.0.0']) assert.equal(isPrivateAddress(ip), true, ip);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  await assert.rejects(() => fetchArticle('http://127.0.0.1:4174/api/kaipian/config'), /内网/);
  await assert.rejects(() => fetchArticle('http://localhost/x'), /内网/);
  await assert.rejects(() => fetchArticle('http://evil.example/', { resolve: async () => [{ address: '10.0.0.5' }] }), /内网/);
});

test('SSRF：公网域名 302 到内网也拦——redirect:follow 只校验第一跳，这是绕过口', async () => {
  const fetchImpl = async () => ({ ok: false, status: 302, headers: { get: (h) => (h === 'location' ? 'http://127.0.0.1:4174/api/kaipian/config' : null) } });
  await assert.rejects(() => fetchArticle('https://ok.example/', { resolve: async () => [{ address: '8.8.8.8' }], fetchImpl }), /内网/);
});

test('正常重定向逐跳校验后照走；循环重定向在 5 跳后报错', async () => {
  const fetchImpl = async (u) => (u.includes('final')
    ? { ok: true, status: 200, headers: { get: () => null }, text: async () => '<article><p>' + '字'.repeat(100) + '</p></article>' }
    : { ok: false, status: 301, headers: { get: (h) => (h === 'location' ? 'https://ok.example/final' : null) } });
  const a = await fetchArticle('https://ok.example/', { resolve: async () => [{ address: '8.8.8.8' }], fetchImpl });
  assert.ok(a.chars >= 80, '两跳后拿到正文');
  const loopImpl = async () => ({ ok: false, status: 302, headers: { get: (h) => (h === 'location' ? 'https://ok.example/loop' : null) } });
  await assert.rejects(() => fetchArticle('https://ok.example/', { resolve: async () => [{ address: '8.8.8.8' }], fetchImpl: loopImpl }), /重定向次数/);
});
