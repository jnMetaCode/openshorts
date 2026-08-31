import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderSegment, concatSegments, audioPackets, probeDuration, escapeFilterPath, concatListLine, imageLayout } from '../src/compose/koubo.mjs';

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

/**
 * Windows 路径进 ffmpeg 滤镜图和 concat 清单，两边都会被反斜杠转义吃掉。
 * mac 上反而不容易发现——Homebrew 的 ffmpeg 没有 libass，根本走不到烧字幕那条分支；
 * 而 Windows 上 winget / gyan 装的都带 libass，一定会走到。
 */
test('滤镜图里的路径：Windows 反斜杠要换成正斜杠，冒号要转义', () => {
  assert.equal(escapeFilterPath('C:\\Users\\yx\\work\\captions.ass', 'win32'), 'C\\:/Users/yx/work/captions.ass');
  assert.equal(escapeFilterPath('/Users/yx/中文 目录/captions.ass', 'darwin'), '/Users/yx/中文 目录/captions.ass', 'POSIX 路径不该被动');
  assert.equal(escapeFilterPath("/tmp/it's/x.ass", 'darwin'), "/tmp/it\\'s/x.ass");
  // POSIX 下文件名里可以合法地带反斜杠，不能一律换成斜杠
  assert.equal(escapeFilterPath('/tmp/a\\b.ass', 'darwin'), '/tmp/a\\\\b.ass');
});

test('concat 清单行：同一个坑的另一半（它自己的解析器里反斜杠也是转义符）', () => {
  assert.equal(concatListLine('C:\\Users\\yx\\a.mp4', 'win32'), "file 'C:/Users/yx/a.mp4'");
  assert.equal(concatListLine('/tmp/a.mp4', 'darwin'), "file '/tmp/a.mp4'");
  assert.equal(concatListLine("/tmp/it's.mp4", 'darwin'), "file '/tmp/it'\\''s.mp4'");
});

/**
 * 图片在竖屏里的取景。两个极端都不行：铺满裁切会把主体切掉（真机：横构图的猫，猫脸裁在框外）；
 * 完整放下又把 3:2 的横图压成只占 37.5% 高度的一条窄带，手机上看不清是什么（真机截图确认）。
 */
test('图片取景：横图放大到看得清，但放大倍数有上限；竖图/方图不受影响', () => {
  const W = 1080, H = 1920;
  const land = imageLayout(1024, 683, W, H);          // 就是真机那张
  assert.ok(land.fill > 0.5 && land.fill < 0.6, `3:2 横图该占五成多，实际 ${(land.fill * 100).toFixed(0)}%`);
  assert.ok(1 - land.cropW / land.scaleW <= 0.32, '最多裁掉三成宽度，再多主体就保不住了');
  assert.ok(land.y > 0 && land.y + land.cropH < H * 0.75, '压在偏上，下面留给字幕');

  const gen = imageLayout(576, 1024, W, H);            // 本机出图就是 9:16
  assert.equal(gen.fill, 1, '9:16 的图该铺满');
  assert.equal(gen.cropW, W);

  const tall = imageLayout(683, 1024, W, H);
  assert.ok(tall.fill > 0.8, '竖图本来就该占大部分高度');
  assert.equal(1 - tall.cropW / tall.scaleW, 0, '竖图不该被裁宽度');

  // 极扁的横图：放大上限保护它不被裁没，代价是占不满——这是有意的，不是漏掉
  const strip = imageLayout(2400, 1000, W, H);
  assert.ok(1 - strip.cropW / strip.scaleW <= 0.32);

  for (const [iw, ih] of [[1024, 683], [576, 1024], [1200, 1200], [2400, 1000]]) {
    const L = imageLayout(iw, ih, W, H);
    assert.equal(L.scaleW % 2, 0, 'libx264 要偶数宽');
    assert.equal(L.scaleH % 2, 0, 'libx264 要偶数高');
    assert.ok(L.cropW <= W && L.cropH <= H, '裁出来不能比画面还大');
  }
});
