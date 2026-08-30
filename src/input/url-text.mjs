/**
 * 链接 → 正文（口播线的"链接输入"，借鉴 open-chat-video-editor 的 URL2Video）。
 * 不引入 readability 依赖：去脚本/样式/导航，优先 <article>，否则取 <p> 最密集的容器；微信公众号页取 #js_content。
 * 只是给脚本步骤当素材，不追求完美抽取；抽不到就让用户手动粘贴。
 */
export function extractArticle(html, url = '') {
  const strip = (s) => s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const text = (s) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|section|blockquote)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const h = strip(String(html));
  const title = (h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  let body = '';
  const wechat = h.match(/<div[^>]+id=["']js_content["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i); if (wechat) body = wechat[1];
  if (!body) { const art = h.match(/<article[^>]*>([\s\S]*?)<\/article>/i); if (art) body = art[1]; }
  if (!body) {
    const blocks = [...h.matchAll(/<(div|section|main)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
    body = blocks.sort((a, b) => (b.match(/<\/p>/gi)?.length ?? 0) - (a.match(/<\/p>/gi)?.length ?? 0))[0] ?? h;
  }
  const t = text(body);
  return { title: text(title), text: t, chars: [...t].length, url };
}

import dns from 'node:dns/promises';
import net from 'node:net';
/** 内网 / 环回 / 链路本地 / 元数据地址一律拒绝——本机服务也不该替页面去访问内网（SSRF） */
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127); }
  const v6 = ip.toLowerCase(); return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:127.') || v6.startsWith('::ffff:10.') || v6.startsWith('::ffff:192.168.');
}
export async function assertPublicHost(url, { resolve = (h) => dns.lookup(h, { all: true }) } = {}) {
  const host = new URL(url).hostname;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('不抓本机或内网地址');
  const addrs = net.isIP(host) ? [{ address: host }] : await resolve(host).catch(() => []);
  if (!addrs.length) throw new Error('域名解析失败');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error('不抓本机或内网地址');
}

export async function fetchArticle(url, { fetchImpl = fetch, maxChars = 6000, resolve } = {}) {
  if (!/^https?:\/\//i.test(url)) throw new Error('请输入 http(s) 链接');
  await assertPublicHost(url, resolve ? { resolve } : {});
  const r = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 OpenShorts/2.0', Accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`抓取失败 HTTP ${r.status}`);
  const a = extractArticle(await r.text(), url);
  if (a.chars < 80) throw new Error('抓到的正文太短（可能需要登录或是纯前端渲染页）——请把文章内容直接粘贴进来');
  if (a.chars > maxChars) a.text = [...a.text].slice(0, maxChars).join('') + '\n…（已截断到 ' + maxChars + ' 字）';
  return a;
}
