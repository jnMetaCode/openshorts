import test from 'node:test';
import assert from 'node:assert/strict';
import {captionReadingRate, splitCaptionText, splitCaptions, subtitleBottomRatio, subtitleFontSize} from '../shared/captions.mjs';

const endsWithPunctuation = (text) => /[。，、；：？！,.;:?!…—]$/.test(text);

test('长句在标点处断行，不会把词切开', () => {
  const parts = splitCaptionText('如果天上同时挂着十个太阳，河干了，地裂了，庄稼一晒就冒烟。', 20);
  assert.ok(parts.length > 1, '超长句应该被拆开');
  assert.equal(parts.join(''), '如果天上同时挂着十个太阳，河干了，地裂了，庄稼一晒就冒烟。');
  for (const part of parts.slice(0, -1)) assert.ok(endsWithPunctuation(part), `“${part}”没有停在标点上`);
  assert.ok(!parts.some((part) => part.startsWith('了，')), '不应出现「河干／了」这类词中断行');
});

test('只有一个逗号的长句在逗号处断开', () => {
  assert.deepEqual(
    splitCaptionText('后来人们记住了那九箭，也记住了那支没有射出去的箭。', 20),
    ['后来人们记住了那九箭，', '也记住了那支没有射出去的箭。'],
  );
});

test('短句保持完整，不做无谓拆分', () => {
  assert.deepEqual(splitCaptionText('你会怎么办？', 20), ['你会怎么办？']);
});

test('无标点的超长句才走硬切兜底', () => {
  const parts = splitCaptionText('一'.repeat(64), 20);
  assert.ok(parts.length >= 3);
  assert.equal(parts.join(''), '一'.repeat(64));
  for (const part of parts) assert.ok(part.length <= 22, `硬切片段过长：${part.length}`);
});

test('结尾的孤儿碎片并回上一行', () => {
  const parts = splitCaptionText('草木枯焦，江河见底，老百姓连一片躲太阳的影子都找不到，唉。', 20);
  assert.ok(parts.at(-1).length > 5, `结尾不应留下孤儿碎片：${parts.at(-1)}`);
});

test('时间轴铺满镜头且永不越界', () => {
  const frames = 399;
  const cues = splitCaptions('传说里，十只金乌本该轮流值班，一天只出一个。可它们偏要一起上天。', frames);
  assert.ok(cues.length > 1);
  assert.equal(cues[0].fromFrame, 4);
  assert.ok(cues.at(-1).toFrame <= frames - 2);
  for (const [index, cue] of cues.entries()) {
    assert.ok(cue.toFrame > cue.fromFrame, '结束帧必须大于开始帧');
    if (index > 0) assert.equal(cue.fromFrame, cues[index - 1].toFrame, '字幕之间不应有空档或重叠');
  }
});

test('镜头极短时依然产出合法区间', () => {
  const cues = splitCaptions('一句。两句。三句。四句。', 8);
  for (const [index, cue] of cues.entries()) {
    assert.ok(cue.toFrame > cue.fromFrame, `第 ${index + 1} 条区间非法`);
    assert.ok(cue.fromFrame >= 0);
  }
});

test('阅读速度按字数与停留时长计算', () => {
  assert.equal(captionReadingRate({text: '十个字十个字', fromFrame: 0, toFrame: 30}, 30), 6);
});

test('竖屏字幕避开平台 UI，横屏不受此约束', () => {
  assert.equal(subtitleBottomRatio(1080, 1920), 0.2);
  assert.equal(subtitleBottomRatio(1920, 1080), 0.08);
});

test('字号按短边计算，横竖屏得到一致的每行字数', () => {
  assert.equal(subtitleFontSize(1080, 1920), subtitleFontSize(1920, 1080));
  assert.equal(subtitleFontSize(1080, 1920), 49);
});
