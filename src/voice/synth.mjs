/**
 * 配音入口：Edge TTS 优先（免费、带词级时间戳）；它挂了（微软改接口 / 网络受限）且用户配了回落供应商时，
 * 改走 AO 的 OpenAI 兼容语音端点（`POST {base}/audio/speech`），不至于整条免费路径一起死。
 *
 * 回落是**可选**的：`~/.openshorts/config.json` 里 `tts.fallback = { provider, model, voice }`，
 * key 沿用 AO 存的那把（同图片/看图把关）。没配就照旧只用 Edge——报错里指路怎么配。
 * 回落配音没有词级时间戳：字幕按字数估时轴（koubo-run 本来就有这条路），效果略糙但片子能出。
 */
import fs from 'node:fs';
import path from 'node:path';
import { importAo } from '../core/ao-module.mjs';
import { synthesize as edgeSynthesize } from './edge-tts.mjs';
import { readConfig, aoSavedKeys } from '../config.mjs';
import { tt } from '../project/lang.mjs';

async function aoGenerateSpeech() {
  // AO 的 exports 只声明了主入口；连接器按包目录拼路径（与 server/kaipian.mjs 取 local-sdcpp 同一手法）
  return (await importAo('connectors', 'tts.js')).generateSpeech;
}

export function makeSynthesizer({ cfg = readConfig(), edge = edgeSynthesize, aoSpeech = null, log = () => {}, lang = 'zh' } = {}) {
  const T = tt(lang);
  const fb = cfg?.tts?.fallback;
  const ready = !!(fb?.provider && fb?.model && fb?.voice);
  return async (text, opts = {}) => {
    try { return await edge(text, opts); }
    catch (e) {
      const why = String(e.message).split('\n')[0].slice(0, 100);
      if (!ready) throw new Error(T(`${why}\n  没有配回落配音：在 ~/.openshorts/config.json 加 tts.fallback = { provider, model, voice }（AO 里有语音端点的供应商）就能在 Edge TTS 挂掉时继续出片`,
        `${why}\n  No fallback voice configured: add tts.fallback = { provider, model, voice } to ~/.openshorts/config.json (an AO provider with a speech endpoint) to keep rendering when Edge TTS is down`));
      log(T(`⚠️ Edge TTS 失败（${why}），改用 ${fb.provider}/${fb.model}/${fb.voice} 配音——没有词级时间戳，字幕按字数估时轴`,
        `⚠️ Edge TTS failed (${why}); falling back to ${fb.provider}/${fb.model}/${fb.voice} — no word timestamps, captions will be estimated from text length`));
      const gen = aoSpeech ?? await aoGenerateSpeech();
      const saved = aoSavedKeys();
      const config = { provider: fb.provider, model: fb.model, api_key: saved[fb.provider]?.apiKey || undefined, timeout: 120_000, retry: 0 };
      const r = await gen(config, text, { provider: fb.provider, model: fb.model, voice: fb.voice, format: 'mp3', ...(opts.rate && opts.rate !== 1 ? { speed: opts.rate } : {}) });
      if (!r?.buffer?.length) throw new Error(T('回落配音返回空音频', 'Fallback voice returned empty audio'));
      if (opts.outFile) { fs.mkdirSync(path.dirname(opts.outFile), { recursive: true }); fs.writeFileSync(opts.outFile, r.buffer); }
      return { file: opts.outFile ?? null, buffer: opts.outFile ? null : r.buffer, durationMs: null, words: [], fallback: `${fb.provider}/${fb.model}` };
    }
  };
}
