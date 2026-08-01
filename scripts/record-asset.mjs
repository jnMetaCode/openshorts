// 记录素材溯源：node scripts/record-asset.mjs <故事名> <素材路径> --provider=... [选项]
//
// 生成完一张图就立刻跑这条，来源才不会丢。荔枝道那 5 张 PNG 就是因为没有这一步，
// 元数据被抠图环节清掉后再也查不回来了。
import fs from 'node:fs/promises';
import path from 'node:path';
import {PROVIDERS} from './lib/asset-provenance.mjs';

const root = process.cwd();
const positional = process.argv.slice(2).filter((item) => !item.startsWith('-'));
const flag = (key) => process.argv.slice(2).find((item) => item.startsWith(`--${key}=`))?.split('=').slice(1).join('=');
const [name, assetPath] = positional;
const provider = flag('provider');

if (!name || !assetPath || !provider) {
  console.error(`用法：node scripts/record-asset.mjs <故事名> <素材路径> --provider=<来源> [选项]

来源（--provider）：
${Object.entries(PROVIDERS).map(([id, meta]) => `  ${id.padEnd(16)} ${meta.label}${meta.licensable ? '' : '（不可商用）'}`).join('\n')}

选项：
  --model=flux.1-dev        生成模型
  --seed=42                 随机种子，用于复现
  --workflow=<id>           ComfyUI 工作流 id
  --prompt="..."            生成提示词
  --license="CC0"           许可协议
  --credit="作者"            署名
  --note="..."              备注

素材路径相对 public/，例：assets/generated/nine-suns/layers/sun-crow.svg

例：
  node scripts/record-asset.mjs nine-suns assets/generated/nine-suns/layers/hou-yi.png \\
    --provider=comfyui --model=flux.1-dev --seed=42 --prompt="剪纸风格弓箭手，纯绿背景" --license=CC0`);
  process.exit(1);
}

if (!PROVIDERS[provider]) throw new Error(`未知来源 ${provider}，可选：${Object.keys(PROVIDERS).join('、')}`);

const relative = assetPath.replace(/^\/+/, '').replace(/^public\//, '');
const file = path.resolve(root, 'public', relative);
if (!file.startsWith(`${path.join(root, 'public')}${path.sep}`)) throw new Error('素材路径必须位于 public/ 内');
await fs.access(file).catch(() => { throw new Error(`素材不存在：public/${relative}`); });

const recordPath = path.join(root, 'content', name, 'assets.json');
const records = await fs.readFile(recordPath, 'utf8').then(JSON.parse).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
  return {};
});

if (PROVIDERS[provider].needsModel && !flag('model')) throw new Error(`--provider=${provider} 必须同时提供 --model`);

const {size} = await fs.stat(file);
records[relative] = {
  provider,
  ...(flag('model') ? {model: flag('model')} : {}),
  ...(flag('seed') ? {seed: flag('seed')} : {}),
  ...(flag('workflow') ? {workflowId: flag('workflow')} : {}),
  ...(flag('prompt') ? {prompt: flag('prompt')} : {}),
  ...(flag('license') ? {license: flag('license')} : {}),
  ...(flag('credit') ? {credit: flag('credit')} : {}),
  ...(flag('note') ? {note: flag('note')} : {}),
  bytes: size,
  createdAt: new Date().toISOString().slice(0, 10),
};

await fs.mkdir(path.dirname(recordPath), {recursive: true});
await fs.writeFile(recordPath, `${JSON.stringify(records, null, 2)}\n`);

const unknown = Object.entries(records).filter(([, value]) => value.provider === 'unknown');
console.log(`✓ 已记录：${relative}`);
console.log(`  来源 ${PROVIDERS[provider].label}${flag('model') ? ` · ${flag('model')}` : ''}${flag('seed') ? ` · seed ${flag('seed')}` : ''}`);
console.log(`  ${recordPath.replace(`${root}/`, '')} 现有 ${Object.keys(records).length} 条记录`);
if (unknown.length) console.log(`! 仍有 ${unknown.length} 个素材来源未知：${unknown.map(([key]) => key.split('/').pop()).join('、')}`);
else console.log('✓ 该故事所有素材来源可查');
