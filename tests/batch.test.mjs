import test from 'node:test';
import assert from 'node:assert/strict';
import { planVariants } from '../src/pipeline/batch.mjs';
const base = { voice: { voice: 'zh-CN-XiaoxiaoNeural', rate: 1 }, captions: { preset: 'douyin' } };
test('笛卡尔积：音色 × 字幕 × 语速，id 可读且唯一', () => {
  const v = planVariants({ voices: ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural'], captions: ['douyin', 'clean'], rates: [1, 1.1] }, base);
  assert.equal(v.length, 8); assert.equal(new Set(v.map((x) => x.id)).size, 8);
  assert.equal(v[0].id, 'Xiaoxiao-douyin'); assert.equal(v[1].id, 'Xiaoxiao-douyin-x1_1', '小数点换成下划线：id 是要当目录名用的，留着点就还能拼出 ".."');
});
test('未指定的维度沿用项目当前值', () => {
  const v = planVariants({ captions: ['clean', 'boxed'] }, base);
  assert.deepEqual(v.map((x) => x.voice), ['zh-CN-XiaoxiaoNeural', 'zh-CN-XiaoxiaoNeural']);
});

test('批量取消：signal 一 abort 就停整批并抛 Cancelled，不再把后面的版本逐个记成"失败"再当 done 报', async () => {
  const { runBatch: rb } = await import('../src/pipeline/batch.mjs');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-batch-cancel-'));
  const ac = new AbortController(); const ran = [];
  const runImpl = async (p, { signal }) => { ran.push(p.id); if (ran.length === 1) { ac.abort(); throw new Error('已取消'); } return { final: { file: 'x', durationSec: 1 } }; };
  const project = { id: 'b', line: 'koubo', voice: { rate: 1 }, captions: {}, shots: [] };
  const variants = [{ id: 'v1', voice: 'a', captions: 'douyin', rate: 1 }, { id: 'v2', voice: 'b', captions: 'douyin', rate: 1 }, { id: 'v3', voice: 'c', captions: 'douyin', rate: 1 }];
  await assert.rejects(() => rb(project, variants, { baseDir, signal: ac.signal, runImpl }), /Cancelled/);
  assert.deepEqual(ran, ['b-v1'], '取消后不该再起第 2、3 版');
  assert.equal(fs.existsSync(path.join(baseDir, 'variants', 'index.json')), false, '被取消的批次不该写结果清单');
});
