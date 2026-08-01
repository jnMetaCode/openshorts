// 字幕切分：优先在句末标点断开，其次在逗号、顿号、冒号断开，
// 只有当一整个无标点长句仍然超长时才按长度硬切，避免出现「河干／了」这类词中断行。
const SENTENCE_END = /(?<=[。？！；!?;])/;
const CLAUSE_END = /(?<=[，、：,:])/;

// 字幕卡片宽度取画面的 86%，字号取短边的 4.5%，因此一行最多约 18 个汉字；
// 取 16 留出余量，两条渲染路径都不会把词换行拆开。
export const MAX_LINE_CHARS = 16;

const hardSplit = (text, maxChars) => {
  const pieces = Math.ceil(text.length / maxChars);
  const size = Math.ceil(text.length / pieces);
  const out = [];
  for (let index = 0; index < text.length; index += size) out.push(text.slice(index, index + size));
  return out;
};

// 把小句贪心打包到 maxChars 以内；结尾的孤儿碎片并回上一行。
const packClauses = (sentence, maxChars) => {
  const clauses = sentence.split(CLAUSE_END).filter(Boolean);
  const lines = [];
  let buffer = '';
  for (const clause of clauses) {
    if (!buffer) { buffer = clause; continue; }
    if (buffer.length + clause.length <= maxChars) buffer += clause;
    else { lines.push(buffer); buffer = clause; }
  }
  if (buffer) lines.push(buffer);
  const tail = lines.at(-1);
  if (lines.length > 1 && tail.length <= 5 && lines.at(-2).length + tail.length <= Math.round(maxChars * 1.3)) {
    lines.splice(-2, 2, lines.at(-2) + tail);
  }
  return lines;
};

export const splitCaptionText = (text, maxChars = MAX_LINE_CHARS) => {
  const sentences = String(text ?? '').split(SENTENCE_END).map((item) => item.trim()).filter(Boolean);
  const lines = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) { lines.push(sentence); continue; }
    lines.push(...packClauses(sentence, maxChars));
  }
  // 无标点的超长句兜底：宁可硬切，也不让单条字幕长到读不完。
  return lines.flatMap((line) => line.length <= Math.round(maxChars * 1.5) ? [line] : hardSplit(line, maxChars));
};

// 按字数比例分配时间区间，铺满整个镜头；后续每条字幕至少保留 1 帧，永远不会越界。
export const splitCaptions = (text, frames, {maxChars = MAX_LINE_CHARS, leadFrames = 4, tailFrames = 2} = {}) => {
  const parts = splitCaptionText(text, maxChars);
  if (!parts.length) return [];
  const end = Math.max(parts.length + leadFrames, frames - tailFrames);
  const span = end - leadFrames;
  const weights = parts.map((part) => Math.max(1, part.length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = leadFrames;
  return parts.map((part, index) => {
    const remaining = parts.length - index - 1;
    const ideal = index === parts.length - 1 ? end : cursor + Math.round(span * weights[index] / total);
    const toFrame = Math.max(cursor + 1, Math.min(ideal, end - remaining));
    const item = {text: part, fromFrame: cursor, toFrame, words: []};
    cursor = toFrame;
    return item;
  });
};

// 中文舒适阅读速度约每秒 7 字；超过 9 字/秒基本读不完。
export const captionReadingRate = (caption, fps) => caption.text.length / Math.max(1e-6, (caption.toFrame - caption.fromFrame) / fps);

// 竖屏底部 20% 会被平台 UI（账号名、话题、进度条）覆盖，横屏无此约束。
export const subtitleBottomRatio = (width, height) => (height > width ? 0.2 : 0.08);
export const subtitleFontSize = (width, height) => Math.round(Math.min(width, height) * 0.045);
