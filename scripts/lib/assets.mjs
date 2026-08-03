import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);
const magick = process.env.OPENSHORTS_MAGICK_BIN || 'magick';

export const buildGridRegions = (width, height, rows, columns) => {
  if (![width, height, rows, columns].every(Number.isInteger) || width <= 0 || height <= 0 || rows <= 0 || columns <= 0) throw new Error('网格参数必须是正整数');
  const regions = [];
  for (let row = 0; row < rows; row += 1) {
    const y = Math.round(row * height / rows);
    const nextY = Math.round((row + 1) * height / rows);
    for (let column = 0; column < columns; column += 1) {
      const x = Math.round(column * width / columns);
      const nextX = Math.round((column + 1) * width / columns);
      regions.push({x, y, width: nextX - x, height: nextY - y, row, column});
    }
  }
  return regions;
};

export const parseInspection = (value) => {
  const [width, height, channels, opaque, geometry = ''] = value.trim().split('|');
  const match = geometry.match(/(\d+)x(\d+)\+(-?\d+)\+(-?\d+)/);
  const result = {width: Number(width), height: Number(height), channels, hasTransparency: opaque.toLowerCase() === 'false', contentBounds: match ? {width: Number(match[1]), height: Number(match[2]), x: Number(match[3]), y: Number(match[4])} : null};
  const bounds = result.contentBounds;
  result.touchesEdge = Boolean(bounds && (bounds.x <= 0 || bounds.y <= 0 || bounds.x + bounds.width >= result.width || bounds.y + bounds.height >= result.height));
  return result;
};

export const inspectImage = async (input) => {
  const {stdout: basic} = await run(magick, ['identify', '-format', '%w|%h|%[channels]|%[opaque]', input]);
  const [width, height, channels, opaque] = basic.trim().split('|');
  let geometry = '';
  if (opaque.toLowerCase() === 'false') {
    const result = await run(magick, [input, '-alpha', 'extract', '-threshold', '0', '-format', '%@', 'info:']);
    geometry = result.stdout.trim();
  }
  return parseInspection(`${width}|${height}|${channels}|${opaque}|${geometry}`);
};

export const removeColor = async ({input, output, color = '#00ff00', fuzz = 12, trim = true, padding = 12}) => {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('抠图颜色必须是 #RRGGBB');
  if (!Number.isFinite(fuzz) || fuzz < 0 || fuzz > 100) throw new Error('容差必须在 0-100 之间');
  await fs.mkdir(path.dirname(output), {recursive: true});
  const args = [input, '-alpha', 'on', '-fuzz', `${fuzz}%`, '-transparent', color];
  if (trim) args.push('-trim', '+repage', '-bordercolor', 'none', '-border', String(Math.max(0, Math.round(padding))));
  args.push(output);
  await run(magick, args);
  return inspectImage(output);
};

export const splitSheet = async ({input, outputDir, prefix = 'layer', rows = 1, columns = 1, trim = true}) => {
  const source = await inspectImage(input);
  const regions = buildGridRegions(source.width, source.height, rows, columns);
  await fs.mkdir(outputDir, {recursive: true});
  const outputs = [];
  for (const [index, region] of regions.entries()) {
    const output = path.join(outputDir, `${prefix}-${String(index + 1).padStart(2, '0')}.png`);
    const args = [input, '-crop', `${region.width}x${region.height}+${region.x}+${region.y}`, '+repage'];
    if (trim) args.push('-trim', '+repage', '-bordercolor', 'none', '-border', '12');
    args.push(output);
    await run(magick, args);
    outputs.push({file: output, region, inspection: await inspectImage(output)});
  }
  return outputs;
};
