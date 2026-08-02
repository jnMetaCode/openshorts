// 旁白内容覆盖检查。
//
// 原来的 Whisper「反向验收」只校验 expected-language=zh 和概率 ≥0.9，
// 也就是只回答「成片里有没有中文人声」。它抓得住静音成片，但抓不住
// 漏了一段、顺序错了、或者混进了别的故事的旁白——这些都是真会发生的事故。
//
// 阈值用真实数据标定过（《后羿射日》+ faster-whisper-small）：
//   正常（含同音错字）  每段最低 0.732
//   漏掉其中一段        该段掉到 0.197
//   整条换成别的故事    最低 0.113
// 取 0.55 两侧都有充足余量。

// 同音错字是本地小模型的常态（金乌→金屋、一箭→一剑），不能按精确匹配判。
// 标点和空白在转写里本就不稳定，先去掉。
export const normalizeForMatch = (text) => String(text ?? '').replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '');

/** 最长公共子序列长度。滚动数组，空间 O(min)。 */
const lcsLength = (a, b) => {
  if (!a.length || !b.length) return 0;
  let previous = new Uint32Array(b.length + 1);
  let current = new Uint32Array(b.length + 1);
  for (const ch of a) {
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = ch === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    [previous, current] = [current, previous];
    current.fill(0);
  }
  return previous[b.length];
};

/**
 * 在转写全文里滑窗找与目标最相似的一段，返回 Dice 相似度 2·LCS/(|a|+|b|)。
 *
 * 不能直接对整篇算 LCS——中文字符复用率高，漏掉一整段后仍能从别处凑出
 * 0.84 的覆盖率，判别力归零。必须要求目标以连续的一段出现。
 */
export const bestWindowRatio = (expected, haystack, {step = 2, windowScale = 1.3} = {}) => {
  const a = normalizeForMatch(expected);
  if (!a.length) return 1;
  if (!haystack.length) return 0;
  const width = Math.max(1, Math.round(a.length * windowScale));
  let best = 0;
  for (let start = 0; start < Math.max(1, haystack.length - a.length + 1); start += step) {
    const b = haystack.slice(start, start + width);
    if (!b.length) continue;
    best = Math.max(best, 2 * lcsLength(a, b) / (a.length + b.length));
    if (best === 1) break;
  }
  return best;
};

export const COVERAGE_THRESHOLD = 0.55;

/**
 * 逐段检查旁白是否真的念到了。
 * @returns {{passed: boolean, threshold: number, segments: Array, lowest: number}}
 */
export const checkNarrationCoverage = ({storySegments = [], transcriptSegments = [], threshold = COVERAGE_THRESHOLD} = {}) => {
  const haystack = normalizeForMatch(transcriptSegments.map((item) => item.text ?? '').join(''));
  const segments = storySegments.map((segment) => {
    const ratio = bestWindowRatio(segment.text, haystack);
    return {id: segment.id, ratio: Number(ratio.toFixed(3)), passed: ratio >= threshold, text: segment.text};
  });
  const lowest = segments.length ? Math.min(...segments.map((item) => item.ratio)) : 1;
  return {passed: segments.every((item) => item.passed), threshold, lowest, segments};
};
