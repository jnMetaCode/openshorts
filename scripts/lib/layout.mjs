// Remotion 的 transformOrigin 是 50% 100%（底边中点），素材在画布上的锚点是 (x + W/2, y + H)，
// 旋转不改变锚点位置。ImageMagick 的 -rotate 绕素材中心旋转并撑大边界框，再按左上角贴图，
// 所以必须把锚点在旋转后图里的位置反算回左上角坐标，两条渲染路径才会落在同一处。
export const rotatedTopLeft = ({layer, flat, rotated}) => {
  if (!layer.rotation) return {x: Math.round(layer.x), y: Math.round(layer.y)};
  const radians = layer.rotation * Math.PI / 180;
  // 中心指向底边中点的向量是 (0, H/2)，旋转后为 (-H/2·sin, H/2·cos)。
  const anchorX = rotated.width / 2 - flat.height / 2 * Math.sin(radians);
  const anchorY = rotated.height / 2 + flat.height / 2 * Math.cos(radians);
  return {
    x: Math.round(layer.x + flat.width / 2 - anchorX),
    y: Math.round(layer.y + flat.height - anchorY),
  };
};

// ImageMagick -rotate 后的画布尺寸，用于在没有真实文件时预测落点（测试与校验用）。
export const rotatedBounds = ({width, height, rotation}) => {
  const radians = rotation * Math.PI / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  return {width: Math.round(width * cos + height * sin), height: Math.round(width * sin + height * cos)};
};
