/**
 * 字幕：词级时间戳 → 字幕条（≤ maxChars/行、≤ 2 行、按标点断）→ SRT / ASS（3 套样式预设）。纯函数 + 一个写文件的薄壳。
 */
export const STYLE_PRESETS = {
  douyin: { name: '抖音黄字描边', font: 'PingFang SC', size: 64, color: '&H0000E5FF', outline: '&H00000000', outlineW: 3, shadow: 0, bold: 1, marginV: 260, highlight: '&H0000A5FF' },
  clean:  { name: '简约白',       font: 'PingFang SC', size: 58, color: '&H00FFFFFF', outline: '&H00000000', outlineW: 2, shadow: 1, bold: 0, marginV: 240, highlight: '&H00FFE066' },
  boxed:  { name: '黑底白字',     font: 'PingFang SC', size: 56, color: '&H00FFFFFF', outline: '&H00000000', outlineW: 0, shadow: 0, bold: 1, marginV: 240, box: true, highlight: '&H00FFE066' },
};

const PUNCT = /[，。！？；：、,.!?;:…—]/;

/**
 * Edge TTS 的词边界不带标点——把原文里的标点贴回对应词尾，buildCues 才能在句读处断行。
 * 按顺序在原文里找每个词；找不到就原样保留（不猜）。
 */
export function alignPunctuation(words, text) {
  const src = String(text ?? '');
  let pos = 0; const out = [];
  for (const w of words) {
    const t = w.text;
    const i = src.indexOf(t, pos);
    if (i < 0) { out.push({ ...w }); continue; }
    let end = i + t.length; let punct = '';
    while (end < src.length && /[，。！？；：、,.!?;:…—）)」』”]/.test(src[end])) { punct += src[end]; end++; }
    pos = end;
    out.push({ ...w, text: t + punct });
  }
  return out;
}

/** words: [{text,startMs,endMs}] → cues: [{startMs,endMs,text,words}] */
export function buildCues(words, { maxChars = 16, maxLines = 2, offsetMs = 0, maxDurMs = 4500 } = {}) {
  const cues = []; let cur = [];
  const len = (ws) => ws.reduce((n, w) => n + w.text.length, 0);
  const flush = () => { if (cur.length) { cues.push({ startMs: cur[0].startMs + offsetMs, endMs: cur[cur.length - 1].endMs + offsetMs, text: cur.map((w) => w.text).join(''), words: cur.map((w) => ({ ...w, startMs: w.startMs + offsetMs, endMs: w.endMs + offsetMs })) }); cur = []; } };
  for (const w of words) {
    const t = w.text.replace(/\s+/g, '');
    if (!t) continue;
    if (len(cur) + t.length > maxChars * maxLines) flush();
    if (cur.length && w.endMs - cur[0].startMs > maxDurMs) flush();   // 一条最多 4.5 秒，读得完也不发闷
    cur.push({ ...w, text: t });
    if (/[。！？；…]/.test(t.slice(-1)) || (PUNCT.test(t.slice(-1)) && len(cur) >= maxChars * 0.6)) flush();
  }
  flush();
  // 相邻条之间的空隙 ≤ 300ms 时把上一条尾巴拉到下一条开头，避免闪烁
  for (let i = 0; i + 1 < cues.length; i++) if (cues[i + 1].startMs - cues[i].endMs < 300) cues[i].endMs = cues[i + 1].startMs;
  return cues;
}

/** 没有词级时间戳时：按字数比例把一段文案摊到 [0, durationMs]（标 estimated） */
export function estimateWords(text, durationMs) {
  const chars = [...String(text).replace(/\s+/g, '')];
  const per = durationMs / Math.max(chars.length, 1);
  return chars.map((c, i) => ({ text: c, startMs: Math.round(i * per), endMs: Math.round((i + 1) * per), estimated: true }));
}

export function toSRT(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.startMs)} --> ${srtTime(c.endMs)}\n${wrap(c.text)}\n`).join('\n');
}

export function toASS(cues, { preset = 'douyin', w = 1080, h = 1920, emphasis = [] } = {}) {
  const p = STYLE_PRESETS[preset] ?? STYLE_PRESETS.douyin;
  const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${p.font},${p.size},${p.color},${p.color},${p.outline},&H80000000,${p.bold},0,0,0,100,100,0,0,${p.box ? 3 : 1},${p.outlineW},${p.shadow},2,60,60,${p.marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const lines = cues.map((c) => {
    let text = wrap(c.text).replace(/\n/g, '\\N');
    for (const kw of emphasis) if (kw && text.includes(kw)) text = text.split(kw).join(`{\\c${p.highlight}}${kw}{\\c${p.color}}`);
    return `Dialogue: 0,${assTime(c.startMs)},${assTime(c.endMs)},Default,,0,0,0,,${text}`;
  });
  return head + lines.join('\n') + '\n';
}

const wrap = (t, n = 16) => { const s = [...t]; if (s.length <= n) return t; let cut = -1; for (let i = Math.min(n, s.length - 1); i > n * 0.4; i--) if (PUNCT.test(s[i - 1])) { cut = i; break; } if (cut < 0) cut = n; return s.slice(0, cut).join('') + '\n' + s.slice(cut).join(''); };
const pad = (n, l = 2) => String(n).padStart(l, '0');
const srtTime = (ms) => `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
const assTime = (ms) => `${Math.floor(ms / 3600000)}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(Math.floor((ms % 1000) / 10))}`;
