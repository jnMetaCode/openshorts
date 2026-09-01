import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listDramaRuns, pickFreshRunDir } from '../server/lib/ao-run-dir.mjs';

/**
 * 短剧运行目录的判定。AO 每次运行（含 --resume）都新建时间戳目录，所以
 * "spawn 之后新出现的那一个"才是本次的；按 mtime 取最新在 --resume 时会把
 * 上一次运行当成本次结果——旧产物拷回、报"重出成功"，这正是要防住的。
 */
test('只认 spawn 之后新出现的目录；没有新目录就返回 null 而不是猜最新的', () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-runs-'));
  fs.mkdirSync(path.join(runsDir, '短剧流水线-2026-08-31T10-00-00'));
  const before = new Set(listDramaRuns(runsDir));

  // resume 挂了、没产生新目录：绝不能把旧目录当结果
  assert.equal(pickFreshRunDir(before, runsDir), null);

  // 正常：AO 建了一个新目录
  const fresh = path.join(runsDir, '短剧流水线-2026-09-01T08-00-00');
  fs.mkdirSync(fresh);
  assert.equal(pickFreshRunDir(before, runsDir), fresh);

  // 两个新目录（并发写入等异常）：分不清就报 null，交给上层报错
  fs.mkdirSync(path.join(runsDir, '短剧流水线-2026-09-01T08-00-01'));
  assert.equal(pickFreshRunDir(before, runsDir), null);
  fs.rmSync(runsDir, { recursive: true, force: true });
});

test('输出目录还不存在时不炸，当成空清单', () => {
  assert.deepEqual(listDramaRuns(path.join(os.tmpdir(), 'os-not-exist-' + Date.now())), []);
});
