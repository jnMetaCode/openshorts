import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROVIDERS, buildAssetPlan, collectAssetSources, unresolvedAssets} from '../scripts/lib/asset-provenance.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const board = {
  scenes: [
    {layers: [{src: 'a.svg', role: 'background', name: '背景'}, {src: 'b.png', role: 'primary', name: '主体'}]},
    {layers: [{src: 'a.svg', role: 'background', name: '背景'}, {src: 'c.svg', role: 'secondary', name: '配角'}]},
  ],
};

test('素材按文件去重，复用的只算一条', () => {
  assert.deepEqual(collectAssetSources(board), ['a.svg', 'b.png', 'c.svg']);
  assert.equal(buildAssetPlan({board}).length, 3);
});

test('复用次数记进 parameters，便于判断改动影响面', () => {
  const plan = buildAssetPlan({board});
  assert.equal(plan.find((item) => item.src === 'a.svg').generation.parameters.usedIn, 2);
  assert.equal(plan.find((item) => item.src === 'b.png').generation.parameters.usedIn, 1);
});

test('没有溯源记录时默认标为未知且未审核', () => {
  const plan = buildAssetPlan({board});
  for (const asset of plan) {
    assert.equal(asset.generation.provider, 'unknown');
    assert.equal(asset.status, 'planned');
  }
  assert.equal(unresolvedAssets(plan).length, 3);
});

test('有溯源记录的素材自动视为可用', () => {
  const plan = buildAssetPlan({board, provenance: {
    'a.svg': {provider: 'handwritten-svg', license: '本仓库原创（MIT）', createdAt: '2026-07-30'},
    'b.png': {provider: 'comfyui', model: 'flux.1-dev', seed: 42, license: 'CC0'},
    'c.svg': {provider: 'handwritten-svg', createdAt: '2026-07-30'},
  }});
  assert.equal(unresolvedAssets(plan).length, 0);
  for (const asset of plan) assert.equal(asset.status, 'approved');
  const generated = plan.find((item) => item.src === 'b.png').generation;
  assert.equal(generated.model, 'flux.1-dev');
  assert.equal(generated.seed, 42);
  assert.equal(generated.parameters.license, 'CC0');
});

test('unknown 来源不可商用，其余可商用', () => {
  assert.equal(PROVIDERS.unknown.licensable, false);
  for (const [id, meta] of Object.entries(PROVIDERS)) {
    if (id !== 'unknown') assert.equal(meta.licensable, true, `${id} 应可商用`);
  }
});

test('溯源存在源头，不会被工程重建冲掉', () => {
  // 这条守的是最初的设计缺陷：溯源曾经写在 projects/*.json 里，而那是生成物。
  for (const name of ['nine-suns', 'lychee-road']) {
    const record = path.join(root, 'content', name, 'assets.json');
    assert.ok(fs.existsSync(record), `${name} 缺少 assets.json`);
    const board = JSON.parse(fs.readFileSync(path.join(root, 'content', name, 'storyboard.json'), 'utf8'));
    const records = JSON.parse(fs.readFileSync(record, 'utf8'));
    for (const src of collectAssetSources(board)) {
      assert.ok(records[src], `${name} 的 ${src} 没有溯源记录`);
    }
  }
});

test('《后羿射日》全部素材来源可查', () => {
  const board = JSON.parse(fs.readFileSync(path.join(root, 'content/nine-suns/storyboard.json'), 'utf8'));
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'content/nine-suns/assets.json'), 'utf8'));
  assert.equal(unresolvedAssets(buildAssetPlan({board, provenance})).length, 0);
});

test('工程构建后 assetPlan 不再为空', () => {
  for (const name of ['nine-suns', 'lychee-road']) {
    const project = JSON.parse(fs.readFileSync(path.join(root, 'projects', `${name}.json`), 'utf8'));
    const plan = project.production?.assetPlan ?? [];
    assert.ok(plan.length > 0, `${name} 的 assetPlan 仍是空的`);
    for (const asset of plan) assert.ok(asset.generation?.provider, `${asset.src} 缺少 provider`);
  }
});
