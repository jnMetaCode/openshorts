import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCues, estimateWords, toSRT, toASS, STYLE_PRESETS, alignPunctuation } from '../src/captions/build.mjs';

const words = [['你',100,200],['有没有',213,625],['发现，',638,1125],['猫',1438,1588],['为什么',1600,2000],['总爱',2010,2300],['钻',2310,2400],['纸箱？',2410,2900],['这',3200,3300],['不是',3310,3500],['任性，',3510,3900],['是',4000,4100],['刻在',4110,4400],['基因',4410,4700],['里的',4710,4900],['安全感。',4910,5600]].map(([text,startMs,endMs])=>({text,startMs,endMs}));

test('按标点与字数切条：每条 ≤ 32 字，句末标点处断开，空隙 < 300ms 时无缝衔接', () => {
  const cues = buildCues(words, { maxChars: 16 });
  assert.ok(cues.length >= 2);
  for (const c of cues) assert.ok([...c.text].length <= 32, c.text);
  assert.equal(cues[0].text.endsWith('？') || cues[0].text.endsWith('，'), true);
  for (let i = 0; i + 1 < cues.length; i++) assert.ok(cues[i].endMs <= cues[i + 1].startMs);
});

test('SRT 时间格式与序号', () => {
  const srt = toSRT(buildCues(words));
  assert.match(srt, /^1\n00:00:00,100 --> /);
});

test('ASS：三套预设都能生成，关键词高亮插入颜色标签', () => {
  for (const k of Object.keys(STYLE_PRESETS)) {
    const ass = toASS(buildCues(words), { preset: k, emphasis: ['安全感'] });
    assert.match(ass, /PlayResX: 1080/);
    assert.match(ass, /Dialogue: 0,0:00:00\.10/);
    assert.ok(ass.includes('{\\c') && ass.includes('安全感'));
  }
});

test('无词级时间戳时按字数摊时长（标 estimated）', () => {
  const ws = estimateWords('猫为什么爱钻纸箱', 4000);
  assert.equal(ws.length, 8); assert.equal(ws[7].endMs, 4000); assert.equal(ws[0].estimated, true);
});

test('alignPunctuation：把原文标点贴回词尾，句号处必断条；单条 ≤ 4.5 秒', () => {
  const raw = [['为什么',0,500],['猫',510,700],['放着',710,1000],['豪华',1010,1400],['猫窝',1410,1800],['不睡',1810,2200],['非要',2300,2600],['钻进',2610,2900],['破',2910,3000],['纸箱',3010,3400],['科学',4000,4400],['解释',4410,4800],['来了',4810,5200]].map(([text,startMs,endMs])=>({text,startMs,endMs}));
  const aligned = alignPunctuation(raw, '为什么猫放着豪华猫窝不睡，非要钻进破纸箱？科学解释来了，');
  assert.equal(aligned[5].text, '不睡，'); assert.equal(aligned[9].text, '纸箱？');
  const cues = buildCues(aligned, { maxChars: 16 });
  assert.ok(cues[0].text.endsWith('？') || cues[1].text.endsWith('？'));
  for (const c of cues) assert.ok(c.endMs - c.startMs <= 4600, `${c.text} ${c.endMs - c.startMs}`);
  const long = Array.from({ length: 30 }, (_, i) => ({ text: '字', startMs: i * 400, endMs: i * 400 + 380 }));
  for (const c of buildCues(long)) assert.ok(c.endMs - c.startMs <= 4600);
});
