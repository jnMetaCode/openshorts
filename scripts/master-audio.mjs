// 用工程里的音频素材重建音轨并替换到成片上，视频流原样复制。
// 两条渲染路径（Remotion / FFmpeg）渲完都走这一步，保证声音完全一致。
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AAC_ARGS, buildAudioGraph} from './lib/audio-master.mjs';

const run = promisify(execFile);
const root = process.cwd();
const videoPath = path.resolve(process.argv[2] ?? 'out/lychee-road.mp4');
const projectPath = path.resolve(process.argv[3] ?? 'projects/lychee-road.json');
const project = JSON.parse(await fs.readFile(projectPath, 'utf8'));
const output = path.resolve(process.argv[4] ?? videoPath);
const outDir = `${path.join(root, 'out')}${path.sep}`;
if (!videoPath.startsWith(outDir) || !output.startsWith(outDir)) throw new Error('成片源和目标必须位于 out/ 目录');

const publicFile = (src) => path.join(root, 'public', src.replace(/^\//, ''));
const totalSeconds = project.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0) / project.fps;
const {sources, filters, outLabel} = buildAudioGraph({project, totalSeconds});
if (!outLabel) throw new Error('工程里没有任何音频素材，无需母带处理');

const args = ['-y', '-v', 'error', '-i', videoPath];
for (const src of sources) args.push('-i', publicFile(src));
// 就地覆盖时先写临时文件，失败不会留下半成品。
const pending = path.join(path.dirname(output), `.${path.basename(output)}.mastering-${process.pid}.mp4`);
args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', outLabel, '-c:v', 'copy', ...AAC_ARGS,
  '-t', totalSeconds.toFixed(3), '-movflags', '+faststart', pending);
try {
  await run('ffmpeg', args, {maxBuffer: 20 * 1024 * 1024});
  await fs.rename(pending, output);
} catch (error) {
  await fs.rm(pending, {force: true});
  throw error;
}
console.log(`✓ 音频母带完成：${output}`);
console.log(`  ${sources.length} 条素材 · 旁白闪避 · 目标 -14 LUFS`);
