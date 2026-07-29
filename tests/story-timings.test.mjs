import assert from 'node:assert/strict';
import test from 'node:test';
import {validateStoryTimings} from '../scripts/lib/story-timings.mjs';

const story = {id: 'demo', pronunciations: {'行路': ['xing2', 'lu4']}, segments: [{id: 'one', text: '第一段'}, {id: 'two', text: '第二段'}]};
const timings = {storyId: 'demo', pronunciations: {'行路': ['xing2', 'lu4']}, totalDuration: 3, segments: [
  {id: 'one', text: '第一段', file: 'public/audio/one.wav', start: 0, end: 1.25, duration: 1.25},
  {id: 'two', text: '第二段', file: 'public/audio/two.wav', start: 1.25, end: 3, duration: 1.75},
]};

test('完整且连续的旁白时序通过校验', () => {
  assert.deepEqual(validateStoryTimings({story, timings}), []);
});

test('过期文案、缺段和断裂时序会被拒绝', () => {
  const broken = structuredClone(timings);
  broken.segments[0].text = '旧文案';
  broken.segments[1].start = 1.5;
  broken.totalDuration = 4;
  assert.ok(validateStoryTimings({story, timings: broken}).some((item) => item.includes('文案')));
  assert.ok(validateStoryTimings({story, timings: broken}).some((item) => item.includes('不连续')));
  assert.ok(validateStoryTimings({story, timings: broken}).some((item) => item.includes('totalDuration')));
});

test('读音词典变更后要求重新生成 Kokoro 旁白', () => {
  const stale = structuredClone(timings);
  stale.provider = 'kokoro-local';
  stale.pronunciations = {};
  assert.ok(validateStoryTimings({story, timings: stale}).some((item) => item.includes('读音词典')));
});

test('edge 旁白不受读音词典约束', () => {
  const edge = structuredClone(timings);
  delete edge.pronunciations;
  edge.segments = edge.segments.map((segment) => ({...segment, provider: 'edge'}));
  assert.deepEqual(validateStoryTimings({story, timings: edge}), []);
});
