import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderSegment, concatSegments, audioPackets, probeDuration } from '../src/compose/koubo.mjs';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/**
 * 这条测试挡的是一个真出过事的坑：renderSegment 早先同时用 -vf 和 -filter_complex，
 * 在 ffmpeg 6.x 上会**静默**丢掉音频——退出码 0、无警告、输出里 audio 流声明还在但一个包都没有。
 * ffmpeg 8 上恰好正常，所以只在别人机器上炸（Ubuntu 24.04 / Debian 12 默认就是 6.x）。
 */
test('分段渲染必须真的带上声音（ffmpeg 6.x 上曾静默丢音轨）', { skip: !hasFfmpeg && '无 ffmpeg' }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'os-seg-'));
  const clip = path.join(d, 'clip.mp4'), audio = path.join(d, 'a.m4a'), out = path.join(d, 'seg.mp4');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=navy:size=320x240:rate=10:d=1', '-pix_fmt', 'yuv420p', clip]);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'aac', audio]);

  await renderSegment({ clip, audio, durationSec: 2, w: 270, h: 480, fps: 12, out });
  assert.ok(await audioPackets(out) > 0, '分段里必须有音频包');
  assert.ok(Math.abs((await probeDuration(out)) - 2) < 0.25, '时长跟着配音走');

  // 素材比配音短时靠 -stream_loop 补足，不能因此把时长或音轨搞丢
  const joined = await concatSegments([out, out], path.join(d, 'j.mp4'));
  assert.ok(await audioPackets(joined) > 0, '拼接后音轨还在');
  fs.rmSync(d, { recursive: true, force: true });
});

/**
 * 图片素材不能像视频那样裁满屏：真机试过，一张横构图的猫在纸箱里，裁 9:16 正好把猫脸切在框外。
 * 所以图片走「完整图居中 + 自身放大虚化垫底」，主体一定不丢。这条守住"图片路径能出片且有声音"。
 */
test('图片素材出得来分段：完整图居中、虚化垫底、时长跟着配音', { skip: !hasFfmpeg && '无 ffmpeg' }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'os-img-'));
  const img = path.join(d, 'p.jpg'), audio = path.join(d, 'a.m4a'), out = path.join(d, 'seg.mp4');
  // 故意用横构图：这正是裁 9:16 会出事的形状
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1200x800:d=1', '-frames:v', '1', img]);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'aac', audio]);

  await renderSegment({ clip: img, audio, durationSec: 2, w: 270, h: 480, fps: 12, out, kind: 'image' });
  assert.ok(await audioPackets(out) > 0, '图片分段也要带声音');
  assert.ok(Math.abs((await probeDuration(out)) - 2) < 0.25, '时长跟着配音走，不会因为图是静止的就只出一帧');

  // 反向平移的那一半也要能渲染（表达式里带负号，写错就整条挂）
  const rev = path.join(d, 'rev.mp4');
  await renderSegment({ clip: img, audio, durationSec: 2, w: 270, h: 480, fps: 12, out: rev, kind: 'image', panReverse: true });
  assert.ok(await audioPackets(rev) > 0);
  fs.rmSync(d, { recursive: true, force: true });
});
