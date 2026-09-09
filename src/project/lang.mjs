/**
 * 出片语言。界面早就双语了，但**片子本身**一直只会说中文：模板提示词、语速尺子、
 * 字幕断行、默认音色，四处各写死一份中文假设。英文用户拿到的是英文外壳 + 中文成片。
 *
 * 所有语言差异集中在这张表里——服务端、CLI、项目构建、字幕都从这里取，
 * 免得又变成"改一处只修了一半"（短剧线的运行目录判定就是这么栽过的）。
 */

export const LANGS = ['zh', 'en'];
export const normLang = (l) => (String(l ?? '').toLowerCase().startsWith('en') ? 'en' : 'zh');

/**
 * perSec 是 Edge TTS 的**实测**语速，不是估的：
 * - zh 4.5 字/秒（口播科普模板一直用的这把尺子）
 * - en 2.9 词/秒 —— 本机跑 8 个英文音色念同一段 61 词文本测出来：
 *   en-AU-Natasha 2.67 最慢、en-US-Andrew 3.09 最快，中位数 2.9。
 * 改这里要同步改对应模板 yaml 里手写的字数区间（yaml 导不了常量）。
 */
export const LANG_SPEC = {
  zh: {
    template: 'koubo-kepu.yaml',
    unit: 'chars',
    perSec: 4.5,
    voice: 'zh-CN-XiaoxiaoNeural',
    captionMaxChars: 16,
    // 每行 16 个汉字 ≈ 竖版一行的极限
    durations: { 45: '45秒', 60: '60秒', 90: '90秒' },
    tones: { explainer: '科普讲解', opinion: '犀利观点', casual: '轻松口播' },
    ttsSample: '你好，这是开片的配音试听。',
  },
  en: {
    template: 'koubo-explainer.en.yaml',
    unit: 'words',
    perSec: 2.9,
    voice: 'en-US-AvaNeural',
    // 拉丁字母窄得多：16 个字符一行在竖版上只占半屏，34 才和中文 16 字视觉等宽
    captionMaxChars: 34,
    durations: { 45: '45 seconds', 60: '60 seconds', 90: '90 seconds' },
    tones: { explainer: 'explainer', opinion: 'sharp opinion', casual: 'casual talk' },
    ttsSample: 'Hi, this is a voice preview from OpenShorts.',
  },
};

export const langSpec = (lang) => LANG_SPEC[normLang(lang)];

/**
 * 双语文案的统一出口：`const T = tt(lang); T('中文', 'English')`。
 *
 * 界面的 i18n 是"以中文原文为 key 查字典"，只能翻**前端写死**的那些字符串；
 * 服务端现算出来的话（出片日志、报错、质检原话、成片提示）带着数字和文件名，
 * 字典查不到，于是英文用户一路看中文。这些地方一律在产生的那一刻就定语言。
 *
 * 语言来源的优先级固定：项目的 `lang` → 请求参数 → 中文。不猜、不按浏览器猜。
 */
export const tt = (lang) => {
  const en = normLang(lang) === 'en';
  return (zh, enText) => (en ? enText ?? zh : zh);
};

/** 口播文本的长度：中文按字数（不含空白），英文按词数。长度门槛与重写反馈都用它。 */
export function textLength(text, lang) {
  const s = String(text ?? '');
  return normLang(lang) === 'en' ? (s.trim().match(/\S+/g) ?? []).length : s.replace(/\s+/g, '').length;
}

/** 「字」还是「词」——报错文案里要说人话，英文片子说"278 字"没人看得懂 */
export const lengthUnitLabel = (lang, zhLabel = '字', enLabel = 'words') => (normLang(lang) === 'en' ? enLabel : zhLabel);

/**
 * 界面传上来的时长/语气一律是中文选项值（前端状态是中文，英文只是显示层翻译）。
 * 英文模板的提示词里要塞的是英文——在这里翻一次，别让 `{{duration}}` 在英文提示词里
 * 渲染成「60秒」。认不出来的值原样透传（用户手填的语气也要能用）。
 */
export function localizeInputs(inputs = {}, lang = 'zh') {
  const spec = langSpec(lang);
  const secs = Number(String(inputs.duration ?? '').match(/\d+/)?.[0]);
  const toneKey = Object.entries(LANG_SPEC.zh.tones).find(([, v]) => v === inputs.tone)?.[0]
    ?? Object.entries(LANG_SPEC.en.tones).find(([, v]) => v === inputs.tone)?.[0];
  return {
    ...inputs,
    duration: (secs && spec.durations[secs]) || inputs.duration,
    tone: (toneKey && spec.tones[toneKey]) || inputs.tone,
  };
}
