import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeJsonAtomic, writeFileAtomic } from '../src/core/fs-atomic.mjs';

test('writeJsonAtomic：写成功后目录里没有临时文件；覆盖旧文件；写失败时不留 .tmp 也不动旧文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-atomic-'));
  const f = path.join(dir, 'project.json');
  writeJsonAtomic(f, { a: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf-8')), { a: 1 });
  writeJsonAtomic(f, { a: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf-8')), { a: 2 });
  assert.deepEqual(fs.readdirSync(dir), ['project.json'], '不能留 .tmp');
  // 写不进去（目标是目录）：抛错，旧文件原样
  const bad = path.join(dir, 'sub'); fs.mkdirSync(bad);
  assert.throws(() => writeFileAtomic(bad, 'x'));
  assert.ok(fs.statSync(bad).isDirectory());
  assert.deepEqual(fs.readdirSync(dir).filter((x) => x.includes('.tmp')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
