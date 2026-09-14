import test from 'node:test';
import assert from 'node:assert/strict';
import { startStopwatch, elapsedText, humanDuration } from '../src/core/stopwatch.mjs';

/**
 * 休眠靠"事件循环断片"识别：用 Atomics.wait 把循环卡住模拟合盖（真休眠时定时器同样不跑、醒来
 * Date.now 同样跳），阈值缩小到 100 ms 好在测试里跑。变异检查：去掉 gap 扣减，第一条红。
 */
const block = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 容差要按 CI 放宽：GitHub 的 macOS runner 负载高，定时器晚到几十到上百毫秒是常态——
// 9-14 两个 Dependabot PR 的 macOS job 就挂在"休眠应约 300 ms，得到 402 / 412"上（与 PR 改动无关）。
// 所以"睡"得更久（600 ms），让休眠与正常 tick 抖动拉开数量级，只断言方向和量级，不卡紧的上界。
test('中途"睡" 600 ms：从活跃时间里扣掉，并单独报出来', async () => {
  const sw = startStopwatch({ tickMs: 20, gapMs: 150 });
  await sleep(120);          // 正常跑一段，tick 在走
  block(600);                // 机器"睡"了：定时器不跑，Date.now 跳 600
  await sleep(120);
  const r = sw.stop();
  assert.ok(r.suspendedMs >= 450 && r.suspendedMs <= 1200, `休眠应约 600 ms，得到 ${r.suspendedMs}`);
  assert.ok(r.activeMs <= r.wallMs - 450, `活跃时间 ${r.activeMs} 应比墙上时间 ${r.wallMs} 少掉休眠那段`);
  assert.ok(r.activeMs >= 150, `活跃时间应至少是两段正常运行（约 240 ms），得到 ${r.activeMs}`);
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
