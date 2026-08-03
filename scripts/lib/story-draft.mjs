// 话题 → 故事草稿（story.json + storyboard.json 骨架）。
//
// 对标 MoneyPrinterTurbo（101k 星）的核心体验：给一个话题，直接得到能渲染的工程。
// 区别在于我们不跳过人工环节——产出的是**可审阅的草稿文件**，走既有的
// audio → render → 七道验收流水线，而不是黑盒一键出片。
//
// 分镜骨架遵循 docs/x-viral-video-playbook.md 蒸馏的三条硬规则：
// 第一镜即论点、每 2-3 秒视觉推进（骨架化屏显）、结尾定格。

const CHARS_PER_SECOND = 4.2;

export const draftPrompt = (topic, {segments = 6} = {}) => `请为以下话题写一条中文竖屏解说视频的口播文案，拆成 ${segments} 段。只输出 JSON：
{"title":"片名（≤14字）","hook":"一句封面钩子（≤20字）","segments":[{"id":"英文短slug","text":"该段口播（18-60字）","purpose":"叙事目的","screenTitle":"该段屏显大标题（≤10字）","screenPoints":["屏显要点（≤14字）","..."]}]}
硬性规则：①第 1 段就是钩子本身，直接抛出最反直觉的事实或数字，禁止背景铺垫；②每段口播 18-60 字，信息密度优先；③最后一段是一句可记住的判断，不做总结陈词；④screenPoints 是骨架关键词，禁止与口播逐字重复。
话题：${topic}`;

const slug = (value, index) => {
  const cleaned = String(value ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return cleaned || `seg-${index + 1}`;
};

/** 校验并归一化模型返回的草稿。抛错信息面向使用者，指明哪一段不合规。 */
export const normalizeDraft = (raw) => {
  if (!raw || typeof raw !== 'object') throw new Error('草稿不是 JSON 对象');
  const segments = Array.isArray(raw.segments) ? raw.segments : [];
  if (segments.length < 3 || segments.length > 12) throw new Error(`草稿有 ${segments.length} 段，期望 3-12 段`);
  const seen = new Set();
  const normalized = segments.map((segment, index) => {
    const text = String(segment?.text ?? '').trim();
    if (text.length < 10 || text.length > 90) throw new Error(`第 ${index + 1} 段口播 ${text.length} 字，超出 10-90 字范围`);
    let id = slug(segment?.id, index);
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    return {
      id, text,
      purpose: String(segment?.purpose ?? '').trim() || `第 ${index + 1} 段`,
      screenTitle: String(segment?.screenTitle ?? '').trim().slice(0, 12),
      screenPoints: (Array.isArray(segment?.screenPoints) ? segment.screenPoints : [])
        .map((point) => String(point).trim()).filter(Boolean).slice(0, 4),
    };
  });
  return {
    title: String(raw.title ?? '').trim().slice(0, 20) || '未命名草稿',
    hook: String(raw.hook ?? '').trim().slice(0, 30) || normalized[0].text.slice(0, 20),
    segments: normalized,
  };
};

export const estimateSeconds = (text) => Math.max(3, text.length / CHARS_PER_SECOND + 0.8);

/** 从草稿生成 story.json + 技术解读式 storyboard.json 骨架（文字信息板，无需任何素材）。 */
export const buildStoryFiles = ({draft, name, format = '9:16'}) => {
  const landscape = format === '16:9';
  const [W, H] = landscape ? [1920, 1080] : [1080, 1920];
  const margin = Math.round(W * 0.09);
  const width = W - margin * 2;
  const card = 'rgba(12,15,25,.78)';

  const story = {
    id: name,
    title: draft.title,
    format,
    targetSeconds: Math.round(draft.segments.reduce((sum, item) => sum + estimateSeconds(item.text), 0)),
    hook: draft.hook,
    pronunciations: {},
    segments: draft.segments.map(({id, text, purpose}) => ({id, text, purpose})),
  };

  const scenes = draft.segments.map((segment, index) => {
    const layers = [];
    const titleY = Math.round(H * (landscape ? 0.14 : 0.16));
    if (segment.screenTitle) layers.push({
      id: `${segment.id}-title`, name: '标题', kind: 'text', role: 'primary',
      x: margin, y: titleY, width, zIndex: 6, entrance: 'up', delayFrames: 4,
      style: {text: segment.screenTitle, fontSize: landscape ? 84 : 88, fontWeight: 900},
    });
    if (segment.screenPoints.length) layers.push({
      id: `${segment.id}-points`, name: '要点', kind: 'text', role: 'secondary',
      x: margin, y: titleY + Math.round(H * 0.11), width, zIndex: 5,
      entrance: 'fade', delayFrames: 30, paperEdge: false,
      style: {text: segment.screenPoints.map((point) => `· ${point}`).join('\n'), fontSize: landscape ? 54 : 58,
              fontWeight: 700, lineHeight: 1.55, color: '#d8dfeb', background: card, padding: 26,
              revealFrames: 14},
    });
    if (!layers.length) layers.push({
      id: `${segment.id}-fallback`, name: '文本', kind: 'text', role: 'primary',
      x: margin, y: Math.round(H * 0.3), width, zIndex: 5, entrance: 'up', delayFrames: 6,
      style: {text: segment.text.slice(0, 16), fontSize: 72, fontWeight: 800},
    });
    return {
      ...(index === draft.segments.length - 1 ? {holdSeconds: 1.2} : {}),
      layers,
      audioCues: index === 0 ? [{src: 'audio/common/impact.wav', fromFrame: 0, volume: 0.42}] : [],
    };
  });

  const storyboard = {
    backgroundColor: '#12151f',
    cameraZoom: 1.02,
    soundtrackVolume: 0.34,
    fallbackDurations: draft.segments.map((segment) => Number(estimateSeconds(segment.text).toFixed(1))),
    voice: {name: 'zh-CN-YunyangNeural', rate: '+0%', pitch: '+0Hz'},
    music: {mood: 'pulse'},
    theme: {paper: '#f6eedb', ink: '#12151f', accent: '#e8a33d', subtitleBackground: 'rgba(12,15,25,.9)'},
    production: {
      style: {format, mode: 'technical', look: '信息板骨架（LLM 草稿），待人工润色与配图'},
      characters: [],
    },
    scenes,
  };
  return {story, storyboard};
};
