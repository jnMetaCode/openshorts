import assert from 'node:assert/strict';
import test from 'node:test';
import {audioSummaryFromProbe, validateNarrationMedia} from '../scripts/lib/audio-probe.mjs';

test('旁白 ffprobe 结果可归一化并通过规格校验', () => {
  const media = audioSummaryFromProbe({streams: [{codec_type: 'audio', codec_name: 'pcm_s16le', sample_rate: '48000', channels: 1, duration: '2.500'}], format: {duration: '2.500'}});
  assert.deepEqual(media, {codec: 'pcm_s16le', sampleRate: 48000, channels: 1, duration: 2.5});
  assert.deepEqual(validateNarrationMedia({label: 'voice.wav', timing: {duration: 2.5}, media}), []);
});

test('旁白文件规格或真实时长异常会被拒绝', () => {
  const errors = validateNarrationMedia({label: 'voice.wav', timing: {duration: 2.5}, media: {codec: 'aac', sampleRate: 44100, channels: 2, duration: 2.8}});
  assert.ok(errors.some((item) => item.includes('编码')));
  assert.ok(errors.some((item) => item.includes('44100')));
  assert.ok(errors.some((item) => item.includes('声道')));
  assert.ok(errors.some((item) => item.includes('timings')));
});
