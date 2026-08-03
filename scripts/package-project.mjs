import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {exportProjectBundle, importProjectBundle} from './lib/project-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command, first, second] = process.argv.slice(2);
if (command === 'export') {
  const projectFile = path.resolve(first ?? path.join(root, 'projects', 'sample.json'));
  const project = JSON.parse(await fs.readFile(projectFile, 'utf8'));
  const output = path.resolve(second ?? path.join(root, 'out', 'exports', `${project.id}.openshorts.zip`));
  const result = await exportProjectBundle({project, publicDir: path.join(root, 'public'), output});
  console.log(`✓ 已打包 ${result.assets} 个素材：${result.output}`);
} else if (command === 'import') {
  if (!first) throw new Error('缺少 .openshorts.zip 文件');
  const result = await importProjectBundle({archive: path.resolve(first), publicDir: path.join(root, 'public'), namespace: `cli-${Date.now()}`});
  const output = path.resolve(second ?? path.join(root, 'projects', `${result.project.id}-import.json`));
  await fs.writeFile(output, `${JSON.stringify(result.project, null, 2)}\n`);
  console.log(`✓ 已导入 ${result.assets} 个素材：${output}`);
} else {
  console.log('用法：npm run bundle -- export [project.json] [output.zip]\n      npm run bundle -- import <bundle.zip> [output.json]');
  process.exit(1);
}
