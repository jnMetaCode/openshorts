/**
 * 口播线 run：配音 → 画面（素材库候选）→ 分段渲染 → 拼接 → 字幕 → BGM/AI 标识 → 成片 + SRT + 封面 + 发布文案。
 * 每一步把结果写回项目 JSON（可重跑单镜）；素材找不到时降级为纯色底 + 大字幕并在 notes 里说明。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { synthesize } from '../voice/edge-tts.mjs';
import { findCandidates, materialize } from '../sources/stock.mjs';
import { buildCues, estimateWords, toSRT, toASS, alignPunctuation } from '../captions/build.mjs';
import { renderSegment, concatSegments, finalize, probeDuration, hasFilter } from '../compose/koubo.mjs';
import { checkKoubo } from '../quality/check.mjs';
const run = promisify(execFile);

export async function runKoubo(project, { outDir, log = () => {}, fetchImpl = fetch, config } = {}) {
  const dir = outDir ?? path.join(process.env.HOME || '.', 'OpenShorts', project.id);
  const work = path.join(dir, 'work'); fs.mkdirSync(work, { recursive: true });
  const notes = []; const used = new Set(); const segFiles = []; const allWords = []; let cursorMs = 0;
  const { w, h, fps } = project.output;

  for (const shot of project.shots) {
    // 1) 配音（决定时长）
    const audio = path.join(work, `${shot.id}.mp3`);
    let tts;
    try { tts = await synthesize(shot.text, { voice: project.voice.voice, rate: project.voice.rate, outFile: audio }); }
    catch (e) { throw new Error(`镜头 ${shot.id} 配音失败：${e.message}`); }
    const durationSec = Math.max((await probeDuration(audio)) || (tts.durationMs ?? 0) / 1000, 1.2) + 0.25; // 尾巴留 250ms 呼吸
    shot.audio = { file: audio, provider: 'edge-tts', voice: project.voice.voice, durationSec };
    shot.durationSec = durationSec;
    const words = tts.words.length ? alignPunctuation(tts.words, shot.text) : estimateWords(shot.text, durationSec * 1000);
    allWords.push(...words.map((x) => ({ ...x, startMs: x.startMs + cursorMs, endMs: x.endMs + cursorMs })));
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
        chosen = cands[0] ?? null;
        if (chosen) { clip = await materialize(chosen, { fetchImpl }); used.add(chosen.id); }
      } catch (e) { notes.push(`镜头 ${shot.id} 素材库：${e.message}`); }
    }
    if (!clip) {
      // 降级：纯色底（有 lavfi 的 ffmpeg 都能出），字幕成为画面主体
      clip = path.join(work, `${shot.id}-solid.mp4`);
      await run(process.env.OPENSHORTS_FFMPEG || process.env.AO_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x1b1b2f:size=${w}x${h}:rate=${fps}:d=${durationSec.toFixed(2)}`, '-pix_fmt', 'yuv420p', clip]);
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
    await renderSegment({ clip, audio, durationSec, w, h, fps, out: segOut, clipVolume: 0 });
    segFiles.push(segOut); shot.status = 'ready'; cursorMs += Math.round(durationSec * 1000);
  }

  // 4) 拼接 + 字幕 + BGM + 标识
  const joined = await concatSegments(segFiles, path.join(work, 'joined.mp4'));
  const cues = buildCues(allWords, { maxChars: project.captions.maxChars });
  const emphasis = [...new Set(project.shots.flatMap((s) => s.emphasis ?? []))];
  const srt = path.join(dir, `${project.id}.srt`); fs.writeFileSync(srt, toSRT(cues));
  const ass = path.join(work, 'captions.ass'); fs.writeFileSync(ass, toASS(cues, { preset: project.captions.preset, w, h, emphasis }));
  const out = path.join(dir, `${project.id}.mp4`);
  const fin = await finalize({ video: joined, ass, srt, bgm: project.bgm?.file, bgmVolume: project.bgm?.volume ?? 0.2, aiLabel: project.publish.aiLabel, out, w, h });
  notes.push(...fin.notes);

  // 5) 封面（第 1 秒抽帧）+ 发布文案
  const cover = path.join(dir, `${project.id}-cover.jpg`);
  try { await run(process.env.OPENSHORTS_FFMPEG || process.env.AO_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', out, '-frames:v', '1', '-q:v', '3', cover]); } catch { notes.push('封面抽帧失败'); }
  const publishTxt = path.join(dir, `${project.id}-发布文案.txt`);
  fs.writeFileSync(publishTxt, [`标题候选：`, ...project.publish.titles.map((t, i) => `  ${i + 1}. ${t}`), ``, `话题：${project.publish.tags.map((t) => `#${t}`).join(' ')}`, ``, `发布说明：${project.publish.note}`, `AI 标识：${project.publish.aiLabelText}`, ``, `素材署名：`, ...project.provenance.map((p) => `  ${p.shot}: ${p.source} ${p.author ?? ''} ${p.page ?? ''} (${p.license})`)].join('\n'));
  project.final = { file: out, srt, cover: fs.existsSync(cover) ? cover : null, publish: publishTxt, durationSec: await probeDuration(out), notes };
  // 6) 自动质检（只报事实）
  try { project.final.quality = await checkKoubo(project, { burnedCaptions: await hasFilter('subtitles') }); log(`🔍 质检 ${project.final.quality.pass ? '通过' : '有问题'}，${project.final.quality.warnings} 条提醒`); } catch (e) { notes.push(`质检失败：${e.message}`); }
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 2));
  return project;
}
