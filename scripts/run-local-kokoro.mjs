import {execFile} from 'node:child_process';
import {discoverKokoro} from './lib/kokoro-discovery.mjs';

const discovered = await discoverKokoro();
if (!discovered.python || !discovered.modelDir) {
  const missing = [!discovered.python && '可导入 kokoro/numpy/soundfile 的 Python 环境', !discovered.modelDir && '完整的 Kokoro-82M 模型缓存'].filter(Boolean).join('、');
  throw new Error(`未找到${missing}。可设置 PAPERCUT_KOKORO_PYTHON 与 PAPERCUT_KOKORO_MODEL_DIR 后重试。`);
}
console.log(`✓ Kokoro Python：${discovered.python}`);
console.log(`✓ Kokoro 模型：${discovered.modelDir}`);
if (process.argv.includes('--check')) process.exit(0);

const child = execFile(discovered.python, [
  'scripts/generate-kokoro-story.py',
  '--story', 'content/lychee-road/story.json',
  '--output', 'public/audio/lychee-road',
  '--model-dir', discovered.modelDir,
], {cwd: process.cwd()});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
await new Promise((resolve, reject) => child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Kokoro 退出码 ${code}`))).once('error', reject));
console.log('✓ 本地 Kokoro 旁白已生成；正在按真实语音时长重建工程');
