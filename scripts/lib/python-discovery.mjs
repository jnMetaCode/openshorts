import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const exists = async (file) => fs.access(file).then(() => true).catch(() => false);
const unique = (items) => [...new Set(items.filter(Boolean).map((item) => path.resolve(item)))];

export const findVirtualenvPythons = async (directory, depth = 0, maxDepth = 7) => {
  if (!directory || depth > maxDepth) return [];
  const entries = await fs.readdir(directory, {withFileTypes: true}).catch(() => []);
  if (entries.some((entry) => entry.isFile() && entry.name === 'pyvenv.cfg')) {
    const python = path.join(directory, 'bin', 'python');
    return await exists(python) ? [python] : [];
  }
  const ignored = new Set(['.git', 'node_modules', 'dist', 'out', '__pycache__', '.cache']);
  const nested = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !ignored.has(entry.name))
    .map((entry) => findVirtualenvPythons(path.join(directory, entry.name), depth + 1, maxDepth)));
  return nested.flat();
};

export const discoverPython = async ({root = process.cwd(), explicit, imports}) => {
  const userDir = os.homedir();
  const pathPythons = String(process.env.PATH ?? '').split(path.delimiter).flatMap((directory) => [path.join(directory, 'python3'), path.join(directory, 'python')]);
  const scanned = (await Promise.all(unique([
    root,
    path.join(userDir, '.virtualenvs'),
    path.join(userDir, '.venvs'),
    path.join(userDir, 'venvs'),
    path.join(userDir, 'work'),
  ]).map((directory) => findVirtualenvPythons(directory)))).flat();
  const candidates = unique([
    explicit,
    process.env.VIRTUAL_ENV && path.join(process.env.VIRTUAL_ENV, 'bin', 'python'),
    path.join(root, '.venv', 'bin', 'python'),
    path.join(root, 'venv', 'bin', 'python'),
    ...pathPythons,
    ...scanned,
  ]);
  const statement = imports.map((name) => `import ${name}`).join('; ');
  for (const candidate of candidates) {
    if (!await exists(candidate)) continue;
    const supported = await run(candidate, ['-c', statement], {timeout: 20000}).then(() => true).catch(() => false);
    if (supported) return {python: candidate, candidates};
  }
  return {python: null, candidates};
};
