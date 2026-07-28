import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectPath = path.resolve(process.argv[2] ?? path.join(root, 'projects', 'sample.json'));
const project = JSON.parse(await fs.readFile(projectPath, 'utf8'));
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromeCandidates = [process.env.CHROME_PATH,systemChrome,'/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean);
let browserExecutable = null; for (const candidate of chromeCandidates) {if (await fs.access(candidate).then(() => true).catch(() => false)) {browserExecutable=candidate;break;}}
const serveUrl = await bundle({entryPoint: path.join(root, 'src', 'remotion', 'index.ts'), webpackOverride: (config) => config});
const composition = await selectComposition({serveUrl, id: 'PaperCutVideo', inputProps: {project}, browserExecutable});
const output = path.join(root, 'out', `${project.id}.mp4`);
await fs.mkdir(path.dirname(output), {recursive: true});
await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: output, inputProps: {project}, browserExecutable, concurrency: 1, onProgress: ({progress}) => process.stdout.write(`\r渲染 ${Math.round(progress * 100)}%`)});
process.stdout.write(`\n完成：${output}\n`);
