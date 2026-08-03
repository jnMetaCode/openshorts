import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {collectAssetPaths, exportProjectBundle, importProjectBundle, validateArchiveEntries} from '../scripts/lib/project-package.mjs';

const project = {id: 'demo', title: 'Demo', soundtrackSrc: 'audio/music.wav', scenes: [{narrationSrc: 'audio/voice.wav', audioCues: [{src:'audio/impact.wav',fromFrame:8,volume:.7}], layers: [{src: 'images/a.png'}, {src: 'https://example.com/x.png'}]}]};

test('项目打包会收集本地素材并忽略远程 URL', () => {
  assert.deepEqual(collectAssetPaths(project).sort(), ['audio/impact.wav', 'audio/music.wav', 'audio/voice.wav', 'images/a.png']);
});

test('压缩包路径穿越会被拒绝', () => {
  assert.equal(validateArchiveEntries(['project.json', 'public/a.png']).length, 0);
  assert.equal(validateArchiveEntries(['../secret', '/etc/passwd', 'C:\\bad']).length, 3);
});

test('项目和素材可完整打包并安全导入', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openshorts-package-test-'));
  const sourcePublic = path.join(root, 'source-public'); const targetPublic = path.join(root, 'target-public');
  for (const asset of collectAssetPaths(project)) {const file = path.join(sourcePublic, asset); await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, asset);}
  const archive = path.join(root, 'demo.zip'); await exportProjectBundle({project, publicDir: sourcePublic, output: archive});
  const imported = await importProjectBundle({archive, publicDir: targetPublic, namespace: 'imported'});
  assert.equal(imported.assets, 4); assert.match(imported.project.scenes[0].layers[0].src, /^uploads\/imported\//); assert.match(imported.project.scenes[0].audioCues[0].src, /^uploads\/imported\//);
});
