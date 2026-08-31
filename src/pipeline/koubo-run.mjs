/**
 * 口播线 run：配音 → 画面（素材库候选）→ 分段渲染 → 拼接 → 字幕 → BGM/AI 标识 → 成片 + SRT + 封面 + 发布文案。
 * 每一步把结果写回项目 JSON（可重跑单镜）；素材找不到时降级为纯色底 + 大字幕并在 notes 里说明。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { synthesize } from '../voice/edge-tts.mjs';
import { findCandidates, materialize, materializeFirst } from '../sources/stock.mjs';
import { buildCues, estimateWords, toSRT, toASS, alignPunctuation } from '../captions/build.mjs';
import { renderSegment, concatSegments, finalize, probeDuration, hasFilter } from '../compose/koubo.mjs';
import { checkKoubo } from '../quality/check.mjs';
import { rankCandidates } from '../sources/rank.mjs';
import crypto from 'node:crypto';
import { aoSavedKeys } from '../config.mjs';
import { ffmpegPath } from '../media/ffmpeg.mjs';
const run = promisify(execFile);

/** 退避重试（网络类操作用）：times 是总次数，不是额外次数 */
async function retry(fn, { times = 3, delayMs = 800, onRetry = () => {} } = {}) {
  let last;
  for (let i = 1; i <= times; i++) {
    try { return await fn(); }
    catch (e) { last = e; if (i < times) { onRetry(e, i); await new Promise((r) => setTimeout(r, delayMs * i)); } }
  }
  throw last;
}

const fp = (...parts) => crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);

/**
 * 每镜两级缓存，粒度要分开——这是真机测出来的：
 * 「退纯色底的镜头下次要再找一遍素材」这条规则如果作用在整镜上，会连配音一起重做，
 * 而文案没改的话配音根本不需要重来（Edge TTS 是这条流水线里最慢也最容易抽的一步）。
 * 所以：配音只跟文案/音色/语速有关；分段只跟"这段配音 + 这个画面 + 画幅"有关。
 * 于是改一句话只重出那一镜，重找素材没找到又退回纯色底时连分段都能复用。
 */
const audioFingerprint = (shot, project) => fp(shot.text, project.voice.voice, project.voice.rate);
/** 配音时长：以文件实测为准，拿不到就用 TTS 报的；下限 1.2s，尾巴留 250ms 呼吸 */
const audioDuration = async (file, tts) => Math.max((await probeDuration(file)) || (tts.durationMs ?? 0) / 1000, 1.2) + 0.25;

/**
 * 配音预取：各镜的配音互不相干，没必要一条一条等——并发 3 条先把配音缓存填满，
 * 主循环随后照常按指纹命中复用（所以主循环逻辑一行没动）。
 * 并发压到 3：Edge TTS 是非官方端点，开太多容易被掐，收益也早就平掉了。
 */
async function prefetchAudio(project, { work, log, synthesizeImpl, concurrency = 3, signal }) {
  const todo = project.shots.filter((shot) => {
    const audio = path.join(work, `${shot.id}.mp3`);
    return !(shot.render?.audioFingerprint === audioFingerprint(shot, project) && fs.existsSync(audio) && shot.render.words);
  });
  if (todo.length < 2) return;                       // 只有一镜要配，串行反而少一层包装
  log(`🎙 并发配音 ${todo.length} 镜（${Math.min(concurrency, todo.length)} 条并行）`);
  const queue = [...todo];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      if (signal?.aborted) return;
      const shot = queue.shift();
      const audio = path.join(work, `${shot.id}.mp3`);
      try {
        const tts = await retry(() => synthesizeImpl(shot.text, { voice: project.voice.voice, rate: project.voice.rate, outFile: audio }), { times: 3 });
        const durationSec = await audioDuration(audio, tts);
        const words = tts.words.length ? alignPunctuation(tts.words, shot.text) : estimateWords(shot.text, durationSec * 1000);
        shot.render = { ...shot.render, audioFingerprint: audioFingerprint(shot, project), durationSec, words };
      } catch { /* 预取失败不报错：主循环会照常再试一次，那里有完整的错误信息与重试 */ }
    }
  });
  await Promise.all(workers);
}
const segmentFingerprint = (shot, project, audioFp) => fp(audioFp, shot.visual?.file ?? null, shot.visual?.kind ?? 'video', project.output.w, project.output.h, project.output.fps);

/** 看图排序用的连接器：config.vision.{provider,model}（或 project.vision）；key 从 AO 保存的 key / 环境变量来 */
async function visionJudge(vision, log) {
  if (!vision?.provider || !vision?.model) return null;
  try {
    const { createConnector } = await import('agency-orchestrator');
    const saved = aoSavedKeys();
    const cfg = { provider: vision.provider, model: vision.model, api_key: saved[vision.provider]?.apiKey || undefined, timeout: 60000, retry: 0 };
    return { connector: createConnector(cfg), cfg };
  } catch (e) { log(`素材排序不可用：${e.message.split('\n')[0]}`); return null; }
}

export async function runKoubo(project, { outDir, log = () => {}, fetchImpl = fetch, config, vision, signal, only = null, synthesizeImpl = synthesize, localImage = 'auto' } = {}) {
  const wantVision = vision ?? project.vision ?? config?.vision;
  const judge = await visionJudge(wantVision, log);
  const dir = outDir ?? path.join(process.env.HOME || '.', 'OpenShorts', project.id);
  const work = path.join(dir, 'work'); fs.mkdirSync(work, { recursive: true });
  const notes = []; const used = new Set(); const segFiles = []; const shotWords = []; let cursorMs = 0;
  const { w, h, fps } = project.output;
  // 每镜跑完就把项目写回盘：中途 Ctrl-C / TTS 挂掉时，已配好音、已选好素材的镜头下次不用重来
  const projectFile = path.join(dir, 'project.json');
  const save = () => { try { fs.writeFileSync(projectFile, JSON.stringify(project, null, 2)); } catch { /* 落盘失败不该拖垮出片 */ } };

  // 本地出图：素材库都没命中时，与其退纯色底，不如本机现画一张（不花钱、不联网、Apache-2.0 模型）。
  // 只在真的装了模型时才启用——没装就什么都不做，行为跟以前一样。
  const localGen = localImage === false ? null : await (async () => {
    try {
      const m = await import('../local/sd-image.mjs');
      const st = await m.sdImageStatus();
      if (!st.ok) return null;
      log(`🖌 本地出图待命：${st.models.find((x) => x.id === st.ready)?.label ?? st.ready}（素材库没命中时用它顶上，不花钱）`);
      return { gen: m.generateImage, model: localImage === 'auto' || localImage === true ? st.ready : localImage };
    } catch { return null; }
  })();

  // 没有看图把关时，画面只靠检索词的字面匹配——真机上"Wasp eating cat food"就这么配到了
  // "猫为什么总爱钻纸箱"上。技术链路再绿也得说清这一条：没人看过这些画面。
  const stockShots = project.shots.filter((s) => s.visual?.source !== 'solid');
  if (!judge && stockShots.length) log('⚠️ 没配看图模型，画面只按检索词字面匹配，没有人（也没有模型）看过——出片后自己过一遍');
  project.vision = { ...(wantVision ?? {}), used: !!judge };

  const abortIfCancelled = () => { if (signal?.aborted) { save(); throw new Error('已取消（进度已存盘，重跑会接着来）'); } };

  const forced = only ? new Set(Array.isArray(only) ? only : [only]) : null;
  if (forced) {
    const unknown = [...forced].filter((id) => !project.shots.some((s) => s.id === id));
    if (unknown.length) throw new Error(`项目里没有这些镜头：${unknown.join('、')}（有的是 ${project.shots.map((s) => s.id).join('、')}）`);
    log(`↻ 只重出 ${[...forced].join('、')}，其余镜头复用上次的分段`);
  }

  await prefetchAudio(project, { work, log, synthesizeImpl, signal });

  for (const shot of project.shots) {
    abortIfCancelled();

    const redo = forced?.has(shot.id) ?? false;
    const cache = shot.render ?? {};

    // 1) 配音（决定时长）——文案/音色/语速没变就直接用上次那条，Edge TTS 是全流程最慢也最爱抽的一步
    const audio = path.join(work, `${shot.id}.mp3`);
    const aFp = audioFingerprint(shot, project);
    let durationSec, words;
    if (cache.audioFingerprint === aFp && fs.existsSync(audio) && cache.words) {
      durationSec = cache.durationSec; words = cache.words;
      shot.audio = { file: audio, provider: 'edge-tts', voice: project.voice.voice, durationSec };
      shot.durationSec = durationSec;
      log(`↺ ${shot.id} 复用配音 ${durationSec.toFixed(1)}s`);
    } else {
      // Edge TTS 走的是微软非官方端点，抖一下就整条片废掉——重试两次再放弃（PRD 风险表里就写着它会抽）
      const tts = await retry(() => synthesizeImpl(shot.text, { voice: project.voice.voice, rate: project.voice.rate, outFile: audio }),
        { times: 3, onRetry: (e, n) => log(`⟳ ${shot.id} 配音第 ${n} 次重试（${e.message.split('\n')[0].slice(0, 60)}）`) })
        .catch((e) => { save(); throw new Error(`镜头 ${shot.id} 配音失败（已重试 3 次）：${e.message}`); });
      durationSec = await audioDuration(audio, tts);
      shot.audio = { file: audio, provider: 'edge-tts', voice: project.voice.voice, durationSec };
      shot.durationSec = durationSec;
      words = tts.words.length ? alignPunctuation(tts.words, shot.text) : estimateWords(shot.text, durationSec * 1000);
      log(`🎙 ${shot.id} 配音 ${durationSec.toFixed(1)}s${tts.words.length ? '' : '（无词级时间戳，按字数估）'}`);
    }
    // 按镜存，最后一镜一镜地断字幕：拼成一个大数组再断，会出现"上一镜的尾巴 + 下一镜的开头"挤在同一条字幕里
    shotWords.push({ words, offsetMs: cursorMs });

    // 2) 画面
    // 上次因"没找到素材"退成的纯色底带 fallback 标记：这次重跑要再找一遍；只有用户主动选的 solid 才不找
    if (shot.visual?.source === 'solid' && shot.visual.fallback) shot.visual = { ...shot.visual, source: null, file: null, fallback: false };
    // 「重出这一镜」= 把已选的素材丢掉重新找一遍（文案没改的话配音上面已经复用了，不花时间也不花钱）
    if (redo && shot.visual?.source !== 'solid') shot.visual = { ...shot.visual, source: null, file: null, candidateId: null };
    let clip = shot.visual.file; let chosen = null;
    if (!clip && shot.visual.source !== 'solid') {
      try {
        let cands = await findCandidates(shot.query || shot.visualIntent, { localDirs: project.defaults.localDirs, used, minDuration: 0, fetchImpl, ...(config ? { config } : {}) });
        // 没有没用过的候选时，宁可复用一条也别落到纯色底（复用会在 notes 里说明）
        if (!cands.length && used.size) { cands = await findCandidates(shot.query || shot.visualIntent, { localDirs: project.defaults.localDirs, used: new Set(), minDuration: 0, fetchImpl, ...(config ? { config } : {}) }); if (cands.length) notes.push(`镜头 ${shot.id} 复用了已用过的素材 ${cands[0].id}（候选不够）`); }
        if (judge && cands.length) {
          // 看图排序：先拿各来源自带的缩略图（几十 KB）打分，**只有中选的那条才真下**——
          // 以前是 3 条全下再扔掉 2 条，Commons 的原文件动辄几十 MB。
          // 没有缩略图的候选才回落到"先下再抽帧"。
          // 没有缩略图（或缩略图挂了）的候选，rankCandidates 会通过 getFile 按需把它下下来再抽帧，
          // 保证每条候选都真的被判过——常见情况下这个回调一次都不会被调用
          const getFile = async (c) => { try { return await materialize(c, { fetchImpl }); } catch (e) { notes.push(`候选 ${c.id} 取不到：${e.message.slice(0, 80)}`); return null; } };
          const ranked = await rankCandidates(cands.slice(0, 3), shot.visualIntent || shot.query, { connector: judge.connector, cfg: judge.cfg, log, fetchImpl, getFile });
          log(`🔍 ${shot.id} 候选 ${ranked.map((r) => `${r.id.split(':')[0]}=${r.score ?? '-'}`).join(' ')}`);
          // 按分数从高到低试着下载：中选那条下不动（超大 / 404）就顺位试下一条，不必重新打分
          for (const cand of ranked.filter((r) => !r.rejected)) {
            if (cand.unjudged) notes.push(`镜头 ${shot.id} 用了没能打分的候选 ${cand.id}（取不到画面证据）`);
            try { clip = await materialize(cand, { fetchImpl }); chosen = cand; log(`  → 选 ${cand.id}${cand.why ? `（${cand.why}）` : ''}`); break; }
            catch (e) { notes.push(`候选 ${cand.id} 取不到：${e.message.slice(0, 80)}`); }
          }
          if (!chosen) notes.push(`镜头 ${shot.id} 的 ${ranked.length} 条候选都不贴合画面意图或都取不到（${ranked.map((r) => `${r.score}`).join('/')}），退纯色底`);
        } else if (cands.length) {
          // 不看图时也别在第一条上吊死：第一条下不动（超大 / 超时 / 404）就顺位试下一条，别直接掉进纯色底
          const got = await materializeFirst(cands, { fetchImpl, onError: (c, e) => notes.push(`候选 ${c.id} 取不到：${e.message.slice(0, 80)}`) });
          if (got) { chosen = got.candidate; clip = got.file; }
        }
        if (chosen) used.add(chosen.id);
      } catch (e) { notes.push(`镜头 ${shot.id} 素材库：${e.message}`); }
    }
    // 素材库没命中 → 先试本地出图（几十秒），再退纯色底。
    // 用的是 query 而不是 visualIntent：模板里 query 本来就是"具体可检索的英文画面描述"，
    // 正好是文生图要的东西；visualIntent 是中文的，Flux 吃不好。
    if (!clip && localGen && shot.visual?.source !== 'solid') {
      // 优先用模板专门写的出图提示词；没有就退回检索词（短，但总比没有强）
      const q = shot.imagePrompt || shot.query || shot.visualIntent;
      const img = path.join(work, `${shot.id}-gen.png`);
      try {
        const r = await localGen.gen(`${q}, photographic, natural lighting, sharp focus`, { out: img, model: localGen.model, signal, onLog: (m) => log(`  ${m}`) });
        clip = img;
        shot.visual = { source: 'local-image', provider: 'local-flux', kind: 'image', file: img, model: r.model, prompt: r.prompt, cost: { kind: 'free' } };
        project.provenance.push({ shot: shot.id, source: 'local-flux', id: r.model, kind: 'image', license: 'Apache-2.0（FLUX.1-schnell 本地生成）', author: null, page: 'https://huggingface.co/black-forest-labs/FLUX.1-schnell' });
        log(`🖌 ${shot.id} 素材库没命中 → 本地出图 ${r.seconds.toFixed(0)}s`);
      } catch (e) { notes.push(`镜头 ${shot.id} 本地出图失败：${e.message.slice(0, 120)}`); }
    }
    if (!clip) {
      // 降级：纯色底（有 lavfi 的 ffmpeg 都能出），字幕成为画面主体
      clip = path.join(work, `${shot.id}-solid.mp4`);
      await run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x1b1b2f:size=${w}x${h}:rate=${fps}:d=${durationSec.toFixed(2)}`, '-pix_fmt', 'yuv420p', clip]);
      shot.visual = { ...shot.visual, source: 'solid', file: clip, cost: { kind: 'free' }, fallback: true };
      notes.push(`镜头 ${shot.id} 没找到素材（${shot.query}），用了纯色底`);
      log(`⬛ ${shot.id} 无素材 → 纯色底`);
    } else if (chosen) {
      shot.visual = { source: chosen.source === 'local-folder' ? 'local-folder' : 'stock', provider: chosen.source, kind: chosen.kind ?? 'video', file: clip, candidateId: chosen.id, license: chosen.license, author: chosen.author, page: chosen.page ?? null, cost: { kind: 'free' } };
      project.provenance.push({ shot: shot.id, source: chosen.source, id: chosen.id, kind: chosen.kind ?? 'video', license: chosen.license, author: chosen.author, page: chosen.page ?? null });
      log(`${chosen.kind === 'image' ? '🖼' : '🎞'} ${shot.id} 素材 ${chosen.source} ${chosen.id}${chosen.author ? ` · ${chosen.author}` : ''}`);
    }

    // 3) 分段渲染（指纹要在画面定下来之后算——退纯色底 / 选中素材都会改 shot.visual）
    const segOut = path.join(work, `${shot.id}.mp4`);
    const sFp = segmentFingerprint(shot, project, aFp);
    if (cache.segmentFingerprint === sFp && fs.existsSync(segOut)) log(`↺ ${shot.id} 复用分段`);
    else await renderSegment({ clip, audio, durationSec, w, h, fps, out: segOut, clipVolume: 0, signal,
      kind: shot.visual?.kind ?? 'video', panReverse: project.shots.indexOf(shot) % 2 === 1 });
    segFiles.push(segOut); shot.status = 'ready'; cursorMs += Math.round(durationSec * 1000);
    shot.render = { audioFingerprint: aFp, segmentFingerprint: sFp, segment: segOut, durationSec, words };
    save();
  }

  // 4) 拼接 + 字幕 + BGM + 标识
  abortIfCancelled();
  const joined = await concatSegments(segFiles, path.join(work, 'joined.mp4'), { signal });
  const cues = shotWords.flatMap((sw) => buildCues(sw.words, { maxChars: project.captions.maxChars, offsetMs: sw.offsetMs }));
  const emphasis = [...new Set(project.shots.flatMap((s) => s.emphasis ?? []))];
  const srt = path.join(dir, `${project.id}.srt`); fs.writeFileSync(srt, toSRT(cues, { maxChars: project.captions.maxChars }));
  const ass = path.join(work, 'captions.ass'); fs.writeFileSync(ass, toASS(cues, { preset: project.captions.preset, w, h, emphasis, maxChars: project.captions.maxChars }));
  const out = path.join(dir, `${project.id}.mp4`);
  const fin = await finalize({ video: joined, ass, srt, bgm: project.bgm?.file, bgmVolume: project.bgm?.volume ?? 0.2, aiLabel: project.publish.aiLabel, out, w, h, signal });
  notes.push(...fin.notes);

  // 5) 封面（第 1 秒抽帧）+ 发布文案
  const cover = path.join(dir, `${project.id}-cover.jpg`);
  try { await run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', out, '-frames:v', '1', '-q:v', '3', cover]); } catch { notes.push('封面抽帧失败'); }
  const publishTxt = path.join(dir, `${project.id}-发布文案.txt`);
  fs.writeFileSync(publishTxt, [`标题候选：`, ...project.publish.titles.map((t, i) => `  ${i + 1}. ${t}`), ``, `话题：${project.publish.tags.map((t) => `#${t}`).join(' ')}`, ``, `发布说明：${project.publish.note}`, `AI 标识：${project.publish.aiLabelText}`, ``, `素材署名：`, ...project.provenance.map((p) => `  ${p.shot}: ${p.source} ${p.author ?? ''} ${p.page ?? ''} (${p.license})`)].join('\n'));
  project.final = { file: out, srt, cover: fs.existsSync(cover) ? cover : null, publish: publishTxt, durationSec: await probeDuration(out), notes };
  // 6) 自动质检（只报事实）
  try { project.final.quality = await checkKoubo(project, { burnedCaptions: await hasFilter('subtitles') }); log(`🔍 质检 ${project.final.quality.pass ? '通过' : '有问题'}，${project.final.quality.warnings} 条提醒`); } catch (e) { notes.push(`质检失败：${e.message}`); }
  save();
  return project;
}
