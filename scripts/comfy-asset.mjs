// 用 ComfyUI 生成素材并自动记录溯源：
//   npm run comfy -- <故事名> --workflow=wf.json --name=hou-yi [--layer] [--role=primary]
//
// 把「生成」和「记录」合成一步。分成两步时人总会忘，荔枝道那 5 张 PNG 就是这么丢的来源。
import fs from 'node:fs/promises';
import path from 'node:path';
import {runComfyWorkflow} from '../server/lib/comfyui.mjs';
import {extractComfyTrace, isReproducible} from '../shared/comfy-trace.mjs';
import {inspectImage} from './lib/assets.mjs';

const root = process.cwd();
const positional = process.argv.slice(2).filter((item) => !item.startsWith('-'));
const flag = (key) => process.argv.slice(2).find((item) => item.startsWith(`--${key}=`))?.split('=').slice(1).join('=');
const has = (key) => process.argv.slice(2).includes(`--${key}`);
const story = positional[0];
const workflowPath = flag('workflow');
const assetName = flag('name');
const endpoint = process.env.COMFYUI_URL;

if (!story || !workflowPath || !assetName) {
  console.error(`用法：npm run comfy -- <故事名> --workflow=<API workflow.json> --name=<素材名> [选项]

选项：
  --layer          放进 layers/ 子目录（人物等前景件），默认放故事根目录（背景）
  --role=primary   素材在分镜里的角色，仅作记录
  --license=CC0    许可协议
  --timeout=180    超时秒数

需要先设置 COMFYUI_URL，例如：
  COMFYUI_URL=http://127.0.0.1:8188 npm run comfy -- nine-suns --workflow=wf.json --name=hou-yi --layer

工作流必须是 ComfyUI 的 **API 格式** JSON（Save (API Format) 导出），
不是界面上的 Save。model、seed、提示词会从里面自动解析并记入 assets.json。`);
  process.exit(1);
}

if (!endpoint) throw new Error('未设置 COMFYUI_URL');

const storyDir = path.join(root, 'content', story);
await fs.access(storyDir).catch(() => { throw new Error(`故事不存在：content/${story}`); });

const workflow = JSON.parse(await fs.readFile(path.resolve(workflowPath), 'utf8'));
const trace = extractComfyTrace(workflow);
if (!isReproducible(trace)) {
  console.warn(`! 工作流里没解析出${trace.model === 'unknown' ? '模型' : ''}${trace.seed === undefined ? '（以及随机种子）' : ''}，这张图将无法复现`);
  console.warn('  确认导出的是 API 格式的 workflow，而不是界面 workflow');
}

console.log(`提交工作流到 ${endpoint} …`);
const result = await runComfyWorkflow({
  endpoint, workflow,
  timeoutMs: Number(flag('timeout') ?? 180) * 1000,
  onPoll: ({polls}) => process.stdout.write(`\r  轮询 ${polls} 次…`),
});
process.stdout.write('\n');
if (!result.images.length) throw new Error('ComfyUI 没有返回图片');

const safeName = assetName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'asset';
const subdir = has('layer') ? 'layers' : '';
const targetDir = path.join(root, 'public/assets/generated', story, subdir);
await fs.mkdir(targetDir, {recursive: true});

const recordPath = path.join(storyDir, 'assets.json');
const records = await fs.readFile(recordPath, 'utf8').then(JSON.parse).catch(() => ({}));

const written = [];
for (const [index, image] of result.images.entries()) {
  const suffix = result.images.length > 1 ? `-${String(index + 1).padStart(2, '0')}` : '';
  const filename = `${safeName}${suffix}.png`;
  const file = path.join(targetDir, filename);
  await fs.writeFile(file, image.data);
  const inspection = await inspectImage(file);
  const relative = path.relative(path.join(root, 'public'), file);

  records[relative] = {
    ...trace,
    workflowId: result.promptId,
    ...(flag('license') ? {license: flag('license')} : {}),
    ...(flag('role') ? {role: flag('role')} : {}),
    parameters: {...trace.parameters, workflowFile: path.basename(workflowPath)},
    bytes: image.data.length,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  written.push({relative, inspection});
}

await fs.writeFile(recordPath, `${JSON.stringify(records, null, 2)}\n`);

console.log(`✓ 已生成 ${written.length} 张并记录溯源`);
for (const {relative, inspection} of written) {
  const flags = [
    `${inspection.width}×${inspection.height}`,
    inspection.hasTransparency ? '有透明通道' : '! 无透明通道',
    inspection.touchesEdge ? '! 内容贴边' : '边距正常',
  ];
  console.log(`  public/${relative}  ${flags.join(' · ')}`);
}
console.log(`  模型 ${trace.model}${trace.seed !== undefined ? ` · seed ${trace.seed}` : ''} · prompt ${result.promptId}`);
console.log(`\n下一步：把素材写进 content/${story}/storyboard.json 的图层，再 npm run story -- ${story} render`);
