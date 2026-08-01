import test from 'node:test';
import assert from 'node:assert/strict';
import {rotatedBounds, rotatedTopLeft} from '../scripts/lib/layout.mjs';

// Remotion 里锚点是 (x + W/2, y + H)，旋转不改变它。这里反算 ImageMagick 的左上角坐标，
// 再正算回锚点，验证两条渲染路径落在同一个点上。
const anchorAfterPlacement = ({layer, flat, rotated, placed}) => {
  const radians = layer.rotation * Math.PI / 180;
  return {
    x: placed.x + rotated.width / 2 - flat.height / 2 * Math.sin(radians),
    y: placed.y + rotated.height / 2 + flat.height / 2 * Math.cos(radians),
  };
};

test('无旋转时直接使用工程坐标', () => {
  assert.deepEqual(rotatedTopLeft({layer: {x: 320, y: 960, rotation: 0}, flat: {width: 500, height: 700}, rotated: {width: 500, height: 700}}), {x: 320, y: 960});
});

for (const rotation of [82, -45, 15, 180]) {
  test(`旋转 ${rotation}° 后锚点仍落在 (x + W/2, y + H)`, () => {
    const layer = {x: 320, y: 960, rotation};
    const flat = {width: 500, height: 700};
    const rotated = rotatedBounds({...flat, rotation});
    const placed = rotatedTopLeft({layer, flat, rotated});
    const anchor = anchorAfterPlacement({layer, flat, rotated, placed});
    assert.ok(Math.abs(anchor.x - (layer.x + flat.width / 2)) <= 1, `锚点 X 偏移 ${anchor.x - (layer.x + flat.width / 2)}`);
    assert.ok(Math.abs(anchor.y - (layer.y + flat.height)) <= 1, `锚点 Y 偏移 ${anchor.y - (layer.y + flat.height)}`);
  });
}

test('大角度旋转会明显改变贴图左上角，说明旧的直接贴图是错的', () => {
  const layer = {x: 320, y: 960, rotation: 82};
  const flat = {width: 500, height: 700};
  const placed = rotatedTopLeft({layer, flat, rotated: rotatedBounds({...flat, rotation: 82})});
  assert.ok(Math.abs(placed.x - layer.x) > 40, `X 应有明显修正，实际 ${placed.x - layer.x}`);
  assert.ok(Math.abs(placed.y - layer.y) > 40, `Y 应有明显修正，实际 ${placed.y - layer.y}`);
});

test('旋转后的边界框按 |W·cos| + |H·sin| 扩大', () => {
  assert.deepEqual(rotatedBounds({width: 100, height: 100, rotation: 90}), {width: 100, height: 100});
  assert.deepEqual(rotatedBounds({width: 100, height: 200, rotation: 90}), {width: 200, height: 100});
});
