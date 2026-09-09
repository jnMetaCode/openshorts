#!/usr/bin/env node
/**
 * `npx openshorts [cmd]`（架构文档 §12）。已实现：open（默认）/ sources / new / run / batch /
 * export / estimate / drama / install-ffmpeg / install-image / doctor / version。
 * 没有独立的 render 命令：合成是 run 的一部分（改了什么就重做什么，没改的镜头复用）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

// 先装代理再做任何联网的事：Node 的 fetch 不认 HTTPS_PROXY，不装的话在设了代理的机器上
// 所有下载/检索都会以 ECONNRESET 失败，而且报错看不出是自己没走代理
const { installProxy } = await import('../src/net/proxy.mjs');
await installProxy();
// AO 的库函数 run() 只认环境变量，不读 Studio 存的 key 文件——不补这一步，
// 界面里存好并验证通过的 key 到"写脚本"时会报"缺少 API Key"
const { applyAoKeysToEnv } = await import('../src/config.mjs');
await applyAoKeysToEnv();

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

/** 四个命令都吃 project.json——路径打错不该甩 ENOENT 堆栈，粘错文件不该甩 TypeError */
function readProject(pf) {
  let raw;
  try { raw = fs.readFileSync(pf, 'utf-8'); }
  catch { console.error(`⛔ 找不到项目文件：${pf}`); process.exit(1); }
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object' || !Array.isArray(p.shots)) { console.error(`⛔ ${pf} 不是开片的项目文件（里面没有 shots）`); process.exit(1); }
    return p;
  } catch (e) { console.error(`⛔ ${pf} 不是合法 JSON：${e.message.split('\n')[0]}`); process.exit(1); }
}

switch (cmd) {
  case 'open': case 'web': case 'studio-web': {
    // open-local 起不来（端口占用/构建失败）会 exit 1——要把它传出去，别让脚本里以为启动成功了。
    // status 为 null（被信号杀死 / spawn 本身失败）同样不算成功，与 runAO 的 ?? 1 口径一致
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'open-local.mjs')], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  case 'sources': {
    const { sourcesAvailability } = await import('../src/sources/availability.mjs');
    const a = sourcesAvailability();
    const { sdImageStatus } = await import('../src/local/sd-image.mjs');
    const g = await sdImageStatus().catch(() => null);
    const line = (ok, label, reason) => console.log(`  ${ok ? '✅' : '⛔'} ${label.padEnd(6, '　')} ${reason}`);
    console.log('\n口播短视频的画面来源');
    line(a.stock.ok, '素材库', a.stock.reason);
    line(!!g?.ok, '本机出图', g?.ok ? `${g.models.find((m) => m.id === g.ready)?.label} 就绪（素材库没命中时顶上，不花钱）`
      : g?.cliFound ? `模型没下（openshorts install-image，${g.models.find((m) => m.usable)?.sizeGB ?? '?'} GB，Apache-2.0 可商用）`
      : '未装（openshorts install-image；不装的话找不到素材的镜头退纯色底）');
    console.log('\nAI 短剧的画面来源');
    line(a.image.ok, '云端出图', a.image.reason);
    line(a.local.ok, '本机出片', a.local.reason);
    line(a.cloud.ok, '云端出片', a.cloud.reason);
    console.log(`\n工具：ffmpeg ${a.tools.ffmpeg ? '✓' : '✗'} · whisper-cli ${a.tools.whisper ? '✓' : '✗'} · imagemagick ${a.tools.magick ? '✓' : '✗'}\n`);
    break;
  }
  case 'drama': {
    // AI 短剧：直接跑 AO 自带的短剧流水线（不复制 YAML）。参数原样透传给 `ao run`。
    const t = JSON.parse(fs.readFileSync(path.join(root, 'templates', 'ai-drama.template.json'), 'utf-8'));
    const wf = path.join(aoBin().dir, t.ao.workflow);
    // --plan 必须带上用户的 -i：报价按供应商/模型/秒数算，不带输入的 plan 报的是默认档的价，
    // 不是他实际要跑的那一单（README 恰好教人用 --plan -i … 先看花费）
    const passthru = rest.filter((a) => a !== '--validate' && a !== '--plan');
    if (rest.includes('--validate')) runAO(['validate', wf, ...passthru]);
    if (rest.includes('--plan')) runAO(['plan', wf, ...passthru]);
    runAO(['run', wf, ...rest]);
    break;
  }
  case 'new': {
    // openshorts new [koubo-kepu|koubo-explainer] --topic "…" [--lang en] [--duration 60秒] [--tone 科普讲解] [--voice zh-CN-YunxiNeural] [--local-dir ./素材]
    const tpl = rest[0] && !rest[0].startsWith('--') ? rest[0] : '';
    const opt = parseOpts(rest.slice(tpl ? 1 : 0));
    const { langSpec, normLang, localizeInputs } = await import('../src/project/lang.mjs');
    // 模板名与 --lang 是同一件事的两种写法：写 koubo-explainer 等于 --lang en
    const lang = normLang(tpl === 'koubo-explainer' ? 'en' : (opt.lang ?? 'zh'));
    const spec = langSpec(lang);
    if (tpl && !['koubo-kepu', 'koubo-explainer'].includes(tpl)) { console.error(`口播线只有 koubo-kepu（中文）与 koubo-explainer（英文）两个模板（AI 短剧请用 openshorts drama）`); process.exit(1); }
    // 模板名和 --lang 打架时报错，不猜：`new koubo-kepu --lang en` 静默换成英文模板的话，
    // 用户拿到一条英文片还以为是自己模板写错了
    if (tpl === 'koubo-kepu' && normLang(opt.lang ?? 'zh') === 'en') { console.error('koubo-kepu 是中文模板，--lang en 是英文——二选一（英文片直接用 openshorts new --lang en）'); process.exit(1); }
    if (!opt.topic) { console.error('缺 --topic "话题或文案"'); process.exit(1); }
    const { generateKoubo } = await import('../src/pipeline/koubo-script.mjs');
    const { uniqueProjectId } = await import('../src/project/koubo.mjs');
    const { readConfig } = await import('../src/config.mjs');
    const cfg = readConfig();
    const wf = path.join(root, 'templates', spec.template);
    const inputs = localizeInputs({ topic: opt.topic, duration: opt.duration || '60秒', tone: opt.tone || '科普讲解' }, lang);
    console.log(`✍️  正在写脚本（${lang === 'en' ? 'English · ' : ''}${inputs.duration} · ${inputs.tone}）…`);
    let g;
    try {
      g = await generateKoubo({ wf, inputs, lang, log: (m) => console.log(`  ⟳ ${m}`),
        buildDefaults: { voice: opt.voice || (String(cfg.tts?.voice ?? '').toLowerCase().startsWith(lang === 'en' ? 'en-' : 'zh-') ? cfg.tts.voice : spec.voice), captionPreset: opt.captions || 'douyin', localDirs: opt['local-dir'] ? [path.resolve(opt['local-dir'])] : [], bgm: opt.bgm ? path.resolve(opt.bgm) : null },
        aoOpts: { quiet: true, outputDir: path.join(cfg.outputDir, '.ao-runs'), ...(() => { const pv = opt.provider || cfg.text?.provider; const md = opt.model || (opt.provider ? undefined : cfg.text?.model); return pv ? { llmOverride: { provider: pv, ...(md ? { model: md } : {}) } } : {}; })() } });
    } catch (e) {
      // 最常见的是没配文本模型 key：一句话说清怎么配，不吐堆栈
      console.error(`\n⛔ ${e.message.split('\n')[0]}`);
      console.error('   写脚本要一个文本模型：设环境变量（如 DEEPSEEK_API_KEY）再运行，或在 AO 的 ~/.ao 配置里存一次 key；也可以加 --provider ollama --model <本地模型> 走本地。');
      process.exit(1);
    }
    if (!g.ok && g.kind === 'run') { console.error('脚本步骤失败：', g.res.steps.filter((s) => s.status === 'failed').map((s) => `${s.id}: ${s.error}`).join('; ')); process.exit(1); }
    if (!g.ok) {
      // 已经自动重写过一次还是解析不了。别甩原始堆栈——脚本花了 token，
      // 把原始输出落盘、告诉用户在哪、告诉他怎么换模型。
      const dump = path.join(cfg.outputDir, `失败脚本-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.txt`);
      try { fs.mkdirSync(cfg.outputDir, { recursive: true }); fs.writeFileSync(dump, (g.res.steps ?? []).map((st) => `── ${st.id} (${st.status}) ──\n${st.output ?? ''}`).join('\n\n')); } catch { /* 落盘失败就算了 */ }
      console.error(`\n⛔ 脚本写出来了，但解析不了（自动重写一次仍失败）：${g.error.message}`);
      console.error(`   原始输出留在：${dump}`);
      console.error(`   再跑一次，或换个模型：--provider deepseek --model deepseek-chat`);
      process.exit(1);
    }
    const project = g.project;
    project.id = uniqueProjectId(cfg.outputDir, project.id);   // 同话题再跑一次不该覆盖上一条片子
    const dir = path.join(cfg.outputDir, project.id); fs.mkdirSync(dir, { recursive: true });
    const pf = path.join(dir, 'project.json'); fs.writeFileSync(pf, JSON.stringify(project, null, 2));
    console.log(`✓ 项目已建：${pf}\n  ${project.shots.length} 个镜头 · 标题候选：${project.publish.titles[0] ?? '（无）'}`);
    if (project.publish.error) console.log(`  ⚠️ ${project.publish.error}`);
    for (const x of project.scriptWarnings ?? []) console.log(`  ⚠️ ${x}`);
    console.log(`  下一步：openshorts run "${pf}"`);
    break;
  }
  case 'run': {
    const pf = rest[0]; if (!pf) { console.error('用法：openshorts run <project.json>'); process.exit(1); }
    const project = readProject(pf);
    if (project.line !== 'koubo') { console.error('run 只支持口播线项目（AI 短剧请用 openshorts drama）'); process.exit(1); }
    const { runKoubo } = await import('../src/pipeline/koubo-run.mjs');
    const t0 = Date.now();
    const o = parseOpts(rest.slice(1));
    const { readConfig: rc } = await import('../src/config.mjs'); const c = rc();
    const vision = o['vision-provider'] ? { provider: o['vision-provider'], model: o['vision-model'] || '' } : c.vision;
    if (vision?.provider) console.log(`  🔍 素材候选看图排序：${vision.provider} / ${vision.model}`);
    const only = o.only ? String(o.only).split(',').map((x) => x.trim()).filter(Boolean) : null;
    let p;
    try {
      p = await runKoubo(project, { outDir: path.dirname(path.resolve(pf)), log: (m) => console.log('  ' + m), vision, only,
        localImage: o['no-local-image'] ? false : (o['local-image-model'] || 'auto') });
    } catch (e) { console.error(`\n⛔ 出片失败：${e.message}`); process.exit(1); }
    console.log(`\n✓ 成片：${p.final.file}（${p.final.durationSec.toFixed(1)}s，${((Date.now() - t0) / 1000).toFixed(0)}s 出片）\n  字幕：${p.final.srt}\n  封面：${p.final.cover ?? '无'}\n  发布文案：${p.final.publish}`);
    for (const n of p.final.notes) console.log(`  ⚠️ ${n}`);
    // 质检结论必须落到屏幕和退出码上。以前只在日志里写"有问题，N 条提醒"，
    // 具体条目只有网页端显示——CLI/CI 里出一条"观众看不到字幕"的片子，这里还是 ✓ + exit 0。
    const q = p.final.quality;
    if (q) {
      const icon = { warn: '⚠️', fail: '⛔' };
      for (const it of q.items.filter((x) => x.status !== 'pass')) console.log(`  ${icon[it.status] ?? '·'} ${it.msg}`);
      if (!q.pass) { console.error(`\n⛔ 质检未过（上面 ⛔ 的条目）。文件已生成，但按这个状态发出去观众会看到问题。`); process.exitCode = 1; }
    }
    break;
  }
  case 'batch': {
    // openshorts batch <project.json> --voices a,b --captions douyin,clean --rates 1,1.1
    const pf = rest[0]; if (!pf) { console.error('用法：openshorts batch <project.json> --voices zh-CN-XiaoxiaoNeural,zh-CN-YunxiNeural [--captions douyin,clean] [--rates 1,1.1]'); process.exit(1); }
    const o = parseOpts(rest.slice(1)); const split = (x) => (x ? String(x).split(',').map((t) => t.trim()).filter(Boolean) : []);
    const project = readProject(pf);
    if (project.line !== 'koubo') { console.error('批量目前只支持口播线项目'); process.exit(1); }
    const { planVariants, runBatch } = await import('../src/pipeline/batch.mjs');
    const variants = planVariants({ voices: split(o.voices), captions: split(o.captions), rates: split(o.rates).map(Number) }, project);
    console.log(`共 ${variants.length} 版：${variants.map((v) => v.id).join('、')}`);
    const t0 = Date.now();
    const { readConfig: rcb } = await import('../src/config.mjs');
    const results = await runBatch(project, variants, { baseDir: path.dirname(path.resolve(pf)), log: (m) => console.log('  ' + m), vision: rcb().vision });
    const okN = results.filter((r) => r.ok).length;
    console.log(`\n${okN ? '✓' : '⛔'} ${okN}/${results.length} 版完成，${((Date.now() - t0) / 1000).toFixed(0)}s`);
    for (const r of results) console.log(`  ${r.ok ? '✅' : '⛔'} ${r.id}${r.ok ? `  ${r.file}（${r.durationSec?.toFixed(1)}s${r.quality ? `，质检${r.quality.pass ? '通过' : '有问题'}`: ''}）` : `  ${r.error}`}`);
    if (okN < results.length) process.exitCode = 1;   // 以前"✓ 0/3 版完成"也 exit 0，脚本里全灭都当成功
    break;
  }
  case 'export': {
    // openshorts export <project.json> [--platform douyin|shipinhao|bilibili|shorts]
    const pf = rest[0]; const o = parseOpts(rest.slice(1)); if (!pf) { console.error('用法：openshorts export <project.json> [--platform douyin]'); process.exit(1); }
    const { makePublishPack } = await import('../src/publish/pack.mjs');
    let r;
    try { r = makePublishPack(readProject(pf), { platform: o.platform || 'douyin' }); }
    catch (e) { console.error(`⛔ ${e.message}`); process.exit(1); }   // 典型：还没出片就 export
    console.log(`✓ 发布包：${r.dir}${r.zip ? `\n  zip：${r.zip}` : ''}\n  ${r.files.join('、')}`);
    for (const x of r.warnings ?? []) console.log(`  ⚠️ ${x}`);
    break;
  }
  case 'estimate': {
    // 口播线的钱永远是 0，运行前真正想知道的是**要等多久**。
    // 旧版按 shot.visual.cost 判断，而新项目压根还没有 visual，于是永远输出"全部不花钱"，等于没说。
    // 下面的秒数是今天真机量的：6 镜纯检索 104s / 加看图把关 122s / 每镜本机出图约 57s。
    const pf = rest[0]; if (!pf) { console.error('用法：openshorts estimate <project.json>'); process.exit(1); }
    const project = readProject(pf);
    const { readConfig: rc2 } = await import('../src/config.mjs'); const c2 = rc2();
    const n = project.shots.length;
    const paid = project.shots.filter((s) => s.visual?.cost && s.visual.cost.kind !== 'free').length;
    const done = project.shots.filter((s) => s.render?.segment).length;
    const visionOn = !!(c2.vision?.provider && c2.vision?.model);
    let gen = null; try { const m = await import('../src/local/sd-image.mjs'); gen = await m.sdImageStatus(); } catch { /* 没装 */ }

    console.log(`\n${project.title || project.id} · ${n} 个镜头${done ? `（已渲好 ${done} 个，重跑只补差的）` : ''}`);
    if (project.line !== 'koubo') {
      // 短剧线的画面来自云端出图/出片，钱和时间都由供应商决定——照搬口播线的算法只会算出错的数
      console.log(`这是 AI 短剧线：画面走${project.tier === 'local' ? '本机出片（不花钱，每镜约 3–4 分钟）' : '云端出图/出片，按各家计费'}。`);
      console.log(`本次输入：${project.inputs?.video_provider ?? '?'} / ${project.inputs?.video_model ?? '?'} · ${project.inputs?.video_duration ?? '?'} 秒一镜 · ${n} 镜${paid ? `（已出过 ${paid} 镜）` : ''}`);
      console.log(`准确花费跑这条看：openshorts drama --plan -i story="…"（它会按供应商报价逐镜列出来）\n`);
      break;
    }
    console.log(`花费：0 元 —— Edge TTS 免费、CC 素材免费、合成用本机 ffmpeg`);
    const todo = n - done;                       // 已经渲好的镜头会按指纹复用，不重做
    const perGen = 57;                           // 真机：FLUX Q2 576×1024 约 56–57 秒一张
    if (!todo) {
      console.log(`耗时：约 15 秒 —— 所有镜头都能复用，只需重新合成（改了文案 / 音色 / 画面的镜头会自动重做）`);
    } else {
      const base = Math.round((visionOn ? 20 : 17) * todo);
      const mins = (sec) => (sec < 90 ? `${Math.round(sec)} 秒` : `${Math.round(sec / 60)} 分钟`);
      console.log(`耗时：约 ${mins(base)}起（要跑 ${todo} 个镜头${done ? `，另外 ${done} 个复用` : ''}）`);
      if (gen?.ok) console.log(`      素材库没命中的镜头会本机出图，每镜再加约 ${perGen} 秒（最坏 ${todo} 镜全画 ≈ ${mins(base + todo * perGen)}）`);
      else console.log(`      素材库没命中的镜头会退纯色底（装了本机出图模型就能改成现画一张：openshorts install-image）`);
    }
    console.log(`看图把关：${visionOn ? `已开 ${c2.vision.provider}/${c2.vision.model} —— 不贴合的素材会被拦下，转本机出图` : '没开 —— 画面只按检索词字面匹配，可能配错（侧栏或 config.vision 里配）'}`);
    console.log('');
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
    if (o.list || rest.includes('--list')) {   // 列目录不该依赖二进制装没装
      console.log(`\n本地出图档位（模型目录 ${st.modelsDir}，内存 ${st.memGB} GB）`);
      for (const x of st.models) console.log(`  ${x.present ? '✅' : x.usable ? '⬜' : '⛔'} ${x.id.padEnd(18)} ${x.label} · ${x.sizeGB} GB · ${x.reason}`);
      console.log(`\n许可证：${st.license}`);
      console.log(`sd-cli：${st.cliFound ? `✅ ${st.cli}` : '⬜ 还没装，装模型时会一并装上（约 30 MB，MIT）'}`);
      console.log(`装：openshorts install-image --model ${m.pickImageModel(st)?.id ?? 'flux-schnell-q2'}`);
      break;
    }
    const want = o.model || m.pickImageModel(st)?.id;
    const tier = st.models.find((x) => x.id === want);
    if (!tier) { console.error(`⛔ 未知档位 ${want}（openshorts install-image --list 看有哪些）`); process.exit(1); }
    if (!tier.usable) { console.error(`⛔ ${tier.reason}`); process.exit(1); }
    if (tier.present && !o.force) { console.log(`✅ ${tier.label} 已经装好了。要重装加 --force`); break; }
    console.log(`将下载 ${tier.label}，共约 ${tier.sizeGB} GB 到 ${st.modelsDir}${st.cliFound ? '' : '\n（顺带装 sd-cli，约 30 MB，MIT）'}\n许可证：${st.license}`);
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
  case 'help': case '--help': case '-h':
    printHelp(console.log); break;
  default:
    // 打错命令（rnu、bacth…）不能 exit 0——脚本和 CI 会把它当成功
    console.error(`⛔ 未知命令：${cmd}\n`);
    printHelp(console.error);
    process.exit(1);
}

function printHelp(out) {
  out(`用法：openshorts [open|sources|new|run|batch|export|estimate|drama|install-ffmpeg|install-image|doctor|version]
  open      起本地服务并打开浏览器（默认）
  sources   看这台机器能用哪些画面来源（素材库 / AI 配图 / 本地生成 / 云端出片）
  drama     AI 短剧：跑 AO 短剧流水线（参数透传给 ao run；--validate / --plan 只检查不出片，-i 输入照常带上）
  doctor    环境体检（转 ao doctor）
  install-ffmpeg  装一份带 libass 的 ffmpeg 到 ~/.openshorts/bin（Homebrew 的不带，字幕会烧不进画面）[--force 重装]
  install-image   装本地文生图模型（FLUX.1-schnell，Apache-2.0 可商用）：素材库没命中时本机现画一张
                  openshorts install-image --list / --model flux-schnell-q4 [--force 重装]
  new       口播科普：openshorts new koubo-kepu --topic "…" [--duration 60秒] [--tone 科普讲解] [--voice …]
            [--captions douyin|clean] [--local-dir 素材夹] [--bgm x.mp3] [--provider deepseek --model deepseek-chat]
            英文成片：加 --lang en（等同于 openshorts new koubo-explainer）——脚本、音色、字幕断行全部按英文来
  run       出片：openshorts run <project.json> [--only s2,s3]（只重出这几镜，其余复用）
            [--no-local-image]（关掉"素材库没命中就本机出图"，直接退纯色底）
            [--vision-provider agnes --vision-model agnes-2.0-flash]（候选素材看图排序）
            质检未过（如字幕没烧进画面）时退出码为 1，文件照常生成
  estimate  看这个项目要不要花钱、大概等多久（口播线钱恒为 0，真正的成本是时间）
  export    发布包：openshorts export <project.json> --platform douyin|shipinhao|bilibili|shorts（mp4+封面+SRT+文案，不自动发布）
  batch     批量：openshorts batch <project.json> --voices a,b [--captions douyin,clean] [--rates 1,1.1]`);
}
