import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {buildGridRegions, inspectImage, parseInspection} from '../scripts/lib/assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('不整除尺寸也能完整拆分网格', () => {
  const regions = buildGridRegions(1001, 501, 2, 3);
  assert.equal(regions.length, 6);
  assert.equal(regions.filter((item) => item.row === 0).reduce((sum, item) => sum + item.width, 0), 1001);
  assert.equal(regions.filter((item) => item.column === 0).reduce((sum, item) => sum + item.height, 0), 501);
});

test('透明通道检查能够识别贴边风险', () => {
  const result = parseInspection('400|600|srgba|False|390x590+0+5');
  assert.equal(result.hasTransparency, true);
  assert.equal(result.touchesEdge, true);
});

test('可检查项目 SVG 素材尺寸', async () => {
  const result = await inspectImage(path.join(root, 'public', 'assets', 'sample', 'emperor.svg'));
  assert.equal(result.width, 650);
  assert.equal(result.height, 790);
});
