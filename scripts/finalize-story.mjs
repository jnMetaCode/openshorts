import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const root = process.cwd();
const source = path.resolve(process.argv[2] ?? 'out/lychee-road.mp4');
const target = path.resolve(process.argv[3] ?? 'out/lychee-road-final-voice.mp4');
const project = path.resolve(process.argv[4] ?? 'projects/lychee-road.json');
const outDir = `${path.join(root, 'out')}${path.sep}`;
if (!source.startsWith(outDir) || !target.startsWith(outDir)) throw new Error('成片源和目标必须位于 out/ 目录');
await fs.access(source);
await fs.access(project);

const pending = `${target}.pending-${process.pid}`;
await fs.copyFile(source, pending);
await fs.rename(pending, target);
const {stdout, stderr} = await run(process.execPath, ['scripts/quality-report.mjs', target, project], {cwd: root, maxBuffer: 20 * 1024 * 1024});
process.stdout.write(stdout);
process.stderr.write(stderr);
console.log(`✓ 正式成片已原子更新：${target}`);
