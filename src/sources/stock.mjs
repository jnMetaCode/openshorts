/**
 * 素材库来源（架构 §3.1）：本地素材夹 → 本地缓存 → Pexels → Pixabay。
 * 每段取最多 3 条候选；同一项目内去重；返回的候选带 license/author 进 provenance。
 * key 由 ~/.openshorts/config.json 提供（用户自己的，注册即得，不内置共享 key，ADR-009）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { readConfig, OPENSHORTS_HOME } from '../config.mjs';

const CACHE_DIR = path.join(OPENSHORTS_HOME, 'cache', 'stock');
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;
const UA = 'OpenShorts/2.0 (+https://github.com/jnMetaCode/openshorts)';

/** 本地素材夹：按文件名/同名 .txt 标签 做最朴素的关键词匹配（用户自有素材优先级最高） */
export function searchLocal(query, { dirs = [], limit = 3 } = {}) {
  const words = tokenize(query);
  const hits = [];
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const f of walk(dir)) {
      if (!VIDEO_EXT.test(f)) continue;
      const base = path.basename(f, path.extname(f)).toLowerCase();
      let tags = base;
      const txt = f.replace(VIDEO_EXT, '.txt');
      if (fs.existsSync(txt)) tags += ' ' + fs.readFileSync(txt, 'utf-8').toLowerCase();
      const score = words.filter((w) => tags.includes(w)).length;
      if (score > 0 || words.length === 0) hits.push({ score, file: f });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit).map((h) => ({
    id: `local:${hash(h.file)}`, source: 'local-folder', kind: 'video', file: h.file, url: null, width: null, height: null, duration: null,
    license: 'user-owned', author: null, score: h.score,
  }));
}

export async function searchPexels(query, { key, limit = 3, orientation = 'portrait', minDuration = 0, fetchImpl = fetch } = {}) {
  if (!key) return [];
  const u = new URL('https://api.pexels.com/videos/search');
  u.searchParams.set('query', query); u.searchParams.set('per_page', String(Math.max(limit * 3, 9))); u.searchParams.set('orientation', orientation); u.searchParams.set('size', 'medium');
  const r = await fetchImpl(u, { headers: { Authorization: key, 'User-Agent': UA } });
  if (r.status === 429) throw new StockRateLimit('Pexels 触发限额（免费 key 200 次/小时、2 万次/月）');
  if (!r.ok) throw new Error(`Pexels ${r.status}`);
  const j = await r.json();
  return (j.videos ?? []).filter((v) => (v.duration ?? 0) >= minDuration).slice(0, limit).map((v) => {
    const files = (v.video_files ?? []).filter((f) => f.file_type === 'video/mp4').sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    const best = files.find((f) => (f.height ?? 0) <= 1920 && (f.height ?? 0) >= 720) ?? files[0];
    return { id: `pexels:${v.id}`, source: 'pexels', kind: 'video', file: null, url: best?.link ?? null, thumb: v.image ?? null, width: best?.width ?? v.width, height: best?.height ?? v.height, duration: v.duration, license: 'Pexels License', author: v.user?.name ?? null, authorUrl: v.user?.url ?? null, page: v.url };
  });
}

export async function searchPixabay(query, { key, limit = 3, minDuration = 0, fetchImpl = fetch } = {}) {
  if (!key) return [];
  const u = new URL('https://pixabay.com/api/videos/');
  u.searchParams.set('key', key); u.searchParams.set('q', query); u.searchParams.set('per_page', String(Math.max(limit * 3, 9))); u.searchParams.set('safesearch', 'true');
  const r = await fetchImpl(u, { headers: { 'User-Agent': UA } });
  if (r.status === 429) throw new StockRateLimit('Pixabay 触发限额（100 次/分钟）');
  if (!r.ok) throw new Error(`Pixabay ${r.status}`);
  const j = await r.json();
  return (j.hits ?? []).filter((v) => (v.duration ?? 0) >= minDuration).slice(0, limit).map((v) => {
    const f = v.videos?.large ?? v.videos?.medium ?? v.videos?.small;
    return { id: `pixabay:${v.id}`, source: 'pixabay', kind: 'video', file: null, url: f?.url ?? null, thumb: f?.thumbnail ?? (v.picture_id ? `https://i.vimeocdn.com/video/${v.picture_id}_640x360.jpg` : null), width: f?.width, height: f?.height, duration: v.duration, license: 'Pixabay Content License', author: v.user ?? null, page: v.pageURL };
  });
}

/**
 * Commons 的转码版地址。原图 .../commons/1/17/NAME.webm 对应
 * .../commons/transcoded/1/17/NAME.webm/NAME.webm.720p.vp9.webm。
 *
 * 为什么非要用它：Commons 上一段 75 秒的猫视频原文件 50 MB，而我们只截其中三四秒；
 * 看图排序每镜还要下 3 条候选，6 镜就是 1 GB 起步。转码版同一条只有 7.6 MB。
 * 竖屏成片是从横屏素材里裁中间那条 9:16，所以别取太低：按源高度挑 1080p / 720p / 480p。
 * 老文件不一定有转码版（Commons 按需生成），所以同时留着原地址兜底。
 */
export function wikimediaTranscoded(url, height) {
  const m = String(url).split('?')[0].match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f])\/([0-9a-f]{2})\/(.+)$/i);
  if (!m) return null;
  const [, base, a, b, name] = m;
  // 源本身就比 480p 还小时不存在转码版（Commons 只往下转不往上转），直接用原文件
  const target = [1080, 720, 480].find((h) => h <= (height || 0));
  return target ? `${base}/transcoded/${a}/${b}/${name}/${name}.${target}p.vp9.webm` : null;
}

/**
 * Wikimedia Commons（不要 key！CC / 公有领域，需署名）：真正零配置的免费素材源。
 * 检索 `filetype:video`，多为 webm/ogv，ffmpeg 都能吃；署名信息进 provenance（CC BY-SA 要求）。
 */
export async function searchWikimedia(query, { limit = 3, minDuration = 0, maxDuration = 1800, fetchImpl = fetch } = {}) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({ action: 'query', generator: 'search', gsrsearch: `filetype:video ${query}`, gsrnamespace: '6', gsrlimit: String(Math.max(limit * 3, 9)), prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist|Credit|LicenseUrl',
    // 顺带要一张缩略图给看图排序用：seek=10 是为了躲开片头标题卡（真机被一段 1920 年代动画的标题卡坑过），
    // 一次调用拿到，不额外往返；短于 10 秒的片子 MediaWiki 会自己回落到首帧
    iiurlwidth: '640', iiurlparam: 'seek=10',
    format: 'json', origin: '*' }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetchImpl(u, { headers: { 'User-Agent': UA } });
  if (r.status === 429) throw new StockRateLimit('Wikimedia 触发限速，稍后再试');
  if (!r.ok) throw new Error(`Wikimedia ${r.status}`);
  const j = await r.json();
  const pages = Object.values(j.query?.pages ?? {});
  // Wikimedia 的全文检索会命中描述里的任意词（"cardboard spectrometer"），所以要按标题再筛一道。
  // 光"含任意一个查询词"不够：查 "cat box" 时 "Wasp eating cat food" 命中 cat 就过了，
  // 真机就这么把一段黄蜂吃猫粮的片子配到了"猫为什么总爱钻纸箱"上。
  // 改成按命中词数排序：两个词都命中的排前面。但要清楚它的天花板——"Wasp eating cat food" 和
  // "Lotti playing in a box" 各命中一个词，标题匹配根本分不出哪个才是"猫钻纸箱"。
  // 真正能分辨的是看图排序；没配 vision 模型时这条片的画面就是没人把过关，出片时会如实说。
  const words = tokenize(query).filter((w) => w.length > 2);
  const titleScore = (p) => {
    if (!words.length) return 1;
    const t = String(p.title).toLowerCase();
    return words.filter((w) => t.includes(w)).length;
  };
  return pages.filter((p) => {
    const ii = p.imageinfo?.[0]; if (!/^video\//.test(ii?.mime ?? '') || titleScore(p) === 0) return false;
    // imageinfo 一直返回 duration，之前没读——所以 minDuration 对 Wikimedia 一直是空转，
    // 也没法在下载前把整部纪录片挡掉（我们只要三四秒）
    const d = Number(ii.duration ?? 0);
    return !d || (d >= minDuration && d <= maxDuration);
  }).sort((a, b) => titleScore(b) - titleScore(a)).slice(0, limit).map((p) => {
    const ii = p.imageinfo[0]; const em = ii.extmetadata ?? {}; const strip = (h) => String(h ?? '').replace(/<[^>]+>/g, '').trim();
    return { id: `wikimedia:${p.pageid}`, source: 'wikimedia', kind: 'video', file: null,
      url: wikimediaTranscoded(ii.url, ii.height) ?? ii.url, fallbackUrl: ii.url, thumb: ii.thumburl ?? null,
      width: ii.width, height: ii.height, duration: Number(ii.duration ?? 0) || null, bytes: Number(ii.size ?? 0) || null,
      license: strip(em.LicenseShortName?.value) || 'CC（见页面）', licenseUrl: em.LicenseUrl?.value ?? null, author: strip(em.Artist?.value) || null,
      page: ii.descriptionurl ?? `https://commons.wikimedia.org/?curid=${p.pageid}`, title: p.title };
  });
}

/**
 * Openverse（WordPress 维护的 CC 媒体聚合站，聚合 Flickr / rawpixel / 各大博物馆，**不要 key**）。
 *
 * 这个源上一版被我错误地否掉过：当时 Node 连它一律 ECONNRESET、curl 却能通，我判成"WAF 按 TLS 指纹
 * 拦 Node"。真实原因是本机设了 HTTPS_PROXY 而 Node 的 fetch 不认代理（见 src/net/proxy.mjs）。
 * 装上代理调度器后一次就通。留着这段注释，免得以后又有人照着错结论把它删掉。
 *
 * 排在 Commons 图片前面：语料大得多（Flickr 的日常照片正是口播要的"生活场景"），命中也更准。
 * 只要可商用 + 可改编的许可证：用户是要发到平台上的，NC（非商用）不能给他们埋雷；
 * 裁切推拉属于改编，ND（禁改）也要排除。服务端过滤之外本地再兜一道。
 */
export async function searchOpenverse(query, { limit = 3, fetchImpl = fetch } = {}) {
  const u = new URL('https://api.openverse.org/v1/images/');
  Object.entries({ q: query, page_size: String(Math.max(limit * 3, 9)), license_type: 'commercial,modification', mature: 'false' })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetchImpl(u, { headers: { 'User-Agent': UA } });
  if (r.status === 429) throw new StockRateLimit('Openverse 触发限速（匿名调用有配额），稍后再试');
  if (!r.ok) throw new Error(`Openverse ${r.status}`);
  const j = await r.json();
  const usable = (lic) => lic && !/\bnc\b/.test(lic) && !/\bnd\b/.test(lic);
  return (j.results ?? [])
    .filter((x) => x.url && usable(x.license) && (x.width ?? 0) >= 800 && (x.width / (x.height || 1)) >= 0.4 && (x.width / (x.height || 1)) <= 3.5)
    .slice(0, limit)
    .map((x) => ({
      id: `openverse:${x.id}`, source: 'openverse', kind: 'image', file: null,
      url: x.url, thumb: x.thumbnail ?? null, width: x.width, height: x.height, duration: null,
      license: licenseLabel(x.license, x.license_version),
      licenseUrl: x.license_url ?? null, author: x.creator ?? null,
      page: x.foreign_landing_url ?? x.detail_url ?? null, title: x.title ?? null,
    }));
}

/** Commons 缩略图地址换个宽度：.../thumb/a/ab/N.jpg/2400px-N.jpg → 640px-N.jpg（MediaWiki 按需生成） */
export const commonsThumbWidth = (url, px) => (url ? String(url).replace(/\/(\d+)px-/, `/${px}px-`) : null);

/**
 * Commons 的**图片**（同样不要 key，CC / 公有领域，需署名）。口播线的免 key 主力画面来源。
 *
 * 为什么图片比视频靠谱：同一个检索接口，Commons 的图片库大得多、命中也准得多。真机对比同一批词——
 * 图片：cat sleeping → "Sleeping cat on her back"；city night traffic → "Night-time traffic at Admiralty"；
 * 视频：cat box → "Wasp eating cat food"（标题里有 cat 就过了，配给了"猫为什么总爱钻纸箱"）。
 * 静图交给合成那边做缓推缓拉，成片观感远好过一段不相干的视频。
 *
 * 下的是 2400px 的派生图（几百 KB），不是动辄 6000×4000 的原图；排序用 640px 的那份。
 */
export async function searchWikimediaImages(query, { limit = 3, fetchImpl = fetch } = {}) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({ action: 'query', generator: 'search', gsrsearch: `filetype:bitmap ${query}`, gsrnamespace: '6',
    gsrlimit: String(Math.max(limit * 3, 9)), prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata',
    iiextmetadatafilter: 'LicenseShortName|Artist|Credit|LicenseUrl', iiurlwidth: '2400',
    format: 'json', origin: '*' }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetchImpl(u, { headers: { 'User-Agent': UA } });
  if (r.status === 429) throw new StockRateLimit('Wikimedia 触发限速，稍后再试');
  if (!r.ok) throw new Error(`Wikimedia ${r.status}`);
  const j = await r.json();
  const words = tokenize(query).filter((w) => w.length > 2);
  const titleScore = (p) => (!words.length ? 1 : words.filter((w) => String(p.title).toLowerCase().includes(w)).length);
  return Object.values(j.query?.pages ?? {})
    .filter((p) => {
      const ii = p.imageinfo?.[0];
      // svg/tif 之类交给 ffmpeg 会翻车；竖长条、细横条的图裁 9:16 也不能看
      if (!/^image\/(jpeg|png|webp)$/.test(ii?.mime ?? '') || titleScore(p) === 0) return false;
      const ratio = (ii.width ?? 0) / (ii.height ?? 1);
      return (ii.width ?? 0) >= 800 && ratio >= 0.4 && ratio <= 3.5;
    })
    .sort((a, b) => titleScore(b) - titleScore(a))
    .slice(0, limit)
    .map((p) => {
      const ii = p.imageinfo[0]; const em = ii.extmetadata ?? {}; const strip = (h) => String(h ?? '').replace(/<[^>]+>/g, '').trim();
      const big = ii.thumburl ?? ii.url;
      return { id: `wikimedia-img:${p.pageid}`, source: 'wikimedia', kind: 'image', file: null,
        url: big, fallbackUrl: ii.url, thumb: commonsThumbWidth(big, 640) ?? big,
        width: ii.thumbwidth ?? ii.width, height: ii.thumbheight ?? ii.height, duration: null,
        license: strip(em.LicenseShortName?.value) || 'CC（见页面）', licenseUrl: em.LicenseUrl?.value ?? null,
        author: strip(em.Artist?.value) || null,
        page: ii.descriptionurl ?? `https://commons.wikimedia.org/?curid=${p.pageid}`, title: p.title };
    });
}

/** 检索词逐级放宽：全句 → 前 3 词 → 前 2 词 → 最长的 1 个词（Wikimedia 是字面匹配，长句必空；Pexels 也偏爱短词） */
export function relaxQueries(query) {
  const stop = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'and', 'with', 'from', 'out', 'into', 'inside', 'close', 'up', 'view', 'shot', 'scene', 'cinematic', 'footage', 'video']);
  const words = String(query).toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((w) => w && !stop.has(w));
  const out = [String(query).trim()];
  if (words.length > 3) out.push(words.slice(0, 3).join(' '));
  if (words.length > 2) out.push(words.slice(0, 2).join(' '));
  if (words.length > 1) out.push(words[0]);   // 最后退到第一个实词——英文检索词里主体名词通常在最前（"cat …"），比"最长的词"靠谱
  return [...new Set(out.filter(Boolean))];
}

/** 统一入口：按顺序找候选，去掉本项目已用过的；全部为空时返回 []（调用方降级到 AI 配图 / 纯色底） */
export async function findCandidates(query, { localDirs = [], used = new Set(), limit = 3, minDuration = 0, fetchImpl = fetch, config = readConfig() } = {}) {
  const out = [];
  const push = (arr) => { for (const c of arr) if (!used.has(c.id) && !out.some((o) => o.id === c.id)) out.push(c); };
  push(searchLocal(query, { dirs: localDirs, limit }));
  if (out.length >= limit) return out.slice(0, limit);
  const tier = cacheTier(config);
  const cached = readCacheIndex(query, tier); if (cached) push(cached);
  if (out.length >= limit) return out.slice(0, limit);
  const errors = [];
  // 有 key 的视频源先用（画质/时长最可控）；没 key 时先试 CC **图片**（Openverse 语料大、Commons 兜底）——同一个站，
  // 图片库比视频库大得多也准得多（真机对比："cat sleeping" 图片给 Sleeping cat on her back，
  // 视频却把 Wasp eating cat food 配给了"猫钻纸箱"）。一张贴合的静图 + 缓推，好过一段不相干的视频。
  // 图片只取 2 条，给 Wikimedia 视频留一个位——让看图排序在"图 vs 视频"之间挑，而不是替它决定。
  // 顺序即优先级：不看图排序时第一条直接中选，所以最准的排最前。
  // 视频源夹在两个图片源中间而不是垫底——这样候选里一定有一条视频可选（图片源会把 3 个位子占满），
  // 开了看图排序时模型才有"图 vs 视频"可挑；没开时排在前面的图片会中选，这也正是我们想要的默认。
  const chain = [[searchPexels, { key: config.stock?.pexelsKey }], [searchPixabay, { key: config.stock?.pixabayKey }],
    [searchOpenverse, { limit: 2 }], [searchWikimedia, { limit: 1 }], [searchWikimediaImages, { limit: 2 }]];
  for (const [fn, extra] of chain) {
    if (out.length >= limit) break;
    if ('key' in extra && !extra.key) continue;
    for (const q of relaxQueries(query)) {
      // extra 放最后：每个源自己的 limit（比如图片源只取 2 条、给视频留位）必须能覆盖外层的总额，
      // 写成 { ...extra, limit } 的话 extra.limit 会被外层顶掉——那样"留一个位给视频"就是空话
      try { const r = await fn(q, { limit, minDuration, fetchImpl, ...extra }); push(r); if (r.length) { writeCacheIndex(query, r, tier); break; } }
      catch (e) { errors.push(e.message); if (e instanceof StockRateLimit) break; }
    }
  }
  if (!out.length && errors.length) throw new Error(`素材库检索失败：${errors.join('；')}`);
  return out.slice(0, limit);
}

/**
 * 下载候选到缓存（本地文件直接返回路径）。
 * 三条护栏，都是踩过的：Wikimedia 上有几百 MB 的纪录片（我们只用其中几秒）——超过 maxBytes 直接换下一条；
 * 网络挂住不能无限等——带超时；写 .part 再改名——中途被 Ctrl-C 不会在缓存里留下一个"看着像好的"半截文件。
 */
export async function materialize(candidate, { fetchImpl = fetch, maxBytes = 256 << 20, timeoutMs = 90_000 } = {}) {
  if (candidate.file) return candidate.file;
  if (!candidate.url) throw new Error(`候选 ${candidate.id} 没有可下载地址`);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const ext = (candidate.url.match(/\.(webm|ogv|ogg|mov|mp4|m4v|jpe?g|png|webp|gif)(\?|$)/i)?.[1]
    ?? (candidate.kind === 'image' ? 'jpg' : 'mp4')).toLowerCase();
  const dest = path.join(CACHE_DIR, `${candidate.id.replace(/[^a-z0-9]+/gi, '_')}.${ext}`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const part = `${dest}.${process.pid}.part`;
  try {
    // 首选转码版（小得多），Commons 没给这个文件生成过就回落到原文件
    let r = await fetchImpl(candidate.url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ac.signal });
    if (!r.ok && candidate.fallbackUrl && candidate.fallbackUrl !== candidate.url) r = await fetchImpl(candidate.fallbackUrl, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ac.signal });
    if (!r.ok) throw new Error(`下载素材失败 ${r.status}：${candidate.url}`);
    const declared = Number(r.headers?.get?.('content-length') || 0);
    if (declared > maxBytes) throw new StockTooLarge(`候选 ${candidate.id} 有 ${(declared / 1048576).toFixed(0)} MB，超过 ${(maxBytes / 1048576).toFixed(0)} MB 上限，换下一条`);
    let bytes = 0; const chunks = [];
    // 没有 content-length 的源（Wikimedia 常见）边收边数，超了立刻断
    for await (const chunk of r.body) {
      bytes += chunk.length;
      if (bytes > maxBytes) { ac.abort(); throw new StockTooLarge(`候选 ${candidate.id} 下载超过 ${(maxBytes / 1048576).toFixed(0)} MB 上限，换下一条`); }
      chunks.push(Buffer.from(chunk));
    }
    if (!bytes) throw new Error(`候选 ${candidate.id} 下载到 0 字节`);
    fs.writeFileSync(part, Buffer.concat(chunks));
    fs.renameSync(part, dest);
    return dest;
  } catch (e) {
    fs.rmSync(part, { force: true });
    if (e?.name === 'AbortError' && !(e instanceof StockTooLarge)) throw new Error(`下载素材超时（${timeoutMs / 1000}s）：${candidate.url}`);
    throw e;
  } finally { clearTimeout(timer); }
}

/** 按顺序试候选，返回第一条下载成功的 { candidate, file }；全失败返回 null（失败原因进 notes） */
export async function materializeFirst(candidates, { fetchImpl = fetch, onError = () => {} } = {}) {
  for (const c of candidates) {
    try { return { candidate: c, file: await materialize(c, { fetchImpl }) }; }
    catch (e) { onError(c, e); }
  }
  return null;
}

/** "cc0" / "pdm" 本身就是完整名字，别再前缀一个 CC 变成 "CC CC0" */
export const licenseLabel = (lic, ver) => {
  const L = String(lic ?? '').toUpperCase();
  return `${/^(CC0|PDM)/.test(L) ? L : `CC ${L}`} ${ver ?? ''}`.trim();
};

export class StockRateLimit extends Error {}
export class StockTooLarge extends Error {}
export const tokenize = (q) => String(q).toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((w) => w.length > 1);
function* walk(dir) { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); const st = fs.statSync(p); if (st.isDirectory()) yield* walk(p); else yield p; } }
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
/**
 * 缓存按"当前配了哪些素材库 key"分桶。否则会出现这种事：用户今天 0 key 跑了一遍（存的是 Wikimedia 结果），
 * 明天注册了 Pexels key，同样的检索词却在 7 天内一直命中旧缓存，说好的"配了 key 画面更好"根本没生效。
 */
// 缓存里存的是整个候选对象（含格式化好的许可证文案等派生字段），所以候选的字段或格式一变，
// 旧缓存就会把老样子带回来（真机上"CC CC0"修完又从缓存里冒出来一次）。改结构就把版本号 +1。
const CACHE_VERSION = 2;
export function cacheTier(config) { return `v${CACHE_VERSION}-${[config?.stock?.pexelsKey && 'px', config?.stock?.pixabayKey && 'pb'].filter(Boolean).join('-') || 'free'}`; }
function cacheIndexFile(query, tier = 'free') { return path.join(CACHE_DIR, 'index', `${tier}-${hash(query.toLowerCase().trim())}.json`); }
function readCacheIndex(query, tier) { try { const j = JSON.parse(fs.readFileSync(cacheIndexFile(query, tier), 'utf-8')); return Date.now() - j.at < 7 * 86400e3 ? j.items : null; } catch { return null; } }
function writeCacheIndex(query, items, tier) { try { fs.mkdirSync(path.dirname(cacheIndexFile(query, tier)), { recursive: true }); fs.writeFileSync(cacheIndexFile(query, tier), JSON.stringify({ at: Date.now(), items })); } catch { /* 缓存失败不影响主流程 */ } }
export const cacheDir = () => CACHE_DIR;
export const homeDir = () => os.homedir();
