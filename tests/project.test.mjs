import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const project = JSON.parse(fs.readFileSync(new URL('../projects/sample.json', import.meta.url), 'utf8'));

test('示例工程符合 v1 基础协议', () => {
  assert.equal(project.schemaVersion, 1);
  assert.ok(project.scenes.length >= 2);
  assert.ok(project.scenes.every((scene) => scene.durationFrames > 0 && scene.layers.length >= 4));
});

test('每个镜头都有背景、主体和纵深层', () => {
  for (const scene of project.scenes) {
    const roles = new Set(scene.layers.map((layer) => layer.role));
    assert.ok(roles.has('background'), `${scene.name} 缺少背景`);
    assert.ok(roles.has('primary'), `${scene.name} 缺少主角`);
    assert.ok(roles.has('foreground') || roles.has('tertiary'), `${scene.name} 缺少纵深层`);
  }
});

test('图层 id 全局唯一且按叙事节奏错峰', () => {
  const layers = project.scenes.flatMap((scene) => scene.layers);
  assert.equal(new Set(layers.map((layer) => layer.id)).size, layers.length);
  for (const scene of project.scenes) {
    const delays = new Set(scene.layers.filter((layer) => layer.role !== 'background').map((layer) => layer.delayFrames));
    assert.ok(delays.size >= 3, `${scene.name} 的入场节奏没有拉开`);
  }
});
