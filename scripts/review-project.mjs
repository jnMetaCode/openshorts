import fs from 'node:fs/promises';
import path from 'node:path';
import {attachGenerationTrace, reviewAssets} from '../shared/review.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((item) => {const [key,...rest] = item.replace(/^--/,'').split('='); return [key,rest.join('=') || true];}));
const file = path.resolve(String(args.project ?? 'projects/sample.json')); const source = JSON.parse(await fs.readFile(file,'utf8'));
const available = source.production?.assetPlan?.map((item) => item.id) ?? [];
const assetIds = args.assets && args.assets !== 'all' ? String(args.assets).split(',').filter(Boolean) : available;
const status = String(args.status ?? 'approved'); let {project,updated} = reviewAssets(source,{assetIds,status,note:String(args.note ?? 'CLI 批量审核')});
if (args.provider || args.model || args.seed) for (const id of assetIds) project = attachGenerationTrace(project,id,{provider:String(args.provider ?? 'manual'),model:String(args.model ?? 'unknown'),seed:args.seed === true ? '' : args.seed,parameters:{source:'review-cli'}});
await fs.writeFile(file,`${JSON.stringify(project,null,2)}\n`);
console.log(`✓ ${status === 'approved' ? '已批准' : '已退回'} ${updated} 项素材：${file}`);
