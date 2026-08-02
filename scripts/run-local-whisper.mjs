import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {discoverWhisper} from './lib/whisper-discovery.mjs';
import {checkNarrationCoverage} from './lib/asr-coverage.mjs';

const inputArg = process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? 'out/lychee-road-final-voice.mp4';
const input = path.resolve(inputArg);
await fs.access(input).catch(() => { throw new Error(`待验收视频不存在：${input}`); });
const discovered = await discoverWhisper();
if (!discovered.python || !discovered.modelDir) {
  const missing = [!discovered.python && '可导入 faster_whisper 的 Python 环境', !discovered.modelDir && '本地 Faster-Whisper 模型'].filter(Boolean).join('、');
  throw new Error(`未找到${missing}。可设置 PAPERCUT_WHISPER_PYTHON 与 PAPERCUT_WHISPER_MODEL 后重试。`);
}
console.log(`✓ Whisper Python：${discovered.python}`);
console.log(`✓ Whisper 模型：${discovered.modelDir}`);
if (process.argv.includes('--check')) process.exit(0);

const output = path.resolve('out/quality/asr-report.json');
await fs.mkdir(path.dirname(output), {recursive: true});
const child = execFile(discovered.python, [
  'scripts/verify-story-asr.py', '--input', input, '--model', discovered.modelDir,
  '--output', output, '--expected-language', 'zh', '--minimum-probability', '0.9',
], {cwd: process.cwd()});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
await new Promise((resolve, reject) => child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Whisper 验收退出码 ${code}`))).once('error', reject));

// Python 那步只回答「有没有中文人声」。这里再比对一次内容，
// 抓漏段、错序和「混进了别的故事的旁白」这类它看不见的事故。
const storyName = process.argv.slice(2).find((item) => item.startsWith('--story='))?.split('=')[1]
  ?? path.basename(input).replace(/-final-voice\.mp4$|\.mp4$/, '');
const storyPath = path.resolve('content', storyName, 'story.json');
const story = await fs.readFile(storyPath, 'utf8').then(JSON.parse).catch(() => null);
if (!story) {
  console.log(`· 未找到 ${path.relative(process.cwd(), storyPath)}，跳过旁白内容比对`);
} else {
  const report = JSON.parse(await fs.readFile(output, 'utf8'));
  const coverage = checkNarrationCoverage({storySegments: story.segments, transcriptSegments: report.segments});
  report.coverage = coverage;
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  const failed = coverage.segments.filter((item) => !item.passed);
  console.log(`${coverage.passed ? '✓' : '✗'} 旁白内容比对：${coverage.segments.length - failed.length}/${coverage.segments.length} 段匹配，最低 ${coverage.lowest}（阈值 ${coverage.threshold}）`);
  for (const item of failed) console.error(`  ✗ ${item.id}（${item.ratio}）：${item.text.slice(0, 24)}…`);
  if (!failed.length) console.log('  同音错字不影响判定，阈值按真实转写数据标定');
  else {
    console.error('  成片里没有念到这些内容。检查旁白是否漏段、顺序是否错位、是否混入了别的故事。');
    process.exitCode = 1;
  }
}
