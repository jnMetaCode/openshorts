import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * CLI 里不联网就能跑的分支：estimate（口播 / 短剧两条线的措辞）、run/batch 对非口播项目的拒绝、
 * version。以前 bin/openshorts.mjs 只有 43% 行覆盖，这些分支全靠手敲。
 * 语言固定 zh（OPENSHORTS_LANG），别让 CI 机器的 locale 把断言带偏。
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'os-cli-'));
const run = (...args) => spawnSync(process.execPath, [path.join(root, 'bin', 'openshorts.mjs'), ...args], { encoding: 'utf-8', env: { ...process.env, OPENSHORTS_LANG: 'zh', OPENSHORTS_HOME: path.join(home, '.openshorts'), AO_DATA_DIR: path.join(home, '.ao') }, timeout: 60000 });
const write = (name, obj) => { const f = path.join(home, name); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('estimate（口播线）：说清 0 元、按未渲镜头数报耗时、看图把关没开也要说', () => {
  const f = write('koubo.json', { id: 'k', line: 'koubo', title: '测试', shots: [{ id: 's1', text: 'a' }, { id: 's2', text: 'b', render: { segment: 'x.mp4' } }, { id: 's3', text: 'c' }] });
  const r = run('estimate', f);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /3 个镜头/); assert.match(r.stdout, /已渲好 1 个/);
  assert.match(r.stdout, /花费：0 元/);
  assert.match(r.stdout, /耗时：约 .*起（要跑 2 个镜头，另外 1 个复用）/);
  assert.match(r.stdout, /看图把关：没开/);
});

test('estimate（口播线）：全部渲好只剩合成，报约 15 秒', () => {
  const f = write('done.json', { id: 'd', line: 'koubo', shots: [{ id: 's1', render: { segment: 'a' } }, { id: 's2', render: { segment: 'b' } }] });
  const r = run('estimate', f);
  assert.equal(r.status, 0); assert.match(r.stdout, /约 15 秒/);
});

test('estimate（短剧线）：不套口播的算法，指向 drama --plan', () => {
  const f = write('drama.json', { id: 'x', line: 'drama', tier: 'local', inputs: { video_provider: 'local-sdcpp', video_model: 'minimax-h3-q2', video_duration: '2' }, shots: [{ id: 'shot1' }, { id: 'shot2' }] });
  const r = run('estimate', f);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /AI 短剧线/); assert.match(r.stdout, /本机出片（不花钱/); assert.match(r.stdout, /local-sdcpp \/ minimax-h3-q2 · 2 秒一镜 · 2 镜/);
  assert.match(r.stdout, /drama --plan/);
  assert.doesNotMatch(r.stdout, /花费：0 元/, '短剧线不该报口播线的"0 元"');
});

test('run / batch 拿到短剧项目：一句话拒绝并 exit 1，不去起流水线', () => {
  const f = write('drama2.json', { id: 'x', line: 'drama', shots: [] });
  const a = run('run', f); assert.equal(a.status, 1); assert.match(a.stderr, /只支持口播线/);
  const b = run('batch', f, '--voices', 'zh-CN-XiaoxiaoNeural'); assert.equal(b.status, 1); assert.match(b.stderr, /只支持口播线/);
});

test('estimate 没给文件 / 给了不是项目的 JSON：用法提示或人话，exit 1', () => {
  const a = run('estimate'); assert.equal(a.status, 1); assert.match(a.stderr, /用法/);
  const f = path.join(home, 'notproj.json'); fs.writeFileSync(f, '{"hello":1}');
  const b = run('estimate', f); assert.equal(b.status, 1); assert.match(b.stderr, /不是开片的项目文件/);
});

test('version：打出 package.json 的版本号', () => {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).version;
  const r = run('version'); assert.equal(r.status, 0); assert.ok(r.stdout.includes(v), r.stdout);
});

test('rm：没 --yes 只预告不删（exit 1）；--yes 删整个目录；输出根目录拒删', () => {
  const dir = path.join(home, 'proj-rm'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'project.json'); fs.writeFileSync(f, JSON.stringify({ id: 'x', line: 'koubo', title: '要删的', shots: [] }));
  fs.writeFileSync(path.join(dir, 'x.mp4'), '');
  const dry = run('rm', f); assert.equal(dry.status, 1); assert.match(dry.stderr, /将删除整个项目目录（2 个条目/); assert.ok(fs.existsSync(f), '没 --yes 不能动');
  const yes = run('rm', f, '--yes'); assert.equal(yes.status, 0, yes.stderr); assert.match(yes.stdout, /已删除 要删的/); assert.equal(fs.existsSync(dir), false);
  // 输出根目录：config 指到 home/OpenShorts，把 project.json 放在根上试删
  const outRoot = path.join(home, 'OpenShorts'); fs.mkdirSync(outRoot, { recursive: true });
  fs.mkdirSync(path.join(home, '.openshorts'), { recursive: true }); fs.writeFileSync(path.join(home, '.openshorts', 'config.json'), JSON.stringify({ outputDir: outRoot }));
  const rootF = path.join(outRoot, 'project.json'); fs.writeFileSync(rootF, JSON.stringify({ id: 'root', shots: [] }));
  const r = run('rm', rootF, '--yes'); assert.equal(r.status, 1); assert.match(r.stderr, /输出根目录/); assert.ok(fs.existsSync(rootF));
});
