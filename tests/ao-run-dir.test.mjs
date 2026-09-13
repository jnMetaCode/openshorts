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

test('readStepOutput：剥掉 AO 的引用块头与分隔线，只回正文；缺文件回 null', async () => {
  const { readStepOutput } = await import('../server/lib/ao-run-dir.mjs');
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'os-steps-'));
  fs.mkdirSync(path.join(run, 'steps'));
  fs.writeFileSync(path.join(run, 'steps', '3-shot1_prompt.md'), '> 🎬 **镜头 1 提示词** | 步骤 3/18\n> ✅ 验收标准: 1. 逐字粘贴\n> 2. 不描述长相\n> \n\n---\n\n【核心主题】A | B\n【氛围与画质】Sony Venice + K-35\n');
  fs.writeFileSync(path.join(run, 'steps', '2-atmosphere_lock.md'), '> 🎚 **氛围锁定块** | 步骤 2/18\n\n---\n机身+镜头：Sony Venice + Canon K-35 35mm f/2.8\n色彩与影调：漂白工艺\n');
  assert.equal(readStepOutput(run, 'shot1_prompt'), '【核心主题】A | B\n【氛围与画质】Sony Venice + K-35');
  assert.match(readStepOutput(run, 'atmosphere_lock'), /^机身\+镜头：Sony Venice/);
  assert.equal(readStepOutput(run, 'shot2_prompt'), null, '被跳过的步骤没有文件');
  assert.equal(readStepOutput(path.join(run, 'nope'), 'x'), null, '老版本运行目录没有 steps/');
  // id 里的特殊字符不能当正则：shot1_prompt 不该匹配到 shot1_prompt2 之类
  fs.writeFileSync(path.join(run, 'steps', '9-shot1_prompt_extra.md'), '---\nno');
  assert.equal(readStepOutput(run, 'shot1_prompt'), '【核心主题】A | B\n【氛围与画质】Sony Venice + K-35');
});
