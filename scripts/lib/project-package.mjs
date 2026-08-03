import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const isRemote = (src) => /^(https?:|data:|blob:)/.test(src);

export const collectAssetPaths = (project) => {
  const assets = new Set();
  if (project.soundtrackSrc && !isRemote(project.soundtrackSrc)) assets.add(project.soundtrackSrc.replace(/^\//, ''));
  for (const scene of project.scenes ?? []) {
    if (scene.narrationSrc && !isRemote(scene.narrationSrc)) assets.add(scene.narrationSrc.replace(/^\//, ''));
    for (const cue of scene.audioCues ?? []) if (!isRemote(cue.src)) assets.add(cue.src.replace(/^\//, ''));
    for (const layer of scene.layers ?? []) if (layer.src && layer.kind !== 'text' && !isRemote(layer.src)) assets.add(layer.src.replace(/^\//, ''));
  }
  return [...assets];
};

export const validateArchiveEntries = (entries) => {
  const errors = [];
  for (const raw of entries) {
    const entry = raw.replaceAll('\\', '/');
    const parts = entry.split('/');
    if (!entry || entry.startsWith('/') || /^[a-zA-Z]:/.test(entry) || parts.includes('..')) errors.push(`不安全的压缩包路径：${raw}`);
  }
  return errors;
};

const resolveInside = (root, relative) => {
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`路径超出允许目录：${relative}`);
  return target;
};

export const exportProjectBundle = async ({project, publicDir, output}) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'openshorts-export-'));
  try {
    await fs.writeFile(path.join(temp, 'project.json'), `${JSON.stringify(project, null, 2)}\n`);
    const assets = collectAssetPaths(project);
    for (const src of assets) {
      const source = resolveInside(publicDir, src); const target = resolveInside(path.join(temp, 'public'), src);
      await fs.mkdir(path.dirname(target), {recursive: true}); await fs.copyFile(source, target);
    }
    await fs.writeFile(path.join(temp, 'manifest.json'), `${JSON.stringify({format: 'openshorts-project', version: 1, projectId: project.id, assets, exportedAt: new Date().toISOString()}, null, 2)}\n`);
    await fs.mkdir(path.dirname(output), {recursive: true});
    await fs.rm(output, {force: true});
    await run('zip', ['-q', '-r', output, '.'], {cwd: temp});
    return {output, assets: assets.length};
  } finally { await fs.rm(temp, {recursive: true, force: true}); }
};

const replaceAssetPaths = (project, replacements) => {
  const replace = (src) => src && replacements.get(src.replace(/^\//, '')) ? replacements.get(src.replace(/^\//, '')) : src;
  project.soundtrackSrc = replace(project.soundtrackSrc);
  for (const scene of project.scenes ?? []) {
    scene.narrationSrc = replace(scene.narrationSrc);
    scene.audioCues = (scene.audioCues ?? []).map((cue) => ({...cue, src: replace(cue.src)}));
    for (const layer of scene.layers ?? []) if (layer.src) layer.src = replace(layer.src);
  }
  return project;
};

export const importProjectBundle = async ({archive, publicDir, namespace}) => {
  const {stdout} = await run('unzip', ['-Z1', archive], {maxBuffer: 10 * 1024 * 1024});
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  const errors = validateArchiveEntries(entries); if (errors.length) throw new Error(errors.join('\n'));
  if (entries.length > 5000) throw new Error('项目包文件数量超过 5000');
  const {stdout: totals} = await run('unzip', ['-Z', '-t', archive]);
  const uncompressed = Number(totals.match(/(\d+) bytes uncompressed/)?.[1] ?? 0);
  if (uncompressed > 1024 * 1024 * 1024) throw new Error('项目包解压后超过 1GB');
  if (!entries.includes('project.json')) throw new Error('压缩包缺少 project.json');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'openshorts-import-'));
  try {
    await run('unzip', ['-q', archive, '-d', temp]);
    const project = JSON.parse(await fs.readFile(path.join(temp, 'project.json'), 'utf8'));
    const replacements = new Map(); let index = 0;
    for (const src of collectAssetPaths(project)) {
      const source = resolveInside(path.join(temp, 'public'), src);
      await fs.access(source);
      const realPublic = await fs.realpath(path.join(temp, 'public')); const realSource = await fs.realpath(source);
      if (!realSource.startsWith(`${realPublic}${path.sep}`) || !(await fs.lstat(realSource)).isFile()) throw new Error(`项目包素材不是安全的普通文件：${src}`);
      const targetRelative = `uploads/${namespace}/${String(++index).padStart(3, '0')}-${path.basename(src)}`;
      const target = resolveInside(publicDir, targetRelative);
      await fs.mkdir(path.dirname(target), {recursive: true}); await fs.copyFile(source, target);
      replacements.set(src, targetRelative);
    }
    return {project: replaceAssetPaths(project, replacements), assets: replacements.size};
  } finally { await fs.rm(temp, {recursive: true, force: true}); }
};
