import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { buildPublishText, makePublishPack, PLATFORMS, checkPlatform } from '../src/publish/pack.mjs';
const project = { id: 'p', title: '猫为什么爱钻纸箱' + '很长'.repeat(40), topic: 't', publish: { titles: ['A'.repeat(70), 'B'], tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], note: 'n', aiLabelText: 'AI' }, provenance: [{ shot: 's1', source: 'pexels', author: 'X', license: 'Pexels License' }], final: { quality: { pass: true, warnings: 1, items: [{ status: 'warn', msg: '软字幕' }] } } };
test('发布文案按平台裁标题/标签数，带 AI 标识、署名、质检', () => {
  const t = buildPublishText(project, 'douyin');
  assert.ok(t.includes('A'.repeat(55)) && !t.includes('A'.repeat(56)), '抖音标题 ≤ 55');
  assert.equal((t.match(/#/g) || []).length, 5); assert.ok(t.includes('Pexels License') && t.includes('软字幕') && t.includes('AI'));
  assert.ok(buildPublishText(project, 'shorts').includes('#Shorts'));
});
test('发布包目录含 mp4/文案，没成片时报错', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'os-pub-')); const mp4 = path.join(d, 'x.mp4'); fs.writeFileSync(mp4, 'v');
  const r = makePublishPack({ ...project, final: { ...project.final, file: mp4 } }, { platform: 'bilibili', outDir: path.join(d, 'pack') });
  assert.ok(r.files.some((f) => f.endsWith('.mp4')) && r.files.some((f) => f.includes('发布文案')));
  assert.throws(() => makePublishPack({ ...project, final: {} }), /成片/);
  assert.ok(Object.keys(PLATFORMS).length >= 4);
});

/**
 * 平台规格以前只写在 PLATFORMS 的 note 里给人看，代码一条都不查——
 * 90 秒的片子照样能打成 Shorts 包（传上去就不算 Shorts），标题超长默默截断。
 */
test('打包前按平台规格核一遍：只报事实，不拦着打包', () => {
  const base = { output: { w: 1080, h: 1920 }, final: { durationSec: 37 }, publish: { titles: ['短标题'], tags: ['a', 'b'] } };
  assert.deepEqual(checkPlatform(base, 'douyin'), [], '都合规就一句话都不说');

  const long = checkPlatform({ ...base, final: { durationSec: 92 } }, 'shorts');
  assert.match(long[0], /超过 60 秒就不算 Shorts/);
  assert.deepEqual(checkPlatform({ ...base, final: { durationSec: 92 } }, 'douyin'), [], '抖音没有 60 秒这条限制');

  const wide = checkPlatform({ ...base, output: { w: 1920, h: 1080 } }, 'douyin');
  assert.match(wide[0], /横屏/);

  const many = checkPlatform({ ...base, publish: { titles: ['x'.repeat(80)], tags: Array(9).fill('t') } }, 'douyin');
  assert.equal(many.length, 2, '标题超长 + 话题超量各报一条');

  assert.match(checkPlatform({ ...base, publish: { titles: [], tags: [] } }, 'douyin')[0], /没有标题候选/);

  // 警告要进发布文案，运营拿到 txt 就能看见
  assert.match(buildPublishText({ ...base, final: { durationSec: 92 } }, 'shorts'), /不算 Shorts/);
});
