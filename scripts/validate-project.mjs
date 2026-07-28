import fs from 'node:fs/promises';
import path from 'node:path';

const projectPath = path.resolve(process.argv[2] ?? 'projects/sample.json');
const project = JSON.parse(await fs.readFile(projectPath, 'utf8'));
const errors = [];
if (project.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
if (!project.id || !project.title) errors.push('缺少 id 或 title');
if (!Number.isInteger(project.fps) || project.fps < 12 || project.fps > 60) errors.push('fps 必须是 12-60 的整数');
if (!Array.isArray(project.scenes) || !project.scenes.length) errors.push('至少需要一个镜头');
const ids = new Set();
for (const [sceneIndex, scene] of (project.scenes ?? []).entries()) {
  if (!Number.isInteger(scene.durationFrames) || scene.durationFrames <= 0) errors.push(`镜头 ${sceneIndex + 1} 时长无效`);
  for (const layer of (scene.layers ?? [])) {
    if (ids.has(layer.id)) errors.push(`图层 id 重复：${layer.id}`); ids.add(layer.id);
    if (!layer.src || !Number.isFinite(layer.x) || !Number.isFinite(layer.y) || !(layer.width > 0)) errors.push(`图层 ${layer.id ?? '?'} 缺少有效素材或布局参数`);
  }
}
if (errors.length) { console.error(errors.map((item) => `✗ ${item}`).join('\n')); process.exit(1); }
const frames = project.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0);
console.log(`✓ ${project.title}：${project.scenes.length} 个镜头，${ids.size} 个图层，${(frames / project.fps).toFixed(1)} 秒`);
