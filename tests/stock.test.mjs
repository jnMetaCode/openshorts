import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.OPENSHORTS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'os-home-'));   // 测试不碰真实 ~/.openshorts（缓存会污染断言）
const { searchLocal, searchPexels, searchWikimedia, findCandidates, StockRateLimit, relaxQueries } = await import('../src/sources/stock.mjs');

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
