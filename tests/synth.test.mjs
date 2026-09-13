import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeSynthesizer } from '../src/voice/synth.mjs';

/** Edge TTS 是免费路径的单点：挂了要能回落到用户配的 AO 语音供应商；没配就把怎么配说清楚。 */
const boom = async () => { throw new Error('Edge TTS 返回空音频（端点可能变动或网络受限）'); };

test('Edge 正常时原样返回，不碰回落', async () => {
  let aoCalls = 0;
  const s = makeSynthesizer({ cfg: { tts: { fallback: { provider: 'x', model: 'm', voice: 'v' } } }, edge: async () => ({ file: 'a.mp3', words: [{ text: '你' }] }), aoSpeech: async () => { aoCalls++; } });
  assert.deepEqual(await s('你好', {}), { file: 'a.mp3', words: [{ text: '你' }] }); assert.equal(aoCalls, 0);
});

test('Edge 挂了、没配回落：抛出原因 + 怎么配（中英各一）', async () => {
  await assert.rejects(() => makeSynthesizer({ cfg: { tts: {} }, edge: boom })('你好'), /Edge TTS 返回空音频[\s\S]*tts\.fallback/);
  await assert.rejects(() => makeSynthesizer({ cfg: { tts: {} }, edge: boom, lang: 'en' })('hi'), /No fallback voice configured[\s\S]*tts\.fallback/);
});

test('Edge 挂了、配了回落：按配置调 AO 语音、落盘、无词表、日志说明', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-synth-')); const out = path.join(dir, 'w', 's1.mp3');
  const seen = []; const logs = [];
  const aoSpeech = async (config, text, opts) => { seen.push({ config, text, opts }); return { buffer: Buffer.from('ID3fake'), ext: 'mp3', mime: 'audio/mpeg' }; };
  const s = makeSynthesizer({ cfg: { tts: { fallback: { provider: 'agnes', model: 'tts-1', voice: 'alloy' } } }, edge: boom, aoSpeech, log: (m) => logs.push(m) });
  const r = await s('你好世界', { voice: 'zh-CN-XiaoxiaoNeural', rate: 1.2, outFile: out });
  assert.equal(seen.length, 1); assert.equal(seen[0].config.provider, 'agnes'); assert.deepEqual(seen[0].opts, { provider: 'agnes', model: 'tts-1', voice: 'alloy', format: 'mp3', speed: 1.2 });
  assert.equal(fs.readFileSync(out, 'utf-8'), 'ID3fake');
  assert.deepEqual(r.words, []); assert.equal(r.durationMs, null); assert.equal(r.fallback, 'agnes/tts-1');
  assert.match(logs[0], /Edge TTS 失败.*改用 agnes\/tts-1\/alloy/);
  // 回落也空：如实报
  await assert.rejects(() => makeSynthesizer({ cfg: { tts: { fallback: { provider: 'a', model: 'b', voice: 'c' } } }, edge: boom, aoSpeech: async () => ({ buffer: Buffer.alloc(0) }) })('x'), /空音频|empty audio/);
  fs.rmSync(dir, { recursive: true, force: true });
});
