import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkKoubo } from '../src/quality/check.mjs';
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('口播质检：分辨率/时长/音轨/响度/字幕/封面/AI 标识逐项报事实', { skip: !hasFfmpeg && '无 ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-q-'));
  const f = path.join(dir, 'x.mp4');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:size=1080x1920:rate=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata', 'comment=contains AI-generated content', '-shortest', f]);
  const project = { output: { w: 1080, h: 1920 }, shots: [{ durationSec: 1.5, status: 'ready', visual: { source: 'solid' } }, { durationSec: 1.5, status: 'ready', visual: { source: 'stock' } }], final: { file: f, cover: null } };
  const q = await checkKoubo(project, { burnedCaptions: false });
  const by = Object.fromEntries(q.items.map((i) => [i.id, i]));
  assert.equal(by.resolution.status, 'pass'); assert.equal(by.duration.status, 'pass'); assert.equal(by.audio.status, 'pass');
  assert.equal(by['ai-label'].status, 'pass'); assert.equal(by.cover.status, 'warn'); assert.equal(by.solid.status, 'warn');
  assert.ok(['pass', 'warn'].includes(by.loudness.status));
  // 字幕没烧进画面 = 抖音/视频号上观众看不到字，纯色底的镜头就是空屏——这是硬伤，不是提醒
  assert.equal(by.captions.status, 'fail', '字幕烧不进画面必须是 fail');
  assert.equal(q.pass, false, '没有可见字幕的片子不算通过');
  const burned = await checkKoubo(project, { burnedCaptions: true });
  assert.equal(burned.items.find((i) => i.id === 'captions').status, 'pass');
  assert.equal(burned.pass, true);
  const bad = await checkKoubo({ ...project, output: { w: 1920, h: 1080 } });
  assert.equal(bad.pass, false);
});
