// 与服务端写入路径共用同一份 Zod schema，避免「CLI 说通过、存进去却渲不出来」。
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseProject} from '../shared/project-schema.mjs';

const projectPath = path.resolve(process.argv[2] ?? 'projects/sample.json');
const result = parseProject(JSON.parse(await fs.readFile(projectPath, 'utf8')));
if (!result.ok) {
  console.error(result.errors.map((item) => `✗ ${item}`).join('\n'));
  process.exit(1);
}
const project = result.project;
const layers = project.scenes.reduce((sum, scene) => sum + scene.layers.length, 0);
const frames = project.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0);
console.log(`✓ ${project.title}：${project.scenes.length} 个镜头，${layers} 个图层，${(frames / project.fps).toFixed(1)} 秒`);
