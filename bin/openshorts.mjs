#!/usr/bin/env node
/**
 * `npx openshorts [cmd]`（架构文档 §12）。M0 实现：open（默认）/ sources / drama / doctor / version。
 * new / estimate / run / render 在 M1 接入。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cmd = 'open', ...rest] = process.argv.slice(2);

function aoBin() {
  // AO 的 exports 只声明了 ESM 的 `import` 条件（CJS require.resolve 会报 NOT_EXPORTED），
  // 用 import.meta.resolve 拿 dist/index.js，再反推包目录
  const main = fileURLToPath(import.meta.resolve('agency-orchestrator'));
  const dir = path.resolve(path.dirname(main), '..');
  return { dir, cli: path.join(dir, 'dist', 'cli.js'), pkg: path.join(dir, 'package.json') };
}
function runAO(args, opts = {}) {
  const { cli } = aoBin();
  const r = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', env: { ...process.env, AO_NO_MODEL_HINT: '1' }, ...opts });
  process.exit(r.status ?? 1);
}

switch (cmd) {
  case 'open': case 'web': case 'studio-web':
    spawnSync(process.execPath, [path.join(root, 'scripts', 'open-local.mjs')], { stdio: 'inherit' }); break;
  case 'sources': {
    const { sourcesAvailability } = await import('../src/sources/availability.mjs');
    const a = sourcesAvailability();
    const label = { stock: '素材库', image: 'AI 配图', local: '本地生成', cloud: '云端出片', layered: '图层动画' };
    console.log('\n画面来源（这台机器）');
    for (const k of Object.keys(label)) console.log(`  ${a[k].ok ? '✅' : '⛔'} ${label[k].padEnd(5, '　')} ${a[k].reason}`);
    console.log(`\n工具：ffmpeg ${a.tools.ffmpeg ? '✓' : '✗'} · whisper-cli ${a.tools.whisper ? '✓' : '✗'} · imagemagick ${a.tools.magick ? '✓' : '✗'}\n`);
    break;
  }
  case 'drama': {
    // AI 短剧：直接跑 AO 自带的短剧流水线（不复制 YAML）。参数原样透传给 `ao run`。
    const t = JSON.parse(fs.readFileSync(path.join(root, 'templates', 'ai-drama.template.json'), 'utf-8'));
    const wf = path.join(aoBin().dir, t.ao.workflow);
    if (rest.includes('--validate')) runAO(['validate', wf]);
    if (rest.includes('--plan')) runAO(['plan', wf]);
    runAO(['run', wf, ...rest]);
    break;
  }
  case 'doctor': runAO(['doctor', ...rest]); break;
  case 'version': case '-v': case '--version': {
    const me = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    const ao = JSON.parse(fs.readFileSync(aoBin().pkg, 'utf-8'));
    console.log(`openshorts ${me.version} · agency-orchestrator ${ao.version}`); break;
  }
  default:
    console.log(`用法：openshorts [open|sources|drama|doctor|version]
  open      起本地服务并打开浏览器（默认）
  sources   看这台机器能用哪些画面来源（素材库 / AI 配图 / 本地生成 / 云端出片）
  drama     AI 短剧：跑 AO 短剧流水线（参数透传给 ao run；--validate / --plan 只检查）
  doctor    环境体检（转 ao doctor）
M1 将加入：new / estimate / run / render`);
}
