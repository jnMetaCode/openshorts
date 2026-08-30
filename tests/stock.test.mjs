import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.OPENSHORTS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'os-home-'));   // 测试不碰真实 ~/.openshorts（缓存会污染断言）
const { searchLocal, searchPexels, searchWikimedia, findCandidates, StockRateLimit, StockTooLarge, relaxQueries, cacheTier, materialize, materializeFirst } = await import('../src/sources/stock.mjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-stock-'));
fs.writeFileSync(path.join(dir, 'cat_cardboard_box.mp4'), 'x');
fs.writeFileSync(path.join(dir, 'city night.mp4'), 'x');
fs.writeFileSync(path.join(dir, 'city night.txt'), 'traffic timelapse neon');
fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');

test('本地素材夹：按文件名与同名 .txt 标签匹配，非视频不入选', () => {
  const r = searchLocal('cat inside cardboard box', { dirs: [dir] });
  assert.equal(r[0].file, path.join(dir, 'cat_cardboard_box.mp4'));
  assert.equal(r[0].license, 'user-owned');
  const r2 = searchLocal('neon traffic', { dirs: [dir] });
  assert.equal(path.basename(r2[0].file), 'city night.mp4');
});

test('Pexels：解析结果、选 720–1920 高的 mp4、限额 429 抛 StockRateLimit', async () => {
  const fetchImpl = async (u) => ({ ok: true, status: 200, json: async () => ({ videos: [{ id: 1, duration: 12, width: 1080, height: 1920, url: 'p', user: { name: 'A', url: 'u' }, video_files: [{ file_type: 'video/mp4', height: 2160, width: 3840, link: 'big' }, { file_type: 'video/mp4', height: 1920, width: 1080, link: 'ok' }] }] }) });
  const r = await searchPexels('cat', { key: 'k', fetchImpl });
  assert.equal(r[0].url, 'ok'); assert.equal(r[0].license, 'Pexels License'); assert.equal(r[0].author, 'A');
  await assert.rejects(() => searchPexels('cat', { key: 'k', fetchImpl: async () => ({ ok: false, status: 429 }) }), StockRateLimit);
  assert.deepEqual(await searchPexels('cat', { key: '' }), []);
});

test('findCandidates：本地优先、去重、无 key 无本地时返回空而不是抛', async () => {
  const used = new Set();
  const none = async () => ({ ok: true, status: 200, json: async () => ({ query: { pages: {} } }) });
  const a = await findCandidates('cat cardboard box', { localDirs: [dir], used, config: { stock: {} }, fetchImpl: none });
  assert.equal(a[0].source, 'local-folder'); used.add(a[0].id);
  const b = await findCandidates('cat cardboard box', { localDirs: [dir], used, config: { stock: {} }, fetchImpl: none });
  assert.ok(!b.some((c) => c.id === a[0].id));
  const c = await findCandidates('nothing matches xyz', { localDirs: [dir], config: { stock: {} }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ query: { pages: {} } }) }) });
  assert.deepEqual(c, []);
});

test('Wikimedia（免 key）：解析视频页、带 CC 许可与作者；无任何 key 时作为兜底进入候选', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ query: { pages: { 1: { pageid: 1, title: 'File:cat a.webm', imageinfo: [{ url: 'https://upload.wikimedia.org/a.webm', mime: 'video/webm', width: 1920, height: 1080, descriptionurl: 'https://commons.wikimedia.org/wiki/File:a.webm', extmetadata: { LicenseShortName: { value: 'CC BY-SA 3.0' }, Artist: { value: '<a href="x">Kluse</a>' } } }] }, 2: { pageid: 2, title: 'File:b.jpg', imageinfo: [{ url: 'u', mime: 'image/jpeg' }] } } } }) });
  const r = await searchWikimedia('cat', { fetchImpl });
  assert.equal(r.length, 1, '标题不含查询词的（b.jpg 且非视频）被过滤'); assert.equal(r[0].license, 'CC BY-SA 3.0'); assert.equal(r[0].author, 'Kluse'); assert.equal(r[0].source, 'wikimedia');
  const c = await findCandidates('cat', { config: { stock: {} }, fetchImpl });
  assert.equal(c[0]?.source, 'wikimedia', '没 key 也有候选');
});

test('检索词逐级放宽：去停用词，全句 → 3 词 → 2 词 → 最长词', () => {
  assert.deepEqual(relaxQueries('cat peeking out of cardboard box eyes'), ['cat peeking out of cardboard box eyes', 'cat peeking cardboard', 'cat peeking', 'cat']);
  assert.deepEqual(relaxQueries('cat'), ['cat']);
});

test('Wikimedia 相关性：标题不含任何查询实词的结果被丢弃', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ query: { pages: { 1: { pageid: 1, title: 'File:Office hours.webm', imageinfo: [{ url: 'u', mime: 'video/webm' }] }, 2: { pageid: 2, title: 'File:Lotti the cat in a box.webm', imageinfo: [{ url: 'u2', mime: 'video/webm', extmetadata: {} }] } } } }) });
  const r = await searchWikimedia('cat cardboard', { fetchImpl });
  assert.deepEqual(r.map((x) => x.id), ['wikimedia:2']);
});


test('缓存按"配了哪些 key"分桶：新配了 Pexels key 之后不能再吃 0-key 时代的旧缓存', async () => {
  assert.equal(cacheTier({ stock: {} }), 'free');
  assert.equal(cacheTier({ stock: { pexelsKey: 'k' } }), 'px');
  assert.equal(cacheTier({ stock: { pexelsKey: 'k', pixabayKey: 'j' } }), 'px-pb');

  const wiki = { query: { pages: { 1: { pageid: 1, title: 'File:Cat in box.webm', imageinfo: [{ url: 'https://x/a.webm', mime: 'video/webm', extmetadata: {} }] } } } };
  const noKey = await findCandidates('cat box', { config: { stock: {} }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => wiki }) });
  assert.equal(noKey[0].source, 'wikimedia');

  // 同一个检索词，这次配了 Pexels key：必须真的去问 Pexels，而不是命中刚才那条缓存
  let askedPexels = false;
  const withKey = await findCandidates('cat box', {
    config: { stock: { pexelsKey: 'k' } },
    fetchImpl: async (u) => {
      if (String(u).includes('pexels')) { askedPexels = true; return { ok: true, status: 200, json: async () => ({ videos: [{ id: 9, duration: 10, video_files: [{ file_type: 'video/mp4', link: 'https://x/p.mp4', height: 1080 }], user: { name: 'A' }, url: 'https://p' }] }) }; }
      return { ok: true, status: 200, json: async () => wiki };
    },
  });
  assert.ok(askedPexels, '配了 key 就该去问 Pexels');
  assert.equal(withKey[0].source, 'pexels', '有 key 时优先用 key 源，不能被旧缓存挡住');
});

test('下载素材：超过体积上限直接换下一条，不把几百 MB 的纪录片吞进内存', async () => {
  const big = { id: 'wikimedia:1', url: 'https://x/huge.webm' };
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: (h) => (h === 'content-length' ? String(400 * 1048576) : null) }, body: (async function* () { yield Buffer.alloc(1); })() });
  await assert.rejects(() => materialize(big, { fetchImpl, maxBytes: 256 << 20 }), StockTooLarge);
});

test('materializeFirst：第一条取不到就顺位试下一条，不直接掉进纯色底', async () => {
  const okBody = (async function* () { yield Buffer.from('video-bytes'); })();
  const fetchImpl = async (url) => (String(url).includes('bad')
    ? { ok: false, status: 404, headers: { get: () => null } }
    : { ok: true, status: 200, headers: { get: () => null }, body: okBody });
  const errs = [];
  const got = await materializeFirst([{ id: 'a:1', url: 'https://x/bad.mp4' }, { id: 'a:2', url: 'https://x/good.mp4' }], { fetchImpl, onError: (c, e) => errs.push(c.id) });
  assert.equal(got.candidate.id, 'a:2');
  assert.deepEqual(errs, ['a:1']);
});
