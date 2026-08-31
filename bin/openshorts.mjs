#!/usr/bin/env node
/**
 * `npx openshorts [cmd]`（架构文档 §12）。M0 实现：open（默认）/ sources / drama / doctor / version。
 * new / estimate / run / render 在 M1 接入。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

// 先装代理再做任何联网的事：Node 的 fetch 不认 HTTPS_PROXY，不装的话在设了代理的机器上
// 所有下载/检索都会以 ECONNRESET 失败，而且报错看不出是自己没走代理
const { installProxy } = await import('../src/net/proxy.mjs');
installProxy();

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
    const o = parseOpts(rest.slice(1));
    const { readConfig: rc } = await import('../src/config.mjs'); const c = rc();
    const vision = o['vision-provider'] ? { provider: o['vision-provider'], model: o['vision-model'] || '' } : c.vision;
    if (vision?.provider) console.log(`  🔍 素材候选看图排序：${vision.provider} / ${vision.model}`);
    const only = o.only ? String(o.only).split(',').map((x) => x.trim()).filter(Boolean) : null;
    const p = await runKoubo(project, { outDir: path.dirname(path.resolve(pf)), log: (m) => console.log('  ' + m), vision, only,
      localImage: o['no-local-image'] ? false : (o['local-image-model'] || 'auto') });
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
    const { readConfig: rcb } = await import('../src/config.mjs');
    const results = await runBatch(project, variants, { baseDir: path.dirname(path.resolve(pf)), log: (m) => console.log('  ' + m), vision: rcb().vision });
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
  case 'install-ffmpeg': {
    // Homebrew 的 ffmpeg 已不含 libass ⇒ 字幕烧不进画面。装一份带 libass 的到 ~/.openshorts/bin，只对开片生效。
    const { installFfmpeg, ffmpegCaps } = await import('../src/media/ffmpeg.mjs');
    const before = await ffmpegCaps();
    if (before.subtitles && !parseOpts(rest).force) { console.log(`✅ 当前 ffmpeg ${before.version} 已经能烧字幕（${before.bin}），不用装。要强制重装加 --force`); break; }
    let lastFile = '';
    try {
      const caps = await installFfmpeg({
        onLog: (m) => console.log('  ' + m),
        onProgress: (p) => { if (p.total && p.file !== lastFile) { lastFile = p.file; } if (p.total) process.stdout.write(`\r  ${p.file} ${(p.bytes / 1048576).toFixed(0)}/${(p.total / 1048576).toFixed(0)} MB   `); if (p.done) process.stdout.write('\n'); },
      });
      console.log(`\n✓ 装好了：${caps.bin}（ffmpeg ${caps.version}）\n  字幕可烧进画面 · AI 标识角标可叠加。之前出的片重跑一次 openshorts run 就有字了。`);
    } catch (e) { console.error(`\n⛔ ${e.message}`); process.exit(1); }
    break;
  }
  case 'install-image': {
    // 本地文生图：素材库没命中时用它顶上，不花钱、不联网、模型 Apache-2.0 可商用
    const o = parseOpts(rest);
    const m = await import('../src/local/sd-image.mjs');
    const st = await m.sdImageStatus();
    if (!st.cliFound) { console.error(`⛔ 没装 sd-cli（本地出图/出片都要它）。界面第 2 步「本地生成」里可以一键装，或先跑 openshorts drama 的本地档安装。`); process.exit(1); }
    if (o.list || rest.includes('--list')) {
      console.log(`\n本地出图档位（模型目录 ${st.modelsDir}，内存 ${st.memGB} GB）`);
      for (const x of st.models) console.log(`  ${x.present ? '✅' : x.usable ? '⬜' : '⛔'} ${x.id.padEnd(18)} ${x.label} · ${x.sizeGB} GB · ${x.reason}`);
      console.log(`\n许可证：${st.license}\n装：openshorts install-image --model flux-schnell-q4`);
      break;
    }
    const want = o.model || m.pickImageModel(st)?.id;
    const tier = st.models.find((x) => x.id === want);
    if (!tier) { console.error(`⛔ 未知档位 ${want}（openshorts install-image --list 看有哪些）`); process.exit(1); }
    if (!tier.usable) { console.error(`⛔ ${tier.reason}`); process.exit(1); }
    if (tier.present && !o.force) { console.log(`✅ ${tier.label} 已经装好了。要重装加 --force`); break; }
    console.log(`将下载 ${tier.label}，共约 ${tier.sizeGB} GB 到 ${st.modelsDir}\n许可证：${st.license}`);
    try {
      await m.installSdImage({ model: want, onLog: (x) => console.log('  ' + x),
        onProgress: (p) => { if (p.total) process.stdout.write(`\r  ${p.file} ${(p.bytes / 1073741824).toFixed(2)}/${(p.total / 1073741824).toFixed(2)} GB   `); if (p.done) process.stdout.write('\n'); } });
      console.log(`\n✓ 装好了。以后 openshorts run 遇到素材库没命中的镜头，会本机现画一张而不是退纯色底（加 --no-local-image 可关掉）。`);
    } catch (e) { console.error(`\n⛔ ${e.message}`); process.exit(1); }
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
  install-ffmpeg  装一份带 libass 的 ffmpeg 到 ~/.openshorts/bin（Homebrew 的不带，字幕会烧不进画面）
  install-image   装本地文生图模型（FLUX.1-schnell，Apache-2.0 可商用）：素材库没命中时本机现画一张
                  openshorts install-image --list / --model flux-schnell-q4
  new       口播科普：openshorts new koubo-kepu --topic "…" [--duration 60秒] [--tone 科普讲解] [--voice …] [--local-dir 素材夹] [--bgm x.mp3]
  run       出片：openshorts run <project.json> [--only s2,s3]（只重出这几镜，其余复用）
            [--no-local-image]（关掉"素材库没命中就本机出图"，直接退纯色底）
            [--vision-provider agnes --vision-model agnes-2.0-flash]（候选素材看图排序）
  estimate  看这个项目要不要花钱
  export    发布包：openshorts export <project.json> --platform douyin|shipinhao|bilibili|shorts（mp4+封面+SRT+文案，不自动发布）
  batch     批量：openshorts batch <project.json> --voices a,b [--captions douyin,clean] [--rates 1,1.1]`);
}
