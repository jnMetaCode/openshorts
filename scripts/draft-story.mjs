// 话题一键起稿：node scripts/draft-story.mjs <故事名> --topic="..." [--format=16:9] [--segments=6]
//
// 产出 content/<故事名>/{story,storyboard,assets}.json 草稿，随后走常规流水线：
//   npm run story -- <故事名> audio && npm run story -- <故事名> render
// 需要 OPENSHORTS_PLANNER_URL（OpenAI 兼容 Chat Completions，JSON 输出）。
import fs from 'node:fs/promises';
import path from 'node:path';
import {contentOf, parseModelJson} from '../server/lib/planner.mjs';
import {buildStoryFiles, draftPrompt, normalizeDraft} from './lib/story-draft.mjs';

const root = process.cwd();
const positional = process.argv.slice(2).filter((item) => !item.startsWith('-'));
const flag = (key) => process.argv.slice(2).find((item) => item.startsWith(`--${key}=`))?.split('=').slice(1).join('=');
const name = positional[0];
const topic = flag('topic');

if (!name || !topic) {
  console.error(`用法：node scripts/draft-story.mjs <故事名> --topic="话题" [选项]

选项：
  --format=9:16|16:9   画幅，默认竖屏
  --segments=6         段数（3-12）
  --force              覆盖已存在的草稿

需要环境变量 OPENSHORTS_PLANNER_URL（可选 OPENSHORTS_PLANNER_MODEL / OPENSHORTS_PLANNER_API_KEY）。
产出的是可审阅草稿，不是成片——请先打开 content/<故事名>/ 校对文案与事实，再生成旁白。`);
  process.exit(1);
}

if (!process.env.OPENSHORTS_PLANNER_URL) throw new Error('未设置 OPENSHORTS_PLANNER_URL——话题起稿需要一个 OpenAI 兼容的模型服务');
const storyDir = path.join(root, 'content', name.replace(/[^a-z0-9-]/gi, '-').toLowerCase());
const exists = await fs.access(path.join(storyDir, 'story.json')).then(() => true).catch(() => false);
if (exists && !process.argv.includes('--force')) throw new Error(`${path.relative(root, storyDir)}/story.json 已存在；覆盖请加 --force`);

const format = flag('format') === '16:9' ? '16:9' : '9:16';
const segments = Math.min(12, Math.max(3, Number(flag('segments') ?? 6)));

console.log(`向 ${process.env.OPENSHORTS_PLANNER_URL} 请求草稿…`);
const response = await fetch(process.env.OPENSHORTS_PLANNER_URL, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(process.env.OPENSHORTS_PLANNER_API_KEY ? {authorization: `Bearer ${process.env.OPENSHORTS_PLANNER_API_KEY}`} : {}),
  },
  body: JSON.stringify({
    model: process.env.OPENSHORTS_PLANNER_MODEL ?? 'default',
    response_format: {type: 'json_object'},
    messages: [
      {role: 'system', content: '你是短视频编剧与信息设计师，只输出有效 JSON。'},
      {role: 'user', content: draftPrompt(topic, {segments})},
    ],
  }),
});
if (!response.ok) throw new Error(`起稿请求失败：HTTP ${response.status}`);
const draft = normalizeDraft(parseModelJson(contentOf(await response.json())));
const files = buildStoryFiles({draft, name: path.basename(storyDir), format});

await fs.mkdir(storyDir, {recursive: true});
await fs.writeFile(path.join(storyDir, 'story.json'), `${JSON.stringify(files.story, null, 2)}\n`);
await fs.writeFile(path.join(storyDir, 'storyboard.json'), `${JSON.stringify(files.storyboard, null, 2)}\n`);
const assetsPath = path.join(storyDir, 'assets.json');
if (!await fs.access(assetsPath).then(() => true).catch(() => false)) await fs.writeFile(assetsPath, '{}\n');

console.log(`✓ 草稿已生成：《${files.story.title}》 ${draft.segments.length} 段 · ${format} · 约 ${files.story.targetSeconds}s`);
console.log(`  ${path.relative(root, storyDir)}/{story,storyboard,assets}.json`);
console.log('\n下一步（草稿先人工校对，尤其是事实与数字）：');
console.log(`  npm run story -- ${path.basename(storyDir)} audio`);
console.log(`  npm run story -- ${path.basename(storyDir)} render`);
