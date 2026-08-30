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
    id: `local:${hash(h.file)}`, source: 'local-folder', file: h.file, url: null, width: null, height: null, duration: null,
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
    return { id: `pexels:${v.id}`, source: 'pexels', file: null, url: best?.link ?? null, width: best?.width ?? v.width, height: best?.height ?? v.height, duration: v.duration, license: 'Pexels License', author: v.user?.name ?? null, authorUrl: v.user?.url ?? null, page: v.url };
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
    return { id: `pixabay:${v.id}`, source: 'pixabay', file: null, url: f?.url ?? null, width: f?.width, height: f?.height, duration: v.duration, license: 'Pixabay Content License', author: v.user ?? null, page: v.pageURL };
  });
}

/**
 * Wikimedia Commons（不要 key！CC / 公有领域，需署名）：真正零配置的免费素材源。
 * 检索 `filetype:video`，多为 webm/ogv，ffmpeg 都能吃；署名信息进 provenance（CC BY-SA 要求）。
 */
export async function searchWikimedia(query, { limit = 3, fetchImpl = fetch } = {}) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({ action: 'query', generator: 'search', gsrsearch: `filetype:video ${query}`, gsrnamespace: '6', gsrlimit: String(Math.max(limit * 3, 9)), prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist|Credit|LicenseUrl', format: 'json', origin: '*' }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetchImpl(u, { headers: { 'User-Agent': UA } });
  if (r.status === 429) throw new StockRateLimit('Wikimedia 触发限速，稍后再试');
  if (!r.ok) throw new Error(`Wikimedia ${r.status}`);
  const j = await r.json();
  const pages = Object.values(j.query?.pages ?? {});
  // Wikimedia 的全文检索会命中描述里的任意词（"cardboard spectrometer"），要求标题里至少含一个查询实词，否则宁可空着让上层换词/降级
  const words = tokenize(query).filter((w) => w.length > 2);
  const relevant = (p) => !words.length || words.some((w) => String(p.title).toLowerCase().includes(w));
  return pages.filter((p) => /^video\//.test(p.imageinfo?.[0]?.mime ?? '') && relevant(p)).slice(0, limit).map((p) => {
    const ii = p.imageinfo[0]; const em = ii.extmetadata ?? {}; const strip = (h) => String(h ?? '').replace(/<[^>]+>/g, '').trim();
    return { id: `wikimedia:${p.pageid}`, source: 'wikimedia', file: null, url: ii.url, width: ii.width, height: ii.height, duration: null, license: strip(em.LicenseShortName?.value) || 'CC（见页面）', licenseUrl: em.LicenseUrl?.value ?? null, author: strip(em.Artist?.value) || null, page: ii.descriptionurl ?? `https://commons.wikimedia.org/?curid=${p.pageid}`, title: p.title };
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
  const cached = readCacheIndex(query); if (cached) push(cached);
  if (out.length >= limit) return out.slice(0, limit);
  const errors = [];
  // 有 key 的先用（画质/时长更可控），没 key 时 Wikimedia 兜底——所以"没注册任何 key"也能出第一条片
  const chain = [[searchPexels, { key: config.stock?.pexelsKey }], [searchPixabay, { key: config.stock?.pixabayKey }], [searchWikimedia, {}]];
  for (const [fn, extra] of chain) {
    if (out.length >= limit) break;
    if ('key' in extra && !extra.key) continue;
    for (const q of relaxQueries(query)) {
      try { const r = await fn(q, { ...extra, limit, minDuration, fetchImpl }); push(r); if (r.length) { writeCacheIndex(query, r); break; } }
      catch (e) { errors.push(e.message); if (e instanceof StockRateLimit) break; }
    }
  }
  if (!out.length && errors.length) throw new Error(`素材库检索失败：${errors.join('；')}`);
  return out.slice(0, limit);
}

/** 下载候选到缓存（本地文件直接返回路径） */
export async function materialize(candidate, { fetchImpl = fetch } = {}) {
  if (candidate.file) return candidate.file;
  if (!candidate.url) throw new Error(`候选 ${candidate.id} 没有可下载地址`);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const ext = (candidate.url.match(/\.(webm|ogv|ogg|mov|mp4|m4v)(\?|$)/i)?.[1] ?? 'mp4').toLowerCase();
  const dest = path.join(CACHE_DIR, `${candidate.id.replace(/[^a-z0-9]+/gi, '_')}.${ext}`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const r = await fetchImpl(candidate.url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`下载素材失败 ${r.status}：${candidate.url}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return dest;
}

export class StockRateLimit extends Error {}
export const tokenize = (q) => String(q).toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((w) => w.length > 1);
function* walk(dir) { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); const st = fs.statSync(p); if (st.isDirectory()) yield* walk(p); else yield p; } }
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
function cacheIndexFile(query) { return path.join(CACHE_DIR, 'index', `${hash(query.toLowerCase().trim())}.json`); }
function readCacheIndex(query) { try { const j = JSON.parse(fs.readFileSync(cacheIndexFile(query), 'utf-8')); return Date.now() - j.at < 7 * 86400e3 ? j.items : null; } catch { return null; } }
function writeCacheIndex(query, items) { try { fs.mkdirSync(path.dirname(cacheIndexFile(query)), { recursive: true }); fs.writeFileSync(cacheIndexFile(query), JSON.stringify({ at: Date.now(), items })); } catch { /* 缓存失败不影响主流程 */ } }
export const cacheDir = () => CACHE_DIR;
export const homeDir = () => os.homedir();
