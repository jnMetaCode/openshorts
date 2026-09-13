import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

/**
 * install-ffmpeg 钉版本 + 校验。以前追 releases/latest 且不校验——同一条命令两天装出两个版本，
 * 代理给个坏文件也照样装上，然后在"ffmpeg 跑不起来"那一步才炸。
 * 这里用假 fetch：不联网、不动真实的 ~/.openshorts。
 */
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'os-ffpin-'));
process.env.OPENSHORTS_HOME = HOME;
const { FFMPEG_PIN, ffmpegAssetName, fetchGzBinary, installFfmpeg } = await import('../src/media/ffmpeg.mjs');

const gz = (text) => zlib.gzipSync(Buffer.from(text));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const fakeFetch = (body, calls = []) => async (url) => { calls.push(String(url)); return { ok: true, status: 200, headers: { get: () => String(body.length) }, body: new Blob([body]).stream() }; };

test('钉死的版本表覆盖本项目支持的每个平台资产，哈希都是 64 位十六进制', () => {
  assert.match(FFMPEG_PIN.tag, /^b\d+\.\d+/);
  for (const kind of ['ffmpeg', 'ffprobe']) for (const [p, a] of [['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'arm64'], ['linux', 'x64'], ['win32', 'x64']]) {
    const name = ffmpegAssetName(kind, p, a);
    assert.match(FFMPEG_PIN.sha256[name] ?? '', /^[0-9a-f]{64}$/, `${name} 缺哈希——这个平台的用户会装不上`);
  }
});

test('fetchGzBinary：哈希对得上就解压落盘；对不上就删掉、不留 .part、抛错说清', async () => {
  const body = gz('#!/bin/sh\necho fake\n');
  const ok = path.join(HOME, 'ok', 'ffmpeg');
  await fetchGzBinary('https://x/ffmpeg-test.gz', ok, { fetchImpl: fakeFetch(body), expectedSha256: sha(body) });
  assert.equal(fs.readFileSync(ok, 'utf-8'), '#!/bin/sh\necho fake\n', '落盘的是解压后的内容');

  const bad = path.join(HOME, 'bad', 'ffmpeg');
  await assert.rejects(() => fetchGzBinary('https://x/ffmpeg-test.gz', bad, { fetchImpl: fakeFetch(body), expectedSha256: 'f'.repeat(64) }), /校验不过.*ffffffffffff/s);
  assert.equal(fs.existsSync(bad), false, '坏文件不能落到目标位置');
  assert.deepEqual(fs.readdirSync(path.join(HOME, 'bad')), [], '也不能留 .part');
});

test('installFfmpeg 不再问 GitHub API 要 latest：直接下钉死的那个 tag', async () => {
  const calls = [];
  // 假二进制跑不起来，安装会在"装完了但跑不起来"这步失败——这里只看它下了什么
  const name = ffmpegAssetName('ffmpeg');
  if (!name) return;   // 上游不出这个平台的包（如 win-arm64），装不了是预期行为
  const bin = gz('not really ffmpeg');
  const origPin = FFMPEG_PIN.sha256[name]; FFMPEG_PIN.sha256[name] = sha(bin);
  try { await assert.rejects(() => installFfmpeg({ kinds: ['ffmpeg'], fetchImpl: fakeFetch(bin, calls) }), /跑不起来|校验/); }
  finally { FFMPEG_PIN.sha256[name] = origPin; }
  assert.equal(calls.some((u) => u.includes('api.github.com')), false, '不该再查 releases/latest');
  assert.equal(calls.length, 1); assert.ok(calls[0].includes(`/download/${FFMPEG_PIN.tag}/${name}`), calls[0]);
});
