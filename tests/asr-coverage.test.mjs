import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {COVERAGE_THRESHOLD, bestWindowRatio, checkNarrationCoverage, normalizeForMatch} from '../scripts/lib/asr-coverage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const story = JSON.parse(fs.readFileSync(path.join(root, 'content/nine-suns/story.json'), 'utf8'));

// 取自 faster-whisper-small 对《后羿射日》成片的真实转写，保留了它的同音错字
// （河干→和干、金乌→金屋、一箭→一剑、射下来→设下来、收了弓→收了工）。
const transcript = [
  {start: 0, text: '如果天上同时挂着十个太阳'},
  {start: 2.4, text: '和干了、地裂了、装甲一晒就冒烟'},
  {start: 5.76, text: '你会怎么办?'},
  {start: 7.08, text: '上古的答案只有三个字设下来'},
  {start: 10.88, text: '传说里,十只金屋本该轮流直班'},
  {start: 13.6, text: '一天指出一个'},
  {start: 15.4, text: '可他们偏要一起上天'},
  {start: 17.6, text: '草木枯焦、江河见底'},
  {start: 19.8, text: '老百姓连一片躲太阳的影子都找不到'},
  {start: 24, text: '这时候站出来一个人,后裔'},
  {start: 26.76, text: '他背着一张红色的大弓'},
  {start: 28.72, text: '一步一步登上最高的山'},
  {start: 31.24, text: '风把他的衣脚吹得像一面旗'},
  {start: 34.96, text: '一剑一只金屋坠落'},
  {start: 37.28, text: '再一剑又一只'},
  {start: 39.24, text: '九只剑九个太阳'},
  {start: 41, text: '一个接一个从天上熄灭'},
  {start: 44.32, text: '只剩最后一个的时候'},
  {start: 45.8, text: '他却收了工'},
  {start: 47.36, text: '有人问为什么'},
  {start: 49.04, text: '他说万物生长总得留一个太阳'},
  {start: 53.16, text: '后来人们记住了那九剑'},
  {start: 55.2, text: '也记住了那只没有射出去的剑'},
  {start: 58.04, text: '英雄的分寸比英雄的力气更难得'},
];

test('标点和空白不参与比对', () => {
  assert.equal(normalizeForMatch('如果，天上 同时挂着十个太阳。'), '如果天上同时挂着十个太阳');
  assert.equal(normalizeForMatch(null), '');
});

test('同音错字不会误判为漏读', () => {
  const result = checkNarrationCoverage({storySegments: story.segments, transcriptSegments: transcript});
  assert.equal(result.passed, true, `最低 ${result.lowest}：${JSON.stringify(result.segments.filter((s) => !s.passed))}`);
  assert.ok(result.lowest >= 0.7, `正常转写的最低分应远高于阈值，实际 ${result.lowest}`);
});

test('漏掉一整段会被抓出来', () => {
  // 按时间剔除第 4 段（一箭…熄灭）对应的转写
  const missing = transcript.filter((item) => !(item.start >= 34.5 && item.start < 44.5));
  const result = checkNarrationCoverage({storySegments: story.segments, transcriptSegments: missing});
  assert.equal(result.passed, false);
  const failed = result.segments.filter((item) => !item.passed);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].id, 'shooting');
  assert.ok(failed[0].ratio < 0.3, `漏段应显著低于阈值，实际 ${failed[0].ratio}`);
});

test('混进别的故事的旁白会被抓出来', () => {
  const other = JSON.parse(fs.readFileSync(path.join(root, 'content/lychee-road/story.json'), 'utf8'));
  const result = checkNarrationCoverage({storySegments: story.segments, transcriptSegments: other.segments});
  assert.equal(result.passed, false);
  assert.ok(result.lowest < 0.25, `错故事应接近 0，实际 ${result.lowest}`);
});

test('空转写直接判失败，不会因为没内容而放过', () => {
  const result = checkNarrationCoverage({storySegments: story.segments, transcriptSegments: []});
  assert.equal(result.passed, false);
  assert.equal(result.lowest, 0);
});

test('正常与故障之间有足够余量', () => {
  const ok = checkNarrationCoverage({storySegments: story.segments, transcriptSegments: transcript}).lowest;
  const missing = transcript.filter((item) => !(item.start >= 34.5 && item.start < 44.5));
  const bad = checkNarrationCoverage({storySegments: story.segments, transcriptSegments: missing}).lowest;
  assert.ok(ok - COVERAGE_THRESHOLD > 0.15, `阈值离正常态太近：${ok} vs ${COVERAGE_THRESHOLD}`);
  assert.ok(COVERAGE_THRESHOLD - bad > 0.15, `阈值离故障态太近：${bad} vs ${COVERAGE_THRESHOLD}`);
});

test('滑窗要求内容连续出现，打散的字符不算匹配', () => {
  // 目标字符全都在，但散落在无关文本里——不应判为匹配上了
  const scattered = '一天二天三天箭四天五天金六天七天乌八天九天坠十天落';
  assert.ok(bestWindowRatio('一箭一只金乌坠落', scattered) < COVERAGE_THRESHOLD);
  assert.ok(bestWindowRatio('一箭一只金乌坠落', '开头无关一箭一只金乌坠落结尾无关') > 0.8);
});
