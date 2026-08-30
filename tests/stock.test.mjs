import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchLocal, searchPexels, searchWikimedia, findCandidates, StockRateLimit } from '../src/sources/stock.mjs';

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
  const a = await findCandidates('cat cardboard box', { localDirs: [dir], used, config: { stock: {} } });
  assert.equal(a[0].source, 'local-folder'); used.add(a[0].id);
  const b = await findCandidates('cat cardboard box', { localDirs: [dir], used, config: { stock: {} } });
  assert.ok(!b.some((c) => c.id === a[0].id));
  const c = await findCandidates('nothing matches xyz', { localDirs: [dir], config: { stock: {} } });
  assert.deepEqual(c, []);
});

test('Wikimedia（免 key）：解析视频页、带 CC 许可与作者；无任何 key 时作为兜底进入候选', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ query: { pages: { 1: { pageid: 1, title: 'File:a.webm', imageinfo: [{ url: 'https://upload.wikimedia.org/a.webm', mime: 'video/webm', width: 1920, height: 1080, descriptionurl: 'https://commons.wikimedia.org/wiki/File:a.webm', extmetadata: { LicenseShortName: { value: 'CC BY-SA 3.0' }, Artist: { value: '<a href="x">Kluse</a>' } } }] }, 2: { pageid: 2, title: 'File:b.jpg', imageinfo: [{ url: 'u', mime: 'image/jpeg' }] } } } }) });
  const r = await searchWikimedia('cat', { fetchImpl });
  assert.equal(r.length, 1); assert.equal(r[0].license, 'CC BY-SA 3.0'); assert.equal(r[0].author, 'Kluse'); assert.equal(r[0].source, 'wikimedia');
  const c = await findCandidates('cat', { config: { stock: {} }, fetchImpl });
  assert.equal(c[0]?.source, 'wikimedia', '没 key 也有候选');
});
