import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {discoverPython} from './python-discovery.mjs';

const exists = async (file) => fs.access(file).then(() => true).catch(() => false);
const unique = (items) => [...new Set(items.filter(Boolean).map((item) => path.resolve(item)))];

const modelCandidates = async (root) => {
  const userDir = os.homedir();
  const hubRoot = process.env.HUGGINGFACE_HUB_CACHE
    ?? path.join(process.env.HF_HOME ?? path.join(userDir, '.cache', 'huggingface'), 'hub');
  const snapshotRoots = ['Kokoro-82M-v1.1-zh', 'Kokoro-82M'].map((name) => path.join(hubRoot, `models--hexgrad--${name}`, 'snapshots'));
  const snapshots = (await Promise.all(snapshotRoots.map(async (snapshotRoot) =>
    (await fs.readdir(snapshotRoot, {withFileTypes: true}).catch(() => []))
      .filter((entry) => entry.isDirectory()).map((entry) => path.join(snapshotRoot, entry.name))))).flat();
  return unique([
    process.env.PAPERCUT_KOKORO_MODEL_DIR,
    path.join(root, 'models', 'Kokoro-82M-v1.1-zh'),
    path.join(root, 'models', 'Kokoro-82M'),
    path.join(userDir, '.cache', 'huggingface', 'opentone_modelscope', 'hexgrad', 'Kokoro-82M-v1.1-zh'),
    path.join(userDir, '.cache', 'huggingface', 'opentone_modelscope', 'hexgrad', 'Kokoro-82M'),
    path.join(userDir, '.cache', 'modelscope', 'hub', 'models', 'hexgrad', 'Kokoro-82M-v1.1-zh'),
    path.join(userDir, '.cache', 'modelscope', 'hub', 'models', 'hexgrad', 'Kokoro-82M'),
    ...snapshots,
  ]);
};

export const discoverKokoro = async (root = process.cwd()) => {
  const discoveredPython = await discoverPython({root, explicit: process.env.PAPERCUT_KOKORO_PYTHON, imports: ['kokoro', 'numpy', 'soundfile']});
  const {python} = discoveredPython;

  const candidates = await modelCandidates(root);
  let modelDir = null;
  for (const candidate of candidates) {
    const variants = [
      ['config.json', 'kokoro-v1_1-zh.pth', path.join('voices', 'zf_001.pt')],
      ['config.json', 'kokoro-v1_0.pth', path.join('voices', 'zf_xiaoxiao.pt')],
    ];
    if ((await Promise.all(variants.map(async (required) => (await Promise.all(required.map((file) => exists(path.join(candidate, file))))).every(Boolean)))).some(Boolean)) { modelDir = candidate; break; }
  }
  return {python, modelDir, pythonCandidates: discoveredPython.candidates, modelCandidates: candidates};
};
