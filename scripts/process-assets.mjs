import path from 'node:path';
import {inspectImage, removeColor, splitSheet} from './lib/assets.mjs';

const [command, inputArg, outputArg, ...options] = process.argv.slice(2);
if (!command || !inputArg) {
  console.log('用法：\n  npm run assets -- inspect <input>\n  npm run assets -- key <input> <output.png> [#00ff00] [fuzz]\n  npm run assets -- split <input> <output-dir> [rows] [columns] [prefix]');
  process.exit(1);
}
const input = path.resolve(inputArg);
if (command === 'inspect') console.log(JSON.stringify(await inspectImage(input), null, 2));
else if (command === 'key') {
  if (!outputArg) throw new Error('缺少输出 PNG 路径');
  const result = await removeColor({input, output: path.resolve(outputArg), color: options[0] ?? '#00ff00', fuzz: Number(options[1] ?? 12), trim: options[2] !== 'preserve'});
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'split') {
  if (!outputArg) throw new Error('缺少输出目录');
  const result = await splitSheet({input, outputDir: path.resolve(outputArg), rows: Number(options[0] ?? 1), columns: Number(options[1] ?? 1), prefix: options[2] ?? 'layer'});
  console.log(JSON.stringify(result, null, 2));
} else throw new Error(`未知命令：${command}`);
