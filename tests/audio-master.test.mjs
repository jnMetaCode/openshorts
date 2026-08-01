import test from 'node:test';
import assert from 'node:assert/strict';
import {PLATFORM_TARGET_LUFS, buildAudioGraph, collectAudioSources} from '../scripts/lib/audio-master.mjs';

const project = {
  fps: 30,
  soundtrackSrc: 'audio/demo/music.wav',
  soundtrackVolume: 0.42,
  scenes: [
    {durationFrames: 60, narrationSrc: 'audio/demo/01.wav', audioCues: [{src: 'audio/demo/whoosh.wav', fromFrame: 10, volume: 0.5}]},
    {durationFrames: 90, narrationSrc: 'audio/demo/02.wav', audioCues: []},
  ],
};

test('音频素材去重且保持出现顺序', () => {
  assert.deepEqual(collectAudioSources(project), ['audio/demo/music.wav', 'audio/demo/01.wav', 'audio/demo/whoosh.wav', 'audio/demo/02.wav']);
});

test('配乐循环补齐到成片长度', () => {
  const {filters} = buildAudioGraph({project, totalSeconds: 5});
  assert.ok(filters.some((item) => item.includes('aloop=loop=-1') && item.includes('atrim=0:5.000')));
});

test('有旁白时配乐走 sidechain 闪避', () => {
  const {filters, outLabel} = buildAudioGraph({project, totalSeconds: 5});
  assert.ok(filters.some((item) => item.includes('sidechaincompress')));
  assert.ok(filters.some((item) => item.includes('asplit=2[voiceout][voicekey]')));
  assert.ok(filters.at(-1).includes('[ducked][voiceout]'), '闪避后的配乐才进最终混音');
  assert.equal(outLabel, '[a]');
});

test('没有旁白时不插入闪避，配乐直接混音', () => {
  const silent = {...project, scenes: project.scenes.map((scene) => ({...scene, narrationSrc: undefined}))};
  const {filters} = buildAudioGraph({project: silent, totalSeconds: 5});
  assert.ok(!filters.some((item) => item.includes('sidechaincompress')));
  assert.ok(filters.at(-1).startsWith('[music]'));
});

test('旁白与音效按镜头起点换算延迟', () => {
  const {filters} = buildAudioGraph({project, totalSeconds: 5});
  assert.ok(filters.some((item) => item.includes('adelay=0|0') && item.includes('[voice0]')));
  // 第二镜从第 60 帧开始，30fps 即 2000ms
  assert.ok(filters.some((item) => item.includes('adelay=2000|2000') && item.includes('[voice1]')));
  // 音效在第一镜的第 10 帧，即 333ms
  assert.ok(filters.some((item) => item.includes('adelay=333|333') && item.includes('[cue0]')));
});

test('响度归一到平台目标', () => {
  const {filters} = buildAudioGraph({project, totalSeconds: 5});
  assert.ok(filters.at(-1).includes(`loudnorm=I=${PLATFORM_TARGET_LUFS}`));
});

test('没有任何音频素材时返回空图', () => {
  const {outLabel, filters} = buildAudioGraph({project: {fps: 30, scenes: [{durationFrames: 30, audioCues: []}]}, totalSeconds: 1});
  assert.equal(outLabel, null);
  assert.deepEqual(filters, []);
});

test('输入下标可按视频输入数量偏移', () => {
  const {filters} = buildAudioGraph({project, totalSeconds: 5, firstAudioInput: 3});
  assert.ok(filters[0].startsWith('[3:a]'), '第一条音频素材应对应第 3 个输入');
});
