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

export async function runKoubo(project, { outDir, log = () => {}, fetchImpl = fetch, config, vision, signal } = {}) {
  const judge = await visionJudge(vision ?? project.vision ?? config?.vision, log);
  const dir = outDir ?? path.join(process.env.HOME || '.', 'OpenShorts', project.id);
  const work = path.join(dir, 'work'); fs.mkdirSync(work, { recursive: true });
  const notes = []; const used = new Set(); const segFiles = []; const shotWords = []; let cursorMs = 0;
  const { w, h, fps } = project.output;
  // 每镜跑完就把项目写回盘：中途 Ctrl-C / TTS 挂掉时，已配好音、已选好素材的镜头下次不用重来
  const projectFile = path.join(dir, 'project.json');
  const save = () => { try { fs.writeFileSync(projectFile, JSON.stringify(project, null, 2)); } catch { /* 落盘失败不该拖垮出片 */ } };

  const abortIfCancelled = () => { if (signal?.aborted) { save(); throw new Error('已取消（进度已存盘，重跑会接着来）'); } };

  for (const shot of project.shots) {
    abortIfCancelled();
    // 1) 配音（决定时长）
    const audio = path.join(work, `${shot.id}.mp3`);
    // Edge TTS 走的是微软非官方端点，抖一下就整条片废掉——重试两次再放弃（PRD 风险表里就写着它会抽）
    const tts = await retry(() => synthesize(shot.text, { voice: project.voice.voice, rate: project.voice.rate, outFile: audio }),
      { times: 3, onRetry: (e, n) => log(`⟳ ${shot.id} 配音第 ${n} 次重试（${e.message.split('\n')[0].slice(0, 60)}）`) })
      .catch((e) => { save(); throw new Error(`镜头 ${shot.id} 配音失败（已重试 3 次）：${e.message}`); });
    const durationSec = Math.max((await probeDuration(audio)) || (tts.durationMs ?? 0) / 1000, 1.2) + 0.25; // 尾巴留 250ms 呼吸
    shot.audio = { file: audio, provider: 'edge-tts', voice: project.voice.voice, durationSec };
    shot.durationSec = durationSec;
    const words = tts.words.length ? alignPunctuation(tts.words, shot.text) : estimateWords(shot.text, durationSec * 1000);
    // 按镜存，最后一镜一镜地断字幕：拼成一个大数组再断，会出现"上一镜的尾巴 + 下一镜的开头"挤在同一条字幕里
    shotWords.push({ words, offsetMs: cursorMs });
    log(`🎙 ${shot.id} 配音 ${durationSec.toFixed(1)}s${tts.words.length ? '' : '（无词级时间戳，按字数估）'}`);

    // 2) 画面
    // 上次因"没找到素材"退成的纯色底带 fallback 标记：这次重跑要再找一遍；只有用户主动选的 solid 才不找
    if (shot.visual?.source === 'solid' && shot.visual.fallback) shot.visual = { ...shot.visual, source: null, file: null, fallback: false };
    let clip = shot.visual.file; let chosen = null;
    if (!clip && shot.visual.source !== 'solid') {
      try {
        let cands = await findCandidates(shot.query || shot.visualIntent, { localDirs: project.defaults.localDirs, used, minDuration: 0, fetchImpl, ...(config ? { config } : {}) });
        // 没有没用过的候选时，宁可复用一条也别落到纯色底（复用会在 notes 里说明）
        if (!cands.length && used.size) { cands = await findCandidates(shot.query || shot.visualIntent, { localDirs: project.defaults.localDirs, used: new Set(), minDuration: 0, fetchImpl, ...(config ? { config } : {}) }); if (cands.length) notes.push(`镜头 ${shot.id} 复用了已用过的素材 ${cands[0].id}（候选不够）`); }
        if (judge && cands.length) {
          // 看图排序：把候选都拉下来抽一帧，让模型按画面意图打分；全部不及格 → 当没找到
          const withFiles = [];
          for (const c of cands.slice(0, 3)) { try { withFiles.push({ ...c, file: await materialize(c, { fetchImpl }) }); } catch (e) { notes.push(`候选 ${c.id} 下载失败：${e.message.slice(0, 80)}`); } }
          const ranked = await rankCandidates(withFiles, shot.visualIntent || shot.query, { connector: judge.connector, cfg: judge.cfg, log });
          const top = ranked[0];
          if (top && !top.rejected) { chosen = top; clip = top.file; log(`🔍 ${shot.id} 候选 ${ranked.map((r) => `${r.id.split(':')[0]}=${r.score ?? '-'}`).join(' ')} → 选 ${top.id}${top.why ? `（${top.why}）` : ''}`); }
          else { notes.push(`镜头 ${shot.id} 的 ${ranked.length} 条候选都不贴合画面意图（${ranked.map((r) => `${r.score}`).join('/')}），退纯色底`); }
        } else if (cands.length) {
          // 不看图时也别在第一条上吊死：第一条下不动（超大 / 超时 / 404）就顺位试下一条，别直接掉进纯色底
          const got = await materializeFirst(cands, { fetchImpl, onError: (c, e) => notes.push(`候选 ${c.id} 取不到：${e.message.slice(0, 80)}`) });
          if (got) { chosen = got.candidate; clip = got.file; }
        }
        if (chosen) used.add(chosen.id);
      } catch (e) { notes.push(`镜头 ${shot.id} 素材库：${e.message}`); }
    }
    if (!clip) {
      // 降级：纯色底（有 lavfi 的 ffmpeg 都能出），字幕成为画面主体
      clip = path.join(work, `${shot.id}-solid.mp4`);
      await run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x1b1b2f:size=${w}x${h}:rate=${fps}:d=${durationSec.toFixed(2)}`, '-pix_fmt', 'yuv420p', clip]);
      shot.visual = { ...shot.visual, source: 'solid', file: clip, cost: { kind: 'free' }, fallback: true };
      notes.push(`镜头 ${shot.id} 没找到素材（${shot.query}），用了纯色底`);
      log(`⬛ ${shot.id} 无素材 → 纯色底`);
    } else if (chosen) {
      shot.visual = { source: chosen.source === 'local-folder' ? 'local-folder' : 'stock', provider: chosen.source, file: clip, candidateId: chosen.id, license: chosen.license, author: chosen.author, page: chosen.page ?? null, cost: { kind: 'free' } };
      project.provenance.push({ shot: shot.id, source: chosen.source, id: chosen.id, license: chosen.license, author: chosen.author, page: chosen.page ?? null });
      log(`🎞 ${shot.id} 素材 ${chosen.source} ${chosen.id}${chosen.author ? ` · ${chosen.author}` : ''}`);
    }

    // 3) 分段渲染
    const segOut = path.join(work, `${shot.id}.mp4`);
    await renderSegment({ clip, audio, durationSec, w, h, fps, out: segOut, clipVolume: 0, signal });
    segFiles.push(segOut); shot.status = 'ready'; cursorMs += Math.round(durationSec * 1000);
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
