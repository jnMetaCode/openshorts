import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseScores, rankCandidates, evidenceFrame } from '../src/sources/rank.mjs';
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

test('只有一条候选也要送去打分：唯一候选恰恰最容易混进标题卡/无关画面', { skip: !hasFfmpeg && '无 ffmpeg' }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'os-rank1-'));
  const f = path.join(d, 'only.mp4');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:size=64x64:rate=10:d=2', '-pix_fmt', 'yuv420p', f]);
  const calls = [];
  const connector = { chat: async (_sys, user) => { calls.push(user); return { content: '[{"i":0,"score":1,"why":"是一张英文标题卡"}]' }; } };
  const one = [{ id: 'wikimedia:1', file: f }];
  const ranked = await rankCandidates(one, '一只猫钻进纸箱', { connector, cfg: {}, threshold: 4 });
  assert.equal(calls.length, 1, '必须真的问了模型');
  assert.equal(ranked[0].score, 1);
  assert.equal(ranked[0].rejected, true, '不及格的唯一候选要被判退，让上层退纯色底');
  fs.rmSync(d, { recursive: true, force: true });
});

test('证据帧优先用来源自带的缩略图（几十 KB），不为了看一眼画面去下整条片', async () => {
  const jpg = Buffer.from('/9j/4AAQSkZJRg==', 'base64');
  const asked = [];
  const fetchImpl = async (u) => { asked.push(String(u)); return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => jpg }; };
  const got = await evidenceFrame({ id: 'wikimedia:1', thumb: 'https://x/thumb.jpg', url: 'https://x/huge.webm' }, { fetchImpl });
  assert.match(got, /^data:image\/jpeg;base64,/);
  assert.deepEqual(asked, ['https://x/thumb.jpg'], '只该去拿缩略图，不该碰视频地址');
});

test('缩略图挂了就按需把片子下下来抽帧——不能让没打过分的候选混进成片', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, headers: { get: () => null } });
  let downloaded = null;
  const got = await evidenceFrame({ id: 'wikimedia:2', thumb: 'https://x/gone.jpg' }, { fetchImpl, getFile: async (c) => { downloaded = c.id; return null; } });
  assert.equal(downloaded, 'wikimedia:2', '缩略图取不到时必须回落到下载');
  assert.equal(got, null, '连片子也拿不到才返回空');
});

/**
 * 阈值跟提示词里写的评分标准对齐：那里写的是"主体对得上给 6 分起"，所以低于 6 按模型自己的
 * 定义就不算主体匹配。真机上原来取 4，选中过一条模型自己批注「有猫但为木箱非纸箱」的素材
 * ——分数刚好 4 分卡在阈值上。
 */
test('阈值 6：模型自己说"不算主体匹配"的分数不该被选中', { skip: !hasFfmpeg && '无 ffmpeg' }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'os-th-'));
  const files = ['a', 'b'].map((n) => { const f = path.join(d, n + '.mp4'); spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:size=64x64:rate=10:d=2', '-pix_fmt', 'yuv420p', f]); return f; });
  const cands = files.map((f, i) => ({ id: 'c' + i, file: f }));
  const connector = { chat: async () => ({ content: '[{"i":0,"score":5,"why":"有猫但不是纸箱"},{"i":1,"score":6,"why":"主体对上了"}]' }) };
  const r = await rankCandidates(cands, '猫钻纸箱', { connector, cfg: {} });
  assert.equal(r[0].id, 'c1');
  assert.equal(r[0].rejected, undefined, '6 分是及格线，正好 6 分要过');
  assert.equal(r.find((x) => x.id === 'c0').rejected, true, '5 分不过——模型自己都说不是纸箱');
  fs.rmSync(d, { recursive: true, force: true });
});

test('模型调不通时，候选要标 unjudged——"没人把过关"不能悄悄溜过去', { skip: !hasFfmpeg && '无 ffmpeg' }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'os-uj-'));
  const f = path.join(d, 'a.mp4');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:size=64x64:rate=10:d=2', '-pix_fmt', 'yuv420p', f]);
  const r = await rankCandidates([{ id: 'c0', file: f }], '猫', { connector: { chat: async () => { throw new Error('接口抽了'); } }, cfg: {} });
  assert.equal(r[0].score, null);
  assert.equal(r[0].unjudged, true, '真机上六镜里抽过一次，那一镜当时就这么没被把关');
  fs.rmSync(d, { recursive: true, force: true });
});
