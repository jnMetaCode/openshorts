import assert from 'node:assert/strict';
import test from 'node:test';
import {collectReleaseFiles} from '../scripts/lib/release-manifest.mjs';

test('发布清单收集工程、成片及全部本地视听素材', () => {
  const root = '/workspace';
  const project = {soundtrackSrc: 'audio/music.wav', scenes: [{narrationSrc: 'audio/voice.wav', audioCues: [{src: 'audio/fx.wav'}], layers: [{src: 'images/bg.png'}, {src: 'https://example.com/remote.png'}]}]};
  const files = collectReleaseFiles({root, project, projectPath: '/workspace/projects/demo.json', storyPath: '/workspace/content/story.json', timingsPath: '/workspace/public/audio/timings.json', videoPath: '/workspace/out/final.mp4'}).map((item) => item.relative);
  assert.deepEqual(files, ['content/story.json', 'out/final.mp4', 'projects/demo.json', 'public/audio/fx.wav', 'public/audio/music.wav', 'public/audio/timings.json', 'public/audio/voice.wav', 'public/images/bg.png']);
});
