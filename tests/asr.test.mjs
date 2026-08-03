import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTranscript, runAsr, transcriptToCaptions} from '../server/lib/asr.mjs';

test('没有逐字结果时按中文字符分配时间', () => {
  const transcript = normalizeTranscript({language:'zh',segments:[{text:'长安城',start:0,end:1.5}]});
  assert.equal(transcript.segments[0].words.length,3); assert.equal(transcript.segments[0].words[2].end,1.5);
});

test('转写结果可转换为帧级字幕', () => {
  const transcript = normalizeTranscript({segments:[{text:'宫门开启',start:.5,end:2}]}); const captions = transcriptToCaptions(transcript,30,90);
  assert.equal(captions[0].fromFrame,15); assert.equal(captions[0].toFrame,60); assert.ok(captions[0].words.every((item) => item.toFrame > item.fromFrame));
});

test('本地 ASR 适配器使用无 shell 命令参数', async () => {
  const runner = async (command,args) => {assert.equal(command,'mock-asr');assert.equal(args.at(-1),'/tmp/voice.wav');return {stdout:JSON.stringify({segments:[{text:'完成',start:0,end:1}]})};};
  const result = await runAsr({audioPath:'/tmp/voice.wav',env:{OPENSHORTS_ASR_COMMAND:'mock-asr',OPENSHORTS_ASR_ARGS_JSON:'["--json"]'},runner}); assert.equal(result.segments[0].text,'完成');
});
