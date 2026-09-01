import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'openshorts.mjs');
const cli = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf-8', timeout: 30000 });

test('打错命令要 exit 1：脚本和 CI 不能把 rnu 当成功', () => {
  const r = cli('rnu');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /未知命令/);
});

test('help 是正常求助，exit 0', () => {
  const r = cli('help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /用法/);
});

test('run 指到不存在的文件：一句人话，不甩 ENOENT 堆栈', () => {
  const r = cli('run', '/绝对不存在/x.json');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /找不到项目文件/);
  assert.doesNotMatch(r.stderr, /at .*node:/, '不应有原始堆栈');
});
