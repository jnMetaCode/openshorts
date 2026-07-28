import fs from 'node:fs/promises';
import path from 'node:path';
import {buildStoryboard, createDraftProject, storyboardMarkdown} from '../shared/storyboard.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((item) => {const index = item.indexOf('='); return index === -1 ? [item.replace(/^--/, ''), true] : [item.slice(2, index), item.slice(index + 1)];}));
const title = args.title || '长安的一天';
const text = args.text || '长安城从晨雾中醒来。来自远方的使者穿过朱雀大街。宫门缓缓开启，盛唐的故事由此展开。';
const id = args.id || 'storyboard-demo';
const board = buildStoryboard({title, text, styleId: args.style || 'tang-collage', aspect: args.aspect || '16:9', characterBible: args.characters || '主角：唐代青年，深青色圆领袍，黑色幞头，二十五岁'});
const project = createDraftProject(board, id);
const output = path.resolve(args.output || `projects/${id}.json`); const brief = path.resolve(args.brief || `out/briefs/${id}-asset-brief.md`);
await fs.mkdir(path.dirname(output), {recursive: true}); await fs.mkdir(path.dirname(brief), {recursive: true});
await fs.writeFile(output, `${JSON.stringify(project, null, 2)}\n`); await fs.writeFile(brief, storyboardMarkdown(board));
console.log(`✓ 已生成 ${board.scenes.length} 个镜头，预计 ${(board.totalFrames / board.fps).toFixed(1)} 秒`);
console.log(`项目：${output}\n需求单：${brief}`);
