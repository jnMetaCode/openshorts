import fs from 'node:fs/promises';
import path from 'node:path';
import {collectReleaseFiles, sha256File} from './lib/release-manifest.mjs';

const root = process.cwd();
const projectPath = path.resolve(process.argv[2] ?? 'projects/lychee-road.json');
const storyPath = path.resolve(process.argv[3] ?? 'content/lychee-road/story.json');
const timingsPath = path.resolve(process.argv[4] ?? 'public/audio/lychee-road/timings.json');
const videoPath = path.resolve(process.argv[5] ?? 'out/lychee-road-final-voice.mp4');
const qualityPath = path.resolve('out/quality/report.json');
const asrPath = path.resolve('out/quality/asr-report.json');
const [project, quality, asr] = await Promise.all([projectPath, qualityPath, asrPath].map(async (file) => JSON.parse(await fs.readFile(file, 'utf8'))));
if (quality.status !== 'passed') throw new Error(`媒体验收未通过：${quality.status}`);
if (asr.status !== 'passed') throw new Error(`Whisper 验收未通过：${asr.status}`);

const files = collectReleaseFiles({root, projectPath, storyPath, timingsPath, videoPath, project});
const entries = await Promise.all(files.map(async ({absolute, relative}) => {
  const stat = await fs.stat(absolute);
  return {path: relative, bytes: stat.size, sha256: await sha256File(absolute)};
}));
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: 'passed',
  project: project.id,
  video: path.relative(root, videoPath),
  quality: {status: quality.status, errors: quality.errors.length, warnings: quality.warnings.length},
  asr: {status: asr.status, language: asr.language, languageProbability: asr.languageProbability, model: asr.model},
  files: entries,
};
const output = path.resolve('out/quality/release-manifest.json');
await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
const markdown = `# ${project.title} · 发布清单

- 结论：**PASSED**
- 成片：${manifest.video}
- 媒体验收：${quality.errors.length} 错误 / ${quality.warnings.length} 警告
- Whisper：${asr.language} · ${asr.languageProbability} · ${asr.model}
- 已校验文件：${entries.length}

## SHA-256

${entries.map((entry) => `- \`${entry.sha256}\`  ${entry.path} (${entry.bytes} bytes)`).join('\n')}
`;
await fs.writeFile(output.replace(/\.json$/, '.md'), markdown);
console.log(`✓ 发布清单已生成：${output}`);
