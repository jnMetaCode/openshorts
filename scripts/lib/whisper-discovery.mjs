import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {discoverPython} from './python-discovery.mjs';

const exists = async (file) => fs.access(file).then(() => true).catch(() => false);

const findModels = async (directory, depth = 0, maxDepth = 7) => {
  if (!directory || depth > maxDepth) return [];
  if (await exists(path.join(directory, 'model.bin')) && await exists(path.join(directory, 'config.json'))) return [directory];
  const entries = await fs.readdir(directory, {withFileTypes: true}).catch(() => []);
  const ignored = new Set(['.git', 'node_modules', 'dist', 'out', '__pycache__']);
  const nested = await Promise.all(entries.filter((entry) => entry.isDirectory() && !ignored.has(entry.name))
    .map((entry) => findModels(path.join(directory, entry.name), depth + 1, maxDepth)));
  return nested.flat();
};

export const whisperModelRank = (modelPath) => {
  const name = modelPath.toLowerCase();
  if (name.includes('large-v3-turbo')) return 55;
  if (name.includes('large-v3')) return 50;
  if (name.includes('large')) return 40;
  if (name.includes('medium')) return 30;
  if (name.includes('small')) return 20;
  if (name.includes('base')) return 10;
  if (name.includes('tiny')) return 5;
  return 0;
};

export const discoverWhisper = async (root = process.cwd()) => {
  const userDir = os.homedir();
  const [pythonResult, scannedModels] = await Promise.all([
    discoverPython({root, explicit: process.env.PAPERCUT_WHISPER_PYTHON, imports: ['faster_whisper']}),
    Promise.all([
      process.env.PAPERCUT_WHISPER_MODEL,
      path.join(root, 'models'),
      path.join(userDir, '.cache', 'huggingface', 'hub'),
      path.join(userDir, 'work'),
    ].filter(Boolean).map((directory) => findModels(path.resolve(directory)))),
  ]);
  const modelCandidates = [...new Set(scannedModels.flat())].sort((a, b) => whisperModelRank(b) - whisperModelRank(a) || a.localeCompare(b));
  return {python: pythonResult.python, modelDir: modelCandidates[0] ?? null, pythonCandidates: pythonResult.candidates, modelCandidates};
};
