/**
 * 口播线 run：配音 → 画面（素材库候选）→ 分段渲染 → 拼接 → 字幕 → BGM/AI 标识 → 成片 + SRT + 封面 + 发布文案。
 * 每一步把结果写回项目 JSON（可重跑单镜）；素材找不到时降级为纯色底 + 大字幕并在 notes 里说明。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { synthesize } from '../voice/edge-tts.mjs';
import { findCandidates, materialize, materializeFirst, pruneCache } from '../sources/stock.mjs';
import { buildCues, estimateWords, toSRT, toASS, alignPunctuation } from '../captions/build.mjs';
import { renderSegment, concatSegments, finalize, probeDuration, hasFilter } from '../compose/koubo.mjs';
import { checkKoubo } from '../quality/check.mjs';
import { rankCandidates } from '../sources/rank.mjs';
import crypto from 'node:crypto';
import { aoSavedKeys } from '../config.mjs';
import { ffmpegPath } from '../media/ffmpeg.mjs';
import { normLang, tt } from '../project/lang.mjs';
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
const audioDuration = async (file, tts, lang = 'zh') => Math.max((await probeDuration(file, { lang })) || (tts.durationMs ?? 0) / 1000, 1.2) + 0.25;

/**
 * 配音预取：各镜的配音互不相干，没必要一条一条等——并发 3 条先把配音缓存填满，
 * 主循环随后照常按指纹命中复用（所以主循环逻辑一行没动）。
 * 并发压到 3：Edge TTS 是非官方端点，开太多容易被掐，收益也早就平掉了。
 */
async function prefetchAudio(project, { work, log, synthesizeImpl, concurrency = 3, signal }) {
  const lang = normLang(project.lang); const T = tt(lang);
  const todo = project.shots.filter((shot) => {
    if (shot.render?.audioFingerprint !== audioFingerprint(shot, project) || !shot.render.words) return true;
    // 上次那条还在就不必重合成——批量出版本时它在主项目的目录里
    return !((shot.audio?.file && fs.existsSync(shot.audio.file)) || fs.existsSync(path.join(work, `${shot.id}.mp3`)));
  });
  if (todo.length < 2) return;                       // 只有一镜要配，串行反而少一层包装
  log(T(`🎙 并发配音 ${todo.length} 镜（${Math.min(concurrency, todo.length)} 条并行）`, `🎙 Synthesizing ${todo.length} shots (${Math.min(concurrency, todo.length)} in parallel)`));
  const queue = [...todo];
  let ok = 0, failed = 0;
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      if (signal?.aborted) return;
      const shot = queue.shift();
      const audio = path.join(work, `${shot.id}.mp3`);
      try {
        const tts = await retry(() => synthesizeImpl(shot.text, { voice: project.voice.voice, rate: project.voice.rate, outFile: audio }), { times: 3 });
        const durationSec = await audioDuration(audio, tts, lang);
        const words = tts.words.length ? alignPunctuation(tts.words, shot.text) : estimateWords(shot.text, durationSec * 1000, { lang });
        shot.render = { ...shot.render, audioFingerprint: audioFingerprint(shot, project), durationSec, words, justSynthesized: true };
        ok++;
      } catch {
        // 预取失败不报错：主循环会照常再试一次，那里有完整的错误信息与重试。
        // 但 TTS 整体不可用时别硬撑——前 3 镜全挂（每镜已重试 3 次）说明不是抖，
        // 是端点/网络整个不行；以前会静默再发十几次失败请求，用户中间看不到任何输出
        failed++;
        if (!ok && failed >= 3 && queue.length) { log(T(`⚠️ 配音预取连挂 ${failed} 镜，先不预取了——主循环会重试并给出具体报错`, `⚠️ Voice prefetch failed on ${failed} shots in a row — stopping prefetch; the main loop will retry and report the real error`)); queue.length = 0; }
      }
    }
  });
  await Promise.all(workers);
}
const segmentFingerprint = (shot, project, audioFp) => fp(audioFp, shot.visual?.file ?? null, shot.visual?.kind ?? 'video',
  (shot.visual?.parts ?? []).map((p) => `${p.file}@${p.seekSec ?? 0}`),          // 切成几段、用了哪几条素材，变了就得重渲
  project.output.w, project.output.h, project.output.fps);

/** 看图排序用的连接器：config.vision.{provider,model}（或 project.vision）；key 从 AO 保存的 key / 环境变量来 */
async function visionJudge(vision, log, T = (zh) => zh) {
  if (!vision?.provider || !vision?.model) return null;
  try {
    const { createConnector } = await import('agency-orchestrator');
    const saved = aoSavedKeys();
    const cfg = { provider: vision.provider, model: vision.model, api_key: saved[vision.provider]?.apiKey || undefined, timeout: 60000, retry: 0 };
    return { connector: createConnector(cfg), cfg };
  } catch (e) { log(T(`素材排序不可用：${e.message.split('\n')[0]}`, `Visual ranking unavailable: ${e.message.split('\n')[0]}`)); return null; }
}

export async function runKoubo(project, { outDir, log = () => {}, fetchImpl = fetch, config, vision, signal, only = null, synthesizeImpl = synthesize, localImage = 'auto' } = {}) {
  // 出片语言：2026-09 之前的项目没有这个字段，缺省按中文（那时只有中文一条线）。
  // 出片日志与 notes 都要用它——这些话带着镜头 id 和秒数，界面的字典翻不了，
  // 只能在生成的这一刻就定语言（英文用户以前一路看中文进度）。
  const lang = normLang(project.lang); const T = tt(lang);
  const wantVision = vision ?? project.vision ?? config?.vision;
  const judge = await visionJudge(wantVision, log, T);
  const dir = outDir ?? path.join(process.env.HOME || '.', 'OpenShorts', project.id);
  const work = path.join(dir, 'work'); fs.mkdirSync(work, { recursive: true });
  const notes = []; const used = new Set(); const segFiles = []; const shotWords = []; let cursorMs = 0;
  const { w, h, fps } = project.output;
  // 每镜跑完就把项目写回盘：中途 Ctrl-C / TTS 挂掉时，已配好音、已选好素材的镜头下次不用重来
  const projectFile = path.join(dir, 'project.json');
  // 落盘失败不拖垮出片，但要说一声（一次就够）：磁盘满/只读时每镜都在静默丢进度，
  // 用户中断后才发现全要重来
  let saveWarned = false;
  const save = () => { try { fs.writeFileSync(projectFile, JSON.stringify(project, null, 2)); } catch (e) { if (!saveWarned) { saveWarned = true; log(T(`⚠️ 项目进度写盘失败（${String(e.message).split('\n')[0]}）——出片继续，但中断后已完成的镜头会重来`, `⚠️ Could not save progress (${String(e.message).split('\n')[0]}) — rendering continues, but finished shots will be redone if it is interrupted`)); } } };

  // 本地出图：素材库都没命中时，与其退纯色底，不如本机现画一张（不花钱、不联网、Apache-2.0 模型）。
  // 只在真的装了模型时才启用——没装就什么都不做，行为跟以前一样。
  const localGen = localImage === false ? null : await (async () => {
    try {
      const m = await import('../local/sd-image.mjs');
      const st = await m.sdImageStatus();
      if (!st.ok) return null;
      log(T(`🖌 本地出图待命：${st.models.find((x) => x.id === st.ready)?.label ?? st.ready}（素材库没命中时用它顶上，不花钱）`, `🖌 Local image gen ready: ${st.models.find((x) => x.id === st.ready)?.label ?? st.ready} (used when stock has nothing — free)`));
      return { gen: m.generateImage, model: localImage === 'auto' || localImage === true ? st.ready : localImage };
    } catch { return null; }
  })();

  // 没有看图把关时，画面只靠检索词的字面匹配——真机上"Wasp eating cat food"就这么配到了
  // "猫为什么总爱钻纸箱"上。技术链路再绿也得说清这一条：没人看过这些画面。
  const stockShots = project.shots.filter((s) => s.visual?.source !== 'solid');
  if (!judge && stockShots.length) log(T('⚠️ 没配看图模型，画面只按检索词字面匹配，没有人（也没有模型）看过——出片后自己过一遍', '⚠️ No vision model configured: visuals are picked by literal keyword match, and nothing (and nobody) has looked at them — review the result yourself'));
  project.vision = { ...(wantVision ?? {}), used: !!judge };

  const abortIfCancelled = () => { if (signal?.aborted) { save(); throw new Error(T('已取消（进度已存盘，重跑会接着来）', 'Cancelled (progress is saved — running again picks up where it stopped)')); } };

  const forced = only ? new Set(Array.isArray(only) ? only : [only]) : null;
  if (forced) {
    const unknown = [...forced].filter((id) => !project.shots.some((s) => s.id === id));
    if (unknown.length) throw new Error(T(`项目里没有这些镜头：${unknown.join('、')}（有的是 ${project.shots.map((s) => s.id).join('、')}）`, `This project has no such shots: ${unknown.join(', ')} (it has ${project.shots.map((s) => s.id).join(', ')})`));
    log(T(`↻ 只重出 ${[...forced].join('、')}，其余镜头复用上次的分段`, `↻ Redoing only ${[...forced].join(', ')}; other shots reuse the previous segments`));
  }

  await prefetchAudio(project, { work, log, synthesizeImpl, signal });

  for (const shot of project.shots) {
    abortIfCancelled();

    const redo = forced?.has(shot.id) ?? false;
    const cache = shot.render ?? {};

    // 1) 配音（决定时长）——文案/音色/语速没变就直接用上次那条，Edge TTS 是全流程最慢也最爱抽的一步
    const aFp = audioFingerprint(shot, project);
    // 上一次那条配音只要还在（哪怕在别的项目目录里，批量出版本就是这种情况），指纹一致就直接用
    const prior = cache.audioFingerprint === aFp && cache.words && shot.audio?.file && fs.existsSync(shot.audio.file) ? shot.audio.file : null;
    const audio = prior ?? path.join(work, `${shot.id}.mp3`);
    let durationSec, words;
    if (prior || (cache.audioFingerprint === aFp && fs.existsSync(audio) && cache.words)) {
      durationSec = cache.durationSec; words = cache.words;
      shot.audio = { file: audio, provider: 'edge-tts', voice: project.voice.voice, durationSec };
      shot.durationSec = durationSec;
      log(cache.justSynthesized
        ? T(`🎙 ${shot.id} 配音 ${durationSec.toFixed(1)}s`, `🎙 ${shot.id} voice-over ${durationSec.toFixed(1)}s`)
        : T(`↺ ${shot.id} 复用配音 ${durationSec.toFixed(1)}s`, `↺ ${shot.id} reusing voice-over ${durationSec.toFixed(1)}s`));
    } else {
      // Edge TTS 走的是微软非官方端点，抖一下就整条片废掉——重试两次再放弃（PRD 风险表里就写着它会抽）
      const tts = await retry(() => synthesizeImpl(shot.text, { voice: project.voice.voice, rate: project.voice.rate, outFile: audio }),
        { times: 3, onRetry: (e, n) => log(T(`⟳ ${shot.id} 配音第 ${n} 次重试（${e.message.split('\n')[0].slice(0, 60)}）`, `⟳ ${shot.id} voice-over retry ${n} (${e.message.split('\n')[0].slice(0, 60)})`)) })
        .catch((e) => { save(); throw new Error(T(`镜头 ${shot.id} 配音失败（已重试 3 次）：${e.message}`, `Shot ${shot.id} voice-over failed after 3 retries: ${e.message}`)); });
      durationSec = await audioDuration(audio, tts, lang);
      shot.audio = { file: audio, provider: 'edge-tts', voice: project.voice.voice, durationSec };
      shot.durationSec = durationSec;
      words = tts.words.length ? alignPunctuation(tts.words, shot.text) : estimateWords(shot.text, durationSec * 1000, { lang });
      log(T(`🎙 ${shot.id} 配音 ${durationSec.toFixed(1)}s${tts.words.length ? '' : '（无词级时间戳，按字数估）'}`, `🎙 ${shot.id} voice-over ${durationSec.toFixed(1)}s${tts.words.length ? '' : ' (no word timings — estimated)'}`));
    }
    // 按镜存，最后一镜一镜地断字幕：拼成一个大数组再断，会出现"上一镜的尾巴 + 下一镜的开头"挤在同一条字幕里
    shotWords.push({ words, offsetMs: cursorMs });

    // 2) 画面
    // 上次因"没找到素材"退成的纯色底带 fallback 标记：这次重跑要再找一遍；只有用户主动选的 solid 才不找
    if (shot.visual?.source === 'solid' && shot.visual.fallback) shot.visual = { ...shot.visual, source: null, file: null, fallback: false };
    // 「重出这一镜」= 把已选的素材丢掉重新找一遍（文案没改的话配音上面已经复用了，不花时间也不花钱）
    if (redo && shot.visual?.source !== 'solid') shot.visual = { ...shot.visual, source: null, file: null, candidateId: null };
    // 这一轮到底要不要重新定画面（上面两行清完还没有画面 = 要重定）。
    // 这个判断有两处非它不可：
    // ① 署名：重定之前必须先把这一镜的旧署名清掉，否则重出几次就累积几份——真机上一条
    //    重出过 3 次的片子，credits 里挂着 4 条已经不在片中的素材（含一条 CC BY-SA 4.0），
    //    等于给没用到的作品署名，这在一份交给运营去发布的版权说明里是错的。
    // ② 切镜头：复用画面时 extras 是空的，重算 picked 只剩主画面 → 上一轮切好的多段被丢掉，
    //    一个画面挂满整镜。真机上重出一次 s4 的 2 段就没了，第二次 s2 的 3 段也没了，全程无提示。
    const repick = !shot.visual.file;
    if (repick) project.provenance = project.provenance.filter((x) => x.shot !== shot.id);
    let clip = shot.visual.file; let chosen = null;
    const extras = [];                     // 这一镜可用的全部候选（含中选那条），够长的镜头会用它们切成几段
    if (!clip && shot.visual.source !== 'solid') {
      try {
        // 镜头越长要切的段越多，候选就得多取几条——固定 3 条时，12 秒的镜头最多只能切 3 段。
        // 缩略图打分很便宜（几十 KB 一张），多取几条的代价主要在那次模型调用的提示词长度上。
        const cutEvery0 = Number(shot.cutEverySec ?? project.defaults?.cutEverySec ?? 4);
        const wantCands = Math.max(3, Math.min(6, cutEvery0 > 0 ? Math.ceil(durationSec / cutEvery0) : 3));
        let cands = await findCandidates(shot.query || shot.visualIntent, { localDirs: project.defaults.localDirs, used, minDuration: 0, limit: wantCands, fetchImpl, ...(config ? { config } : {}) });
        // 没有没用过的候选时，宁可复用一条也别落到纯色底（复用会在 notes 里说明）
        if (!cands.length && used.size) { cands = await findCandidates(shot.query || shot.visualIntent, { localDirs: project.defaults.localDirs, used: new Set(), minDuration: 0, limit: wantCands, fetchImpl, ...(config ? { config } : {}) }); if (cands.length) notes.push(T(`镜头 ${shot.id} 复用了已用过的素材 ${cands[0].id}（候选不够）`, `Shot ${shot.id} reused already-used footage ${cands[0].id} (not enough candidates)`)); }
        if (judge && cands.length) {
          // 看图排序：先拿各来源自带的缩略图（几十 KB）打分，**只有中选的那条才真下**——
          // 以前是 3 条全下再扔掉 2 条，Commons 的原文件动辄几十 MB。
          // 没有缩略图的候选才回落到"先下再抽帧"。
          // 没有缩略图（或缩略图挂了）的候选，rankCandidates 会通过 getFile 按需把它下下来再抽帧，
          // 保证每条候选都真的被判过——常见情况下这个回调一次都不会被调用
          const getFile = async (c) => { try { return await materialize(c, { fetchImpl }); } catch (e) { notes.push(T(`候选 ${c.id} 取不到：${e.message.slice(0, 80)}`, `Candidate ${c.id} could not be fetched: ${e.message.slice(0, 80)}`)); return null; } };
          const ranked = await rankCandidates(cands.slice(0, wantCands), shot.visualIntent || shot.query, { connector: judge.connector, cfg: judge.cfg, log, fetchImpl, getFile, T });
          log(T(`🔍 ${shot.id} 候选 ${ranked.map((r) => `${r.id.split(':')[0]}=${r.score ?? '-'}`).join(' ')}`, `🔍 ${shot.id} candidates ${ranked.map((r) => `${r.id.split(':')[0]}=${r.score ?? '-'}`).join(' ')}`));
          // 开了把关却一条都没判成（视觉接口抽了 / 都取不到画面证据）时，别默默拿一条没判过的顶上——
          // 用户开把关就是不想要"没人看过的画面"。本机能出图就交给它画，画不了才退而求其次用未判的。
          // 真机验证：六镜里正是这个漏洞留下了唯一一个坏镜头（一只猫趴在古董收银机旁边）。
          const usable = ranked.filter((r) => !r.rejected && !r.fillOnly);
          const allUnjudged = usable.length > 0 && usable.every((r) => r.unjudged);
          // 补位的排在主画面之后：主画面用高分那条，后面几段才轮到勉强及格的
          const pool = allUnjudged && localGen ? [] : [...usable, ...ranked.filter((r) => r.fillOnly)];
          if (allUnjudged && localGen) notes.push(T(`镜头 ${shot.id} 的候选一条都没判成（看图接口没响应），改用本机出图，不拿没判过的顶上`, `Shot ${shot.id}: not one candidate could be judged (the vision endpoint did not answer) — generated locally instead of using an unvetted clip`));
          // 按分数从高到低试着下载。以前只取第一名，另外两条打完分就扔了——
          // 而一镜的口播常有 10 秒以上，正好用它们切成 2–3 段（见 cutEverySec）。
          for (const cand of pool) {
            if (cand.unjudged) notes.push(T(`镜头 ${shot.id} 用了没能打分的候选 ${cand.id}（本机也出不了图）`, `Shot ${shot.id} used unscored candidate ${cand.id} (local generation was unavailable too)`));
            try {
              const f = await materialize(cand, { fetchImpl });
              // fillOnly 的分数不够当主画面，只能用来补切镜头的后几段
              if (!chosen && !cand.fillOnly) { chosen = cand; clip = f; log(T(`  → 选 ${cand.id}${cand.why ? `（${cand.why}）` : ''}`, `  → picked ${cand.id}${cand.why ? ` (${cand.why})` : ''}`)); }
              extras.push({ ...cand, file: f });
            } catch (e) { notes.push(T(`候选 ${cand.id} 取不到：${e.message.slice(0, 80)}`, `Candidate ${cand.id} could not be fetched: ${e.message.slice(0, 80)}`)); }
          }
          // 这里只说"没选出来"，不要预告后果——后面还有本地出图这一步，
          // 真退到纯色底时那一步自己会写 note。写死"退纯色底"会跟日志对不上。
          if (!chosen) notes.push(T(`镜头 ${shot.id} 的 ${ranked.length} 条候选都没过看图把关或都取不到（分数 ${ranked.map((r) => r.score ?? '-').join('/')}，及格线 6）`, `Shot ${shot.id}: all ${ranked.length} candidates failed the visual check or could not be fetched (scores ${ranked.map((r) => r.score ?? '-').join('/')}, pass mark 6)`));
        } else if (cands.length) {
          // 不看图时也别在第一条上吊死：第一条下不动（超大 / 超时 / 404）就顺位试下一条，别直接掉进纯色底
          const got = await materializeFirst(cands, { fetchImpl, onError: (c, e) => notes.push(T(`候选 ${c.id} 取不到：${e.message.slice(0, 80)}`, `Candidate ${c.id} could not be fetched: ${e.message.slice(0, 80)}`)) });
          if (got) { chosen = got.candidate; clip = got.file; extras.push({ ...got.candidate, file: got.file }); }
        }
        if (chosen) used.add(chosen.id);
      } catch (e) { notes.push(T(`镜头 ${shot.id} 素材库：${e.message}`, `Shot ${shot.id} stock lookup: ${e.message}`)); }
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
        project.provenance.push({ shot: shot.id, source: 'local-flux', id: r.model, kind: 'image', license: lang === 'en' ? 'Apache-2.0 (generated locally with FLUX.1-schnell)' : 'Apache-2.0（FLUX.1-schnell 本地生成）', author: null, page: 'https://huggingface.co/black-forest-labs/FLUX.1-schnell' });
        log(T(`🖌 ${shot.id} 素材库没命中 → 本地出图 ${r.seconds.toFixed(0)}s`, `🖌 ${shot.id} no stock hit → generated locally in ${r.seconds.toFixed(0)}s`));
      } catch (e) { notes.push(T(`镜头 ${shot.id} 本地出图失败：${e.message.slice(0, 120)}`, `Shot ${shot.id} local image generation failed: ${e.message.slice(0, 120)}`)); }
    }
    if (!clip) {
      // 用户主动选「只用纯色底」时，上面两段搜索本来就跳过了——这不是降级，别标 fallback，
      // 否则下一轮开头那句 `solid && fallback` 会把它清掉去搜素材，用户的选择静默失效
      const deliberate = shot.visual?.source === 'solid' && !shot.visual?.fallback;
      // 降级：纯色底（有 lavfi 的 ffmpeg 都能出），字幕成为画面主体
      clip = path.join(work, `${shot.id}-solid.mp4`);
      await run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x1b1b2f:size=${w}x${h}:rate=${fps}:d=${durationSec.toFixed(2)}`, '-pix_fmt', 'yuv420p', clip]);
      // **整个换掉，不要 `...shot.visual`**：展开会把上一轮的字段带过来，已经出过两次事——
      // ① kind 留着 'image'，渲染就对纯色底的 .mp4 加 `-loop 1`，ffmpeg 报
      //    "Option loop not found"，整条出片失败（真机重出单镜时踩到）；
      // ② author/license 留着上一条素材的，界面镜头卡片会显示成「solid · 某摄影师」，
      //    等于把一块纯色底署到别人名下。
      shot.visual = { source: 'solid', kind: 'video', file: clip, provider: null, candidateId: null, cost: { kind: 'free' }, ...(deliberate ? {} : { fallback: true }) };
      if (!deliberate) {
        notes.push(T(`镜头 ${shot.id} 没找到素材（${shot.query}），用了纯色底`, `Shot ${shot.id} found no footage for "${shot.query}" — fell back to a solid color`));
        log(T(`⬛ ${shot.id} 无素材 → 纯色底`, `⬛ ${shot.id} no footage → solid color`));
      } else log(T(`⬛ ${shot.id} 纯色底（按你选的来源）`, `⬛ ${shot.id} solid color (the source you picked)`));
    } else if (chosen) {
      shot.visual = { source: chosen.source === 'local-folder' ? 'local-folder' : 'stock', provider: chosen.source, kind: chosen.kind ?? 'video', file: clip, candidateId: chosen.id, license: chosen.license, author: chosen.author, page: chosen.page ?? null, cost: { kind: 'free' } };
      project.provenance.push({ shot: shot.id, source: chosen.source, id: chosen.id, kind: chosen.kind ?? 'video', license: chosen.license, author: chosen.author, page: chosen.page ?? null });
      log(`${chosen.kind === 'image' ? '🖼' : '🎞'} ${shot.id} ${T('素材', 'footage')} ${chosen.source} ${chosen.id}${chosen.author ? ` · ${chosen.author}` : ''}`);
    }

    // 3) 分段渲染
    // 一镜口播常有 10 秒以上，一个画面挂那么久在手机上很难看（短视频惯例 2–4 秒一换，MPT 默认 3 秒）。
    // 用这一镜已有的候选切成几段；只有一条素材时不硬凑，行为跟以前一样。
    const cutEvery = Number(shot.cutEverySec ?? project.defaults?.cutEverySec ?? 4);
    // 第一段必须是**真正定下来的那个画面**（中选的素材，或本机刚画的那张），
    // extras 里装的是打分没到主画面线的候选——直接拿 extras 当 pool 会把本机出的图丢掉，
    // 改用那几张判退的素材，正好把看图把关的意义抹掉。
    const primary = shot.visual?.file ? { file: shot.visual.file, kind: shot.visual.kind ?? 'video', id: shot.visual.candidateId ?? null } : null;
    const pool2 = primary ? [primary, ...extras.filter((e) => e.file !== primary.file)] : extras;
    const want = cutEvery > 0 ? Math.max(1, Math.round(durationSec / cutEvery)) : 1;
    let picked = pool2.slice(0, Math.min(want, pool2.length));
    // 候选不够时，视频素材可以用**同一条的不同时间点**补段——同一段素材的不同瞬间在观感上就是换了画面，
    // 而且不引入新的版权来源。图片不行（同一张图切几段还是同一张图），所以只对视频做。
    if (picked.length < want) {
      const vids = [];
      for (const c of picked) if ((c.kind ?? 'video') !== 'image') { const d = await probeDuration(c.file).catch(() => 0); if (d > 0) vids.push({ c, d }); }
      const per = durationSec / want;
      let k = 0;
      while (picked.length < want && vids.length) {
        const { c, d } = vids[k % vids.length];
        const round = Math.floor(k / vids.length) + 1;
        const seek = (round * per) % Math.max(d - per, 0.1);           // 每轮往后挪一段的长度，绕回开头
        if (d <= per * 1.5) break;                                      // 素材本身太短，挪了也是同一段
        picked.push({ ...c, seekSec: Number(seek.toFixed(2)) });
        k++;
      }
    }
    const n = Math.max(1, picked.length);
    // 没重新定画面这一轮，就把上一轮切好的段原样复用——不能重算：那时 extras 是空的，
    // picked 只剩主画面，多段会被悄悄丢成一段（真机上重出一次，切镜头就没了）
    // 只有"这一轮没重新定画面、且上一轮真的切过段、文件还在"才复用，其余情况照旧现算——
    // 门槛只卡 repick 的话，会把"画面是给定的但从没切过段"也一起挡掉
    const kept = !repick ? (shot.visual?.parts ?? []).filter((x) => x.file && fs.existsSync(x.file)) : [];
    const reusedParts = kept.length > 1;
    const parts = reusedParts
      ? kept.map((x) => ({ clip: x.file, kind: x.kind ?? 'video', ...(x.seekSec ? { seekSec: x.seekSec } : {}) }))
      : (n > 1 ? picked.map((c) => ({ clip: c.file, kind: c.kind ?? 'video', ...(c.seekSec ? { seekSec: c.seekSec } : {}) })) : null);
    if (parts && !reusedParts) {
      const fills = picked.slice(1).filter((c) => c.fillOnly).length;
      const seeks = picked.filter((c) => c.seekSec).length;
      log(T(`✂️ ${shot.id} ${durationSec.toFixed(1)}s 切成 ${n} 段（每段约 ${(durationSec / n).toFixed(1)}s${fills ? `，${fills} 段补位` : ''}${seeks ? `，${seeks} 段取同一条素材的不同时间点` : ''}）`, `✂️ ${shot.id} ${durationSec.toFixed(1)}s cut into ${n} parts (~${(durationSec / n).toFixed(1)}s each${fills ? `, ${fills} filler` : ''}${seeks ? `, ${seeks} from other timestamps of the same clip` : ''})`));
      // 一镜用了几条素材，就得给几条署名——CC BY-SA 要求的
      for (const c of picked.slice(1)) if (c.id && c.id !== chosen?.id && !c.seekSec) project.provenance.push({ shot: shot.id, source: c.source ?? shot.visual?.provider, id: c.id, kind: c.kind ?? 'video', license: c.license, author: c.author, page: c.page ?? null });
      shot.visual = { ...shot.visual, parts: picked.map((c) => ({ file: c.file, kind: c.kind ?? 'video', id: c.id, ...(c.seekSec ? { seekSec: c.seekSec } : {}) })) };
    } else if (!parts && shot.visual?.parts) {
      // 真的只剩一段时才把 parts 抹掉；复用上一轮的多段时它必须留在项目里，
      // 否则下一轮又会读不到、又退回一段（这个 else 分支原来只看 parts 是不是刚算出来的）
      const { parts: _drop, ...rest } = shot.visual; shot.visual = rest;
    }
    const sFp = segmentFingerprint(shot, project, aFp);
    // 同上：上次渲好的分段还在就直接用，不管它在哪个目录
    const priorSeg = cache.segmentFingerprint === sFp && cache.segment && fs.existsSync(cache.segment) ? cache.segment : null;
    const segOut = priorSeg ?? path.join(work, `${shot.id}.mp4`);
    if (priorSeg || (cache.segmentFingerprint === sFp && fs.existsSync(segOut))) log(T(`↺ ${shot.id} 复用分段`, `↺ ${shot.id} reusing segment`));
    else await renderSegment({ clip, audio, durationSec, w, h, fps, out: segOut, clipVolume: 0, signal, lang,
      kind: shot.visual?.kind ?? 'video', panReverse: project.shots.indexOf(shot) % 2 === 1, parts });
    segFiles.push(segOut); shot.status = 'ready'; cursorMs += Math.round(durationSec * 1000);
    shot.render = { audioFingerprint: aFp, segmentFingerprint: sFp, segment: segOut, durationSec, words };
    save();
  }

  // 4) 拼接 + 字幕 + BGM + 标识
  abortIfCancelled();
  const joined = await concatSegments(segFiles, path.join(work, 'joined.mp4'), { signal, lang });
  const cues = shotWords.flatMap((sw) => buildCues(sw.words, { maxChars: project.captions.maxChars, offsetMs: sw.offsetMs, lang }));
  const emphasis = [...new Set(project.shots.flatMap((s) => s.emphasis ?? []))];
  const srt = path.join(dir, `${project.id}.srt`); fs.writeFileSync(srt, toSRT(cues, { maxChars: project.captions.maxChars }));
  const ass = path.join(work, 'captions.ass'); fs.writeFileSync(ass, toASS(cues, { preset: project.captions.preset, w, h, emphasis, maxChars: project.captions.maxChars, style: project.captions.style ?? {} }));
  const out = path.join(dir, `${project.id}.mp4`);
  const fin = await finalize({ video: joined, ass, srt, bgm: project.bgm?.file, bgmVolume: project.bgm?.volume ?? 0.2, aiLabel: project.publish.aiLabel, aiLabelText: T('AI 生成', 'AI generated'), subLang: T('chi', 'eng'), lang, out, w, h, signal });
  notes.push(...fin.notes);

  // 老项目自愈：2026-09 之前重出过的项目，署名里会累积上一轮的素材（那时重出不清旧的）。
  // 真机上一条重出 3 次的片子挂着 4 条已经不在片中的素材，其中一条 CC BY-SA 4.0——
  // 这是一份要交给运营去发布的版权说明，多署等于给没用到的作品署名。按各镜**最终**
  // 真正用到的素材过一遍；没 id 的和本机出图的按镜头对应关系保留。
  {
    const usedIds = new Set();
    const localShots = new Set();
    for (const sh of project.shots) {
      if (sh.visual?.candidateId) usedIds.add(sh.visual.candidateId);
      for (const x of sh.visual?.parts ?? []) if (x.id) usedIds.add(x.id);
      if (sh.visual?.source === 'local-image') localShots.add(sh.id);
    }
    const before = project.provenance.length;
    project.provenance = project.provenance.filter((x) => (!x.id ? true : x.source === 'local-flux' ? localShots.has(x.shot) : usedIds.has(x.id)));
    const dropped = before - project.provenance.length;
    if (dropped) notes.push(T(`清掉 ${dropped} 条已不在片中的素材署名（早先重出留下的）`, `Dropped ${dropped} footage credits for material no longer in the film (left over from earlier re-renders)`));
  }

  // 5) 封面（第 1 秒抽帧）+ 发布文案
  const cover = path.join(dir, `${project.id}-cover.jpg`);
  try { await run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', out, '-frames:v', '1', '-q:v', '3', cover]); } catch { notes.push(T('封面抽帧失败', 'Could not grab a cover frame')); }
  // 文件名与措辞跟着成片语言走：英文片交出去的不该是一份叫「-发布文案.txt」的中文说明
  const publishTxt = path.join(dir, `${project.id}${lang === 'en' ? '-publish' : '-发布文案'}.txt`);
  const PL = lang === 'en'
    ? { titles: 'Title options:', tags: 'Hashtags:', note: 'Publishing note:', ai: 'AI label:', credits: 'Footage credits:' }
    : { titles: '标题候选：', tags: '话题：', note: '发布说明：', ai: 'AI 标识：', credits: '素材署名：' };
  fs.writeFileSync(publishTxt, [PL.titles, ...project.publish.titles.map((t, i) => `  ${i + 1}. ${t}`), ``, `${PL.tags}${project.publish.tags.map((t) => `#${t}`).join(' ')}`, ``, `${PL.note}${project.publish.note}`, `${PL.ai}${project.publish.aiLabelText}`, ``, PL.credits, ...project.provenance.map((p) => `  ${p.shot}: ${p.source} ${p.author ?? ''} ${p.page ?? ''} (${p.license})`)].join('\n'));
  project.final = { file: out, srt, cover: fs.existsSync(cover) ? cover : null, publish: publishTxt, durationSec: await probeDuration(out, { lang }), notes };
  // 6) 自动质检（只报事实）
  try { project.final.quality = await checkKoubo(project, { burnedCaptions: await hasFilter('subtitles') }); log(T(`🔍 质检 ${project.final.quality.pass ? '通过' : '有问题'}，${project.final.quality.warnings} 条提醒`, `🔍 Quality check ${project.final.quality.pass ? 'passed' : 'found issues'}, ${project.final.quality.warnings} note(s)`)); } catch (e) { notes.push(T(`质检失败：${e.message}`, `Quality check failed: ${e.message}`)); }
  // 出完片顺手清一次缓存：它只涨不减，而用户既不知道它在哪也不知道能不能删
  try { const r = pruneCache(); if (r.removed) log(T(`🧹 清理素材缓存：删了 ${r.removed} 个旧文件，腾出 ${(r.freed / 1048576).toFixed(0)} MB`, `🧹 Pruned the footage cache: removed ${r.removed} old files, freed ${(r.freed / 1048576).toFixed(0)} MB`)); } catch { /* 清理失败不影响成片 */ }
  save();
  return project;
}
