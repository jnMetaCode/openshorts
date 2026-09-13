import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { JobHub } from '../server/lib/job-hub.mjs';

/**
 * 任务与连接解耦的三个硬要求：① 观众断了任务照跑 ② 重连按 Last-Event-ID 只补错过的
 * ③ 跑完之后再来看的能拿到结果。用假 req/res 验帧，不起真服务。
 */
const fakeConn = (headers = {}, query = {}) => {
  const req = Object.assign(new EventEmitter(), { headers, query });
  const res = { chunks: [], ended: false, writeHead() {}, write(c) { this.chunks.push(String(c)); }, end() { this.ended = true; } };
  const events = () => res.chunks.join('').split('\n\n').filter((f) => f.startsWith('id:')).map((f) => { const m = f.match(/^id: (\d+)\nevent: (\w+)\ndata: (.*)$/s); return { n: Number(m[1]), ev: m[2], data: JSON.parse(m[3]) }; });
  return { req, res, events };
};

test('观众断开不影响任务；重连按 Last-Event-ID 只补错过的行', () => {
  const hub = new JobHub();
  let cancelled = false;
  const job = hub.start('koubo:a', { cancel: () => { cancelled = true; } });
  const c1 = fakeConn(); hub.attach(job, c1.req, c1.res);
  hub.emit(job, 'log', { m: 'one' }); hub.emit(job, 'log', { m: 'two' });
  c1.req.emit('close');                       // 页面关了 / 网断了
  hub.emit(job, 'log', { m: 'three' });       // 任务照跑
  assert.equal(cancelled, false, '断开不等于取消');
  assert.equal(hub.isRunning('koubo:a'), true);
  assert.deepEqual(c1.events().map((e) => e.data.m), ['one', 'two'], '断开后的行不该再写进死连接');
  const c2 = fakeConn({ 'last-event-id': '2' }); hub.attach(job, c2.req, c2.res);
  assert.deepEqual(c2.events().map((e) => e.n), [3], '重连只补第 3 行');
  hub.finish(job, 'done', { final: { file: 'x.mp4' } });
  assert.equal(c2.res.ended, true, '收尾后关掉观众连接');
  assert.equal(c2.events().at(-1).ev, 'done');
});

test('跑完之后再来看：补发全部并立刻关；status 带结果', () => {
  const hub = new JobHub();
  const job = hub.start('drama');
  hub.emit(job, 'log', { m: 'a' }); hub.finish(job, 'error', { m: 'boom' });
  const c = fakeConn(); hub.attach(job, c.req, c.res);
  assert.deepEqual(c.events().map((e) => e.ev), ['log', 'error']);
  assert.equal(c.res.ended, true);
  assert.equal(hub.status('drama').status, 'error');
  assert.deepEqual(hub.status('drama').result, { m: 'boom' });
  assert.equal(hub.status('nope').status, 'idle');
  assert.equal(hub.cancel('drama'), false, '跑完的不能再取消');
  assert.equal(hub.isRunning('drama'), false);
  assert.doesNotThrow(() => hub.start('drama'), '跑完的 key 可以再起');
});

test('同 key 在跑时 start 抛；cancel 调到任务自己的 cancel；日志缓冲按上限裁', () => {
  const hub = new JobHub({ keepLines: 3 });
  let n = 0; const job = hub.start('k', { cancel: () => { n++; } });
  assert.throws(() => hub.start('k'), /already running/);
  for (let i = 1; i <= 5; i++) hub.emit(job, 'log', { m: String(i) });
  const c = fakeConn(); hub.attach(job, c.req, c.res);
  assert.deepEqual(c.events().map((e) => e.data.m), ['3', '4', '5'], '只剩最近 3 行，序号连续');
  assert.equal(hub.cancel('k'), true); assert.equal(n, 1);
  assert.deepEqual(hub.runningKeys(), ['k']);
});

test('跑完的任务只留最近 keepJobs 个；在跑的不会被清', () => {
  const hub = new JobHub({ keepJobs: 2 });
  for (const k of ['a', 'b', 'c']) { const j = hub.start(k); hub.finish(j, 'done', { k }); }
  const running = hub.start('r');
  hub.start('d');   // 第 4 个跑完的进来时，最老的 a 被清
  assert.equal(hub.get('a'), null); assert.ok(hub.get('b') && hub.get('c') && hub.get('d'));
  assert.equal(hub.get('r'), running, '在跑的永远不清');
});
