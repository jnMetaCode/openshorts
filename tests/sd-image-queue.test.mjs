import test from 'node:test';
import assert from 'node:assert/strict';
import { serialized } from '../src/local/sd-image.mjs';

/** 本机出图全进程串行：并发调用要排队执行，前一个失败不能把队列卡死 */
test('serialized：并发调用按序执行、互不重叠；失败不阻塞后续', async () => {
  let active = 0, peak = 0; const order = [];
  const fn = serialized(async (id, fail = false) => { active++; peak = Math.max(peak, active); order.push(`start ${id}`); await new Promise((r) => setTimeout(r, 30)); active--; order.push(`end ${id}`); if (fail) throw new Error('boom'); return id; });
  const results = await Promise.allSettled([fn(1), fn(2, true), fn(3)]);
  assert.equal(peak, 1, '任何时刻只有一个在跑');
  assert.deepEqual(order, ['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3']);
  assert.equal(results[0].value, 1); assert.equal(results[1].status, 'rejected'); assert.equal(results[2].value, 3, '前一个失败后队列继续');
});
