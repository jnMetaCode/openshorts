import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseScores, rankCandidates } from '../src/sources/rank.mjs';
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('parseScores 宽松解析，越界忽略，分数夹到 0–10', () => {
  const s = parseScores('好的：[{"i":0,"score":9,"why":"猫"},{"i":1,"score":-3},{"i":9,"score":5}]', 2);
  assert.deepEqual(s.map((x) => x.score), [9, 0]); assert.equal(parseScores('无', 2), null);
});
test('rankCandidates：按分排序，低于阈值的标 rejected 排最后；模型不可用时原序', { skip: !hasFfmpeg && '无 ffmpeg' }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'os-rank-'));
  const files = ['a', 'b', 'c'].map((n) => { const f = path.join(d, n + '.mp4'); spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:size=64x64:rate=10:d=2', '-pix_fmt', 'yuv420p', f]); return f; });
  const cands = files.map((f, i) => ({ id: 'c' + i, file: f }));
  const connector = { chat: async () => ({ content: '[{"i":0,"score":2,"why":"图表"},{"i":1,"score":8,"why":"猫"},{"i":2,"score":5,"why":"沙发"}]', usage: { input_tokens: 1, output_tokens: 1 } }) };
  const r = await rankCandidates(cands, '猫钻纸箱', { connector, cfg: { provider: 'x', model: 'y' } });
  assert.deepEqual(r.map((x) => x.id), ['c1', 'c2', 'c0']); assert.equal(r[2].rejected, true); assert.equal(r[0].score, 8);
  const bad = await rankCandidates(cands, '猫', { connector: { chat: async () => { throw new Error('boom'); } }, cfg: {} });
  assert.deepEqual(bad.map((x) => x.id), ['c0', 'c1', 'c2']);
  fs.rmSync(d, { recursive: true, force: true });
});
