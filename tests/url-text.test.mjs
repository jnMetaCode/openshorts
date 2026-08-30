import test from 'node:test';
import assert from 'node:assert/strict';
import { extractArticle, fetchArticle } from '../src/input/url-text.mjs';

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
  await assert.rejects(() => fetchArticle('https://x', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<p>短</p>' }) }), /粘贴/);
});
