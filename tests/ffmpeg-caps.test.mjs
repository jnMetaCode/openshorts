import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'os-ffhome-'));
process.env.OPENSHORTS_HOME = HOME;
const { ffmpegAssetName, ffmpegPath, ffprobePath, managedPath } = await import('../src/media/ffmpeg.mjs');

test('预编译资源名覆盖本项目支持的平台，不支持的返回 null', () => {
  assert.equal(ffmpegAssetName('ffmpeg', 'darwin', 'arm64'), 'ffmpeg-darwin-arm64.gz');
  assert.equal(ffmpegAssetName('ffprobe', 'darwin', 'x64'), 'ffprobe-darwin-x64.gz');
  assert.equal(ffmpegAssetName('ffmpeg', 'win32', 'x64'), 'ffmpeg-win32-x64.gz');
  assert.equal(ffmpegAssetName('ffmpeg', 'linux', 'arm64'), 'ffmpeg-linux-arm64.gz');
  assert.equal(ffmpegAssetName('ffmpeg', 'win32', 'arm64'), null, '上游不出 win-arm64，别装一个跑不起来的');
});

test('ffmpeg 解析优先级：环境变量 > 自己装的 > PATH', () => {
  delete process.env.OPENSHORTS_FFMPEG; delete process.env.AO_FFMPEG;
  delete process.env.OPENSHORTS_FFPROBE; delete process.env.AO_FFPROBE;
  assert.equal(ffmpegPath(), 'ffmpeg', '什么都没有时用 PATH 里的');

  fs.mkdirSync(path.dirname(managedPath('ffmpeg')), { recursive: true });
  fs.writeFileSync(managedPath('ffmpeg'), ''); fs.writeFileSync(managedPath('ffprobe'), '');
  assert.equal(ffmpegPath(), managedPath('ffmpeg'), '装过就用自己那份，不动系统 ffmpeg');
  assert.equal(ffprobePath(), managedPath('ffprobe'));

  process.env.OPENSHORTS_FFMPEG = '/custom/ffmpeg';
  assert.equal(ffmpegPath(), '/custom/ffmpeg', '用户显式指定的最优先');
  delete process.env.OPENSHORTS_FFMPEG;
});
