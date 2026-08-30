import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { buildPublishText, makePublishPack, PLATFORMS } from '../src/publish/pack.mjs';
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
