import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'openshorts.mjs');
// 这些用例断言的是中文原话,必须**显式钉住语言**:CLI 现在跟随系统 locale,
// 而 CI runner 上 LANG=en_US.UTF-8 —— 不钉的话本机全绿、CI 全红(真栽过一次)。
const cli = (...args) => spawnSync(process.execPath, [bin, ...args],
  { encoding: 'utf-8', timeout: 30000, env: { ...process.env, OPENSHORTS_LANG: 'zh' } });

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
