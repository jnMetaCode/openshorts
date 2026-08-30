import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { aoResultToProject } from '../src/core/ao-result.mjs';

const meta = JSON.parse(fs.readFileSync(new URL('./fixtures/ao-drama-metadata.json', import.meta.url), 'utf-8'));
const template = JSON.parse(fs.readFileSync(new URL('../templates/ai-drama.template.json', import.meta.url), 'utf-8'));

test('真实 AO 短剧运行 → 项目 JSON：三镜 + 定妆图成 shot，成片成 final，skipped 步骤不出现', () => {
  const p = aoResultToProject(meta, template, { id: 'drama-fixture' });
  assert.equal(p.schemaVersion, 2);
  assert.deepEqual(p.shots.map((s) => s.id), ['character', 'shot1', 'shot2', 'shot3']);
  assert.equal(p.final?.file, 'assets/film.mp4');
  assert.ok(!p.shots.some((s) => s.id.startsWith('vo')), '配音步骤被跳过，不该有 shot');
});

test('验收结论进 shot.verification，未过的 shot 状态是 ready 而不是 approved', () => {
  const p = aoResultToProject(meta, template);
  const s2 = p.shots.find((s) => s.id === 'shot2');
  assert.equal(s2.verification.pass, false);
  assert.ok(s2.verification.failed.length >= 1);
  assert.equal(s2.status, 'ready');
  const s1 = p.shots.find((s) => s.id === 'shot1');
  assert.equal(s1.verification, null);
  assert.equal(s1.status, 'approved');
});

test('溯源与成本：视频按秒、图片按张；文件路径指向 assets/', () => {
  const p = aoResultToProject(meta, template);
  const ch = p.shots.find((s) => s.id === 'character');
  assert.equal(ch.visual.cost.kind, 'per-image');
  assert.equal(ch.visual.file, 'assets/character.png');
  assert.equal(p.shots.find((s) => s.id === 'shot3').visual.cost.kind, 'per-second');
  assert.equal(p.provenance.length, 5);
});

test('快照：同一输入永远同一输出', () => {
  const a = JSON.stringify(aoResultToProject(meta, template, { id: 'x' }));
  const b = JSON.stringify(aoResultToProject(meta, template, { id: 'x' }));
  assert.equal(a, b);
});
