import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {discoverWhisper} from './lib/whisper-discovery.mjs';

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
