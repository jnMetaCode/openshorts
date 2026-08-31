import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const isRemote = (src) => /^(https?:|data:|blob:)/.test(src);

export const collectReleaseFiles = ({root, projectPath, storyPath, timingsPath, videoPath, project}) => {
  const files = new Set([projectPath, storyPath, timingsPath, videoPath].map((file) => path.resolve(file)));
  const publicSources = [
    project.soundtrackSrc,
    ...project.scenes.flatMap((scene) => [
      scene.narrationSrc,
      ...(scene.audioCues ?? []).map((cue) => cue.src),
      ...scene.layers.filter((layer) => layer.kind !== 'text').map((layer) => layer.src),
    ]),
  ].filter((src) => src && !isRemote(src));
  for (const src of publicSources) files.add(path.resolve(root, 'public', src.replace(/^\//, '')));
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  for (const file of files) if (!file.startsWith(rootPrefix)) throw new Error(`发布文件越出项目目录：${file}`);
  // relative 是"归档里的路径"，不是本机路径——Windows 上 path.relative 给出 a\\b，
  // 打进包里会变成一个名字带反斜杠的文件。归档路径一律用正斜杠。
  return [...files].sort().map((file) => ({absolute: file, relative: path.relative(root, file).split(path.sep).join('/')}));
};

export const sha256File = (file) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const input = fs.createReadStream(file);
  input.on('error', reject);
  input.on('data', (chunk) => hash.update(chunk));
  input.on('end', () => resolve(hash.digest('hex')));
});
