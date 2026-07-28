import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyzeProject, mediaSummaryFromProbe} from '../scripts/lib/quality.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = JSON.parse(fs.readFileSync(path.join(root, 'projects', 'sample.json'), 'utf8'));

test('ffprobe 输出可归一化为媒体摘要', () => {
  const media = mediaSummaryFromProbe({streams: [{codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '30/1'}, {codec_type: 'audio', codec_name: 'aac'}], format: {duration: '11.05', size: '1000'}});
  assert.deepEqual(media, {duration: 11.05, size: 1000, width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac'});
});

test('示例项目通过结构和素材质检', () => {
  const result = analyzeProject({project, publicDir: path.join(root, 'public'), media: {duration: 11.05, size: 1000, width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac'}});
  assert.equal(result.errors.length, 0);
  assert.equal(result.status, 'passed');
});

test('质检能发现字幕越界和缺失素材', () => {
  const broken = structuredClone(project);
  broken.scenes[0].captions[0].toFrame = 999;
  broken.scenes[0].layers[0].src = 'missing.png';
  const result = analyzeProject({project: broken, publicDir: path.join(root, 'public'), media: {duration: 11, size: 1, width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: null}});
  assert.ok(result.errors.some((item) => item.includes('超出镜头范围')));
  assert.ok(result.errors.some((item) => item.includes('素材不存在')));
});
