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

function parseOpts(a) { const o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true'; o[k] = v; } return o; }

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
  case 'new': {
    // openshorts new koubo-kepu --topic "…" [--duration 60秒] [--tone 科普讲解] [--voice zh-CN-YunxiNeural] [--local-dir ./素材]
    const tpl = rest[0] && !rest[0].startsWith('--') ? rest[0] : 'koubo-kepu';
    if (tpl !== 'koubo-kepu') { console.error(`M1 只支持 koubo-kepu（AI 短剧请用 openshorts drama）`); process.exit(1); }
    const opt = parseOpts(rest.slice(1));
    if (!opt.topic) { console.error('缺 --topic "话题或文案"'); process.exit(1); }
    const { run } = await import('agency-orchestrator');
    const { buildKouboProject } = await import('../src/project/koubo.mjs');
    const { readConfig } = await import('../src/config.mjs');
    const cfg = readConfig();
    const wf = path.join(root, 'templates', 'koubo-kepu.yaml');
    const inputs = { topic: opt.topic, duration: opt.duration || '60秒', tone: opt.tone || '科普讲解' };
    console.log(`✍️  正在写脚本（${inputs.duration} · ${inputs.tone}）…`);
    let res;
    try { res = await run(wf, inputs, { quiet: true, outputDir: path.join(cfg.outputDir, '.ao-runs'), ...(opt.provider ? { llmOverride: { provider: opt.provider, model: opt.model } } : {}) }); }
    catch (e) {
      // 最常见的是没配文本模型 key：一句话说清怎么配，不吐堆栈
      console.error(`\n⛔ ${e.message.split('\n')[0]}`);
      console.error('   写脚本要一个文本模型：设环境变量（如 DEEPSEEK_API_KEY）再运行，或在 AO 的 ~/.ao 配置里存一次 key；也可以加 --provider ollama --model <本地模型> 走本地。');
      process.exit(1);
    }
    if (!res.success) { console.error('脚本步骤失败：', res.steps.filter((s) => s.status === 'failed').map((s) => `${s.id}: ${s.error}`).join('; ')); process.exit(1); }
    const project = buildKouboProject(res, { topic: opt.topic, inputs, defaults: { voice: opt.voice || cfg.tts?.voice, captionPreset: opt.captions || 'douyin', localDirs: opt['local-dir'] ? [path.resolve(opt['local-dir'])] : [], bgm: opt.bgm ? path.resolve(opt.bgm) : null } });
    const dir = path.join(cfg.outputDir, project.id); fs.mkdirSync(dir, { recursive: true });
    const pf = path.join(dir, 'project.json'); fs.writeFileSync(pf, JSON.stringify(project, null, 2));
    console.log(`✓ 项目已建：${pf}\n  ${project.shots.length} 个镜头 · 标题候选：${project.publish.titles[0] ?? '（无）'}\n  下一步：openshorts run "${pf}"`);
    break;
  }
  case 'run': {
    const pf = rest[0]; if (!pf) { console.error('用法：openshorts run <project.json>'); process.exit(1); }
    const project = JSON.parse(fs.readFileSync(pf, 'utf-8'));
    if (project.line !== 'koubo') { console.error('M1 的 run 只支持口播线项目（AI 短剧请用 openshorts drama）'); process.exit(1); }
    const { runKoubo } = await import('../src/pipeline/koubo-run.mjs');
    const t0 = Date.now();
    const p = await runKoubo(project, { outDir: path.dirname(path.resolve(pf)), log: (m) => console.log('  ' + m) });
    console.log(`\n✓ 成片：${p.final.file}（${p.final.durationSec.toFixed(1)}s，${((Date.now() - t0) / 1000).toFixed(0)}s 出片）\n  字幕：${p.final.srt}\n  封面：${p.final.cover ?? '无'}\n  发布文案：${p.final.publish}`);
    for (const n of p.final.notes) console.log(`  ⚠️ ${n}`);
    break;
  }
  case 'batch': {
    // openshorts batch <project.json> --voices a,b --captions douyin,clean --rates 1,1.1
    const pf = rest[0]; if (!pf) { console.error('用法：openshorts batch <project.json> --voices zh-CN-XiaoxiaoNeural,zh-CN-YunxiNeural [--captions douyin,clean] [--rates 1,1.1]'); process.exit(1); }
    const o = parseOpts(rest.slice(1)); const split = (x) => (x ? String(x).split(',').map((t) => t.trim()).filter(Boolean) : []);
    const project = JSON.parse(fs.readFileSync(pf, 'utf-8'));
    if (project.line !== 'koubo') { console.error('批量目前只支持口播线项目'); process.exit(1); }
    const { planVariants, runBatch } = await import('../src/pipeline/batch.mjs');
    const variants = planVariants({ voices: split(o.voices), captions: split(o.captions), rates: split(o.rates).map(Number) }, project);
    console.log(`共 ${variants.length} 版：${variants.map((v) => v.id).join('、')}`);
    const t0 = Date.now();
    const results = await runBatch(project, variants, { baseDir: path.dirname(path.resolve(pf)), log: (m) => console.log('  ' + m) });
    console.log(`\n✓ ${results.filter((r) => r.ok).length}/${results.length} 版完成，${((Date.now() - t0) / 1000).toFixed(0)}s`);
    for (const r of results) console.log(`  ${r.ok ? '✅' : '⛔'} ${r.id}${r.ok ? `  ${r.file}（${r.durationSec?.toFixed(1)}s${r.quality ? `，质检${r.quality.pass ? '通过' : '有问题'}`: ''}）` : `  ${r.error}`}`);
    break;
  }
  case 'export': {
    // openshorts export <project.json> [--platform douyin|shipinhao|bilibili|shorts]
    const pf = rest[0]; const o = parseOpts(rest.slice(1)); if (!pf) { console.error('用法：openshorts export <project.json> [--platform douyin]'); process.exit(1); }
    const { makePublishPack } = await import('../src/publish/pack.mjs');
    const r = makePublishPack(JSON.parse(fs.readFileSync(pf, 'utf-8')), { platform: o.platform || 'douyin' });
    console.log(`✓ 发布包：${r.dir}${r.zip ? `\n  zip：${r.zip}` : ''}\n  ${r.files.join('、')}`); break;
  }
  case 'estimate': {
    const pf = rest[0]; const project = JSON.parse(fs.readFileSync(pf, 'utf-8'));
    const free = project.shots.filter((s) => !s.visual?.cost || s.visual.cost.kind === 'free').length;
    console.log(`镜头 ${project.shots.length} 个：素材库/本地/纯色 ${free} 个（不花钱）· 配音 Edge TTS（免费）· 合成本机 ffmpeg（免费）`);
    if (free < project.shots.length) console.log(`  其余 ${project.shots.length - free} 个走 AI 出图/出片，按各家计费（数量级见 ao plan）`);
    break;
  }
  case 'doctor': {
    const { doctor, formatDoctor } = await import('../src/doctor.mjs');
    console.log('\nOpenShorts 体检'); console.log(formatDoctor(await doctor())); console.log('\nAO 引擎体检（文本/出图/出片供应商）：');
    runAO(['doctor', ...rest]); break;
  }
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
  new       口播科普：openshorts new koubo-kepu --topic "…" [--duration 60秒] [--tone 科普讲解] [--voice …] [--local-dir 素材夹] [--bgm x.mp3]
  run       出片：openshorts run <project.json>（配音 → 素材 → 字幕 → 合成）
  estimate  看这个项目要不要花钱
  export    发布包：openshorts export <project.json> --platform douyin|shipinhao|bilibili|shorts（mp4+封面+SRT+文案，不自动发布）
  batch     批量：openshorts batch <project.json> --voices a,b [--captions douyin,clean] [--rates 1,1.1]`);
}
