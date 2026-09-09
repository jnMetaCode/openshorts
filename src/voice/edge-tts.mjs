/**
 * Edge TTS（免费、中文音色多，MoneyPrinterTurbo 同款默认）——用 msedge-tts（纯 Node，不需要 Python）。
 * 返回 mp3 + 词级时间戳（字幕时轴直接用它，不必跑 whisper）。
 * 依赖微软非官方端点；失败时调用方降级到 AO `type: tts` 或离线方案（PRD 风险表）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

/**
 * 音色清单按出片语言分。英文这五个是本机真发过请求核实的（都回了音频 + 词级时间戳），
 * 括号里是实测语速，写出来是因为它决定英文脚本的词数区间：整体 2.67–3.09 词/秒，
 * 模板按中位数 2.9 定区间（见 src/project/lang.mjs）。
 */
export const DEFAULT_VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女 · 亲和通用', lang: 'zh' },
  { id: 'zh-CN-YunxiNeural', label: '云希 · 男 · 年轻活泼', lang: 'zh' },
  { id: 'zh-CN-YunjianNeural', label: '云健 · 男 · 沉稳解说', lang: 'zh' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女 · 轻快', lang: 'zh' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 · 男 · 新闻播报', lang: 'zh' },
  { id: 'en-US-AvaNeural', label: 'Ava · female · warm all-rounder (US)', lang: 'en' },
  { id: 'en-US-AndrewNeural', label: 'Andrew · male · brisk narrator (US)', lang: 'en' },
  { id: 'en-US-EmmaNeural', label: 'Emma · female · bright and quick (US)', lang: 'en' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia · female · calm explainer (UK)', lang: 'en' },
  { id: 'en-GB-RyanNeural', label: 'Ryan · male · steady documentary (UK)', lang: 'en' },
];
/** 某个出片语言可用的音色；语言不认识时给全部（手填的音色 id 照样能用） */
export const voicesFor = (lang) => {
  const l = String(lang ?? '').toLowerCase().startsWith('en') ? 'en' : String(lang) === 'zh' ? 'zh' : null;
  return l ? DEFAULT_VOICES.filter((v) => v.lang === l) : DEFAULT_VOICES;
};

/** 合成一段文案 → { file, durationMs, words:[{text,startMs,endMs}] } */
export async function synthesize(text, { voice = 'zh-CN-XiaoxiaoNeural', rate = 1.0, outFile } = {}) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
  // toStream 的 'end' 在部分版本上不触发（实测挂起）；toFile 会等连接关闭再落盘，稳定
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openshorts-tts-'));
  let audioFilePath, metadataFilePath;
  try {
    ({ audioFilePath, metadataFilePath } = await tts.toFile(tmpDir, text, { rate }));
    const buf = fs.readFileSync(audioFilePath);
    if (!buf.length) throw new Error('Edge TTS 返回空音频（端点可能变动或网络受限）——可切 AO type:tts 或离线方案');
    const words = [];
    if (metadataFilePath && fs.existsSync(metadataFilePath)) {
      // msedge-tts 写的是一整个（多行）JSON；旧版本是 JSONL——两种都认
      const raw = fs.readFileSync(metadataFilePath, 'utf-8');
      const docs = [];
      try { docs.push(JSON.parse(raw)); } catch { for (const line of raw.split(/\r?\n/)) { try { if (line.trim()) docs.push(JSON.parse(line)); } catch { /* skip */ } } }
      for (const j of docs) for (const m of j.Metadata ?? []) if (m.Type === 'WordBoundary') {
        const d = m.Data; words.push({ text: d.text?.Text ?? '', startMs: Math.round(d.Offset / 10000), endMs: Math.round((d.Offset + d.Duration) / 10000) });
      }
    }
    if (outFile) { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, buf); }
    const durationMs = words.length ? words[words.length - 1].endMs : null;
    return { file: outFile ?? null, buffer: outFile ? null : buf, durationMs, words };
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); tts.close?.(); }
}
