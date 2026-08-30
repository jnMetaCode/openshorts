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

export async function fetchArticle(url, { fetchImpl = fetch, maxChars = 6000 } = {}) {
  if (!/^https?:\/\//i.test(url)) throw new Error('请输入 http(s) 链接');
  const r = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 OpenShorts/2.0', Accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`抓取失败 HTTP ${r.status}`);
  const a = extractArticle(await r.text(), url);
  if (a.chars < 80) throw new Error('抓到的正文太短（可能需要登录或是纯前端渲染页）——请把文章内容直接粘贴进来');
  if (a.chars > maxChars) a.text = [...a.text].slice(0, maxChars).join('') + '\n…（已截断到 ' + maxChars + ' 字）';
  return a;
}
