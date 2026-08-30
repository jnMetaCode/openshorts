import test from 'node:test';
import assert from 'node:assert/strict';
import { planVariants } from '../src/pipeline/batch.mjs';
const base = { voice: { voice: 'zh-CN-XiaoxiaoNeural', rate: 1 }, captions: { preset: 'douyin' } };
test('笛卡尔积：音色 × 字幕 × 语速，id 可读且唯一', () => {
  const v = planVariants({ voices: ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural'], captions: ['douyin', 'clean'], rates: [1, 1.1] }, base);
  assert.equal(v.length, 8); assert.equal(new Set(v.map((x) => x.id)).size, 8);
  assert.equal(v[0].id, 'Xiaoxiao-douyin'); assert.equal(v[1].id, 'Xiaoxiao-douyin-x1.1');
});
test('未指定的维度沿用项目当前值', () => {
  const v = planVariants({ captions: ['clean', 'boxed'] }, base);
  assert.deepEqual(v.map((x) => x.voice), ['zh-CN-XiaoxiaoNeural', 'zh-CN-XiaoxiaoNeural']);
});
