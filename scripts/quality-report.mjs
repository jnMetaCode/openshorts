import path from 'node:path';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {analyzeProject, mediaSummaryFromProbe} from './lib/quality.mjs';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectPath = path.resolve(process.argv[3] ?? path.join(root, 'projects', 'sample.json'));
const project = JSON.parse(await fs.readFile(projectPath, 'utf8'));
const videoPath = path.resolve(process.argv[2] ?? path.join(root, 'out', `${project.id}.mp4`));
const reportDir = path.join(root, 'out', 'quality');
await fs.mkdir(reportDir, {recursive: true});

const {stdout} = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', videoPath], {maxBuffer: 10 * 1024 * 1024});
const media = mediaSummaryFromProbe(JSON.parse(stdout));
const analysis = analyzeProject({project, media, publicDir: path.join(root, 'public')});
let audioLoudness = null;
if (media.audioCodec) {
  const measured = await run('ffmpeg', ['-hide_banner', '-i', videoPath, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-']).catch((error) => ({stderr:error.stderr ?? ''}));
  const values = [...String(measured.stderr ?? '').matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s+LUFS/g)].map((match) => Number(match[1]));
  const peaks = [...String(measured.stderr ?? '').matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s+dBFS/g)].map((match) => Number(match[1]));
  if (values.length) audioLoudness = {integratedLufs:values.at(-1),truePeakDbfs:peaks.at(-1) ?? null};
  if (!audioLoudness) analysis.errors.push('音轨存在，但无法测得有效响度');
  else if (audioLoudness.integratedLufs < -30) analysis.errors.push(`音轨过小：${audioLoudness.integratedLufs.toFixed(1)} LUFS`);
  else analysis.passes.push(`音频响度 ${audioLoudness.integratedLufs.toFixed(1)} LUFS`);
  analysis.status = analysis.errors.length ? 'failed' : analysis.warnings.length ? 'warning' : 'passed';
}
const frames = [];
let sceneStart = 0;
for (const [index, scene] of project.scenes.entries()) {
  const at = sceneStart + scene.durationFrames / project.fps / 2;
  const filename = `${project.id}-scene-${String(index + 1).padStart(2, '0')}.png`;
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(at), '-i', videoPath, '-frames:v', '1', path.join(reportDir, filename)]);
  frames.push({scene: scene.name, at, file: filename});
  sceneStart += scene.durationFrames / project.fps;
}

const report = {generatedAt: new Date().toISOString(), project: {id: project.id, title: project.title}, video: path.basename(videoPath), media, audioLoudness, ...analysis, frames};
await fs.writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const bullets = (items) => items.length ? items.map((item) => `- ${item}`).join('\n') : '- 无';
const markdown = `# ${project.title} · 自动验收报告

- 结论：**${analysis.status.toUpperCase()}**
- 视频：${path.basename(videoPath)}
- 规格：${media.width}×${media.height} · ${media.fps} FPS · ${media.duration.toFixed(2)}s
- 编码：${media.videoCodec ?? '无'} / ${media.audioCodec ?? '无'}${media.audioProfile ? ` ${media.audioProfile}` : ''}
- 音轨：${media.audioSampleRate ? `${media.audioSampleRate / 1000} kHz · ${media.audioChannelLayout ?? `${media.audioChannels} 声道`} · ${media.audioDuration?.toFixed(2) ?? '未知'}s` : '未检测'}
- 音频响度：${audioLoudness ? `${audioLoudness.integratedLufs.toFixed(1)} LUFS · 峰值 ${audioLoudness.truePeakDbfs?.toFixed(1) ?? '未知'} dBFS` : '未测得'}
- 文件大小：${(media.size / 1024 / 1024).toFixed(2)} MB

## 错误

${bullets(analysis.errors)}

## 警告

${bullets(analysis.warnings)}

## 通过项

${bullets(analysis.passes)}

## 镜头抽帧

${frames.map((frame) => `- ${frame.scene}（${frame.at.toFixed(2)}s）：[${frame.file}](${frame.file})`).join('\n')}
`;
await fs.writeFile(path.join(reportDir, 'report.md'), markdown);
console.log(`✓ 验收结论：${analysis.status}，${analysis.errors.length} 错误，${analysis.warnings.length} 警告`);
console.log(`报告：${path.join(reportDir, 'report.md')}`);
if (analysis.errors.length && process.env.QUALITY_ALLOW_FAILURE !== '1') process.exitCode = 1;
