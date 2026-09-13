import test from 'node:test';
import assert from 'node:assert/strict';
import { startStopwatch, elapsedText, humanDuration } from '../src/core/stopwatch.mjs';

/**
 * 休眠靠"事件循环断片"识别：用 Atomics.wait 把循环卡住模拟合盖（真休眠时定时器同样不跑、醒来
 * Date.now 同样跳），阈值缩小到 100 ms 好在测试里跑。变异检查：去掉 gap 扣减，第一条红。
 */
const block = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('中途"睡" 300 ms：从活跃时间里扣掉，并单独报出来', async () => {
  const sw = startStopwatch({ tickMs: 20, gapMs: 100 });
  await sleep(120);          // 正常跑一段，tick 在走
  block(300);                // 机器"睡"了：定时器不跑，Date.now 跳 300
  await sleep(120);
  const r = sw.stop();
  assert.ok(r.suspendedMs >= 200 && r.suspendedMs <= 400, `休眠应约 300 ms，得到 ${r.suspendedMs}`);
  assert.ok(r.activeMs < r.wallMs - 200, `活跃时间 ${r.activeMs} 应明显小于墙上时间 ${r.wallMs}`);
  assert.ok(r.activeMs >= 200 && r.activeMs <= 400, `活跃时间应约 240 ms，得到 ${r.activeMs}`);
});

test('没睡：活跃时间 = 墙上时间，休眠为 0', async () => {
  const sw = startStopwatch({ tickMs: 20, gapMs: 100 });
  await sleep(150);
  const r = sw.stop();
  assert.equal(r.suspendedMs, 0);
  assert.equal(r.activeMs, r.wallMs);
});

test('文案：睡过才补那一句；单位按量级换', () => {
  assert.equal(elapsedText({ activeMs: 35_000, suspendedMs: 0 }), '35 秒');
  assert.equal(elapsedText({ activeMs: 600_000, suspendedMs: 38_880_000 }), '10 分钟（另有 10.8 小时机器在休眠，未计入）');
  assert.equal(elapsedText({ activeMs: 600_000, suspendedMs: 38_880_000 }, 'en'), '10 min (plus 10.8 h while the machine was asleep, not counted)');
  assert.equal(humanDuration(89_000), '89 秒'); assert.equal(humanDuration(91_000), '2 分钟');
});
