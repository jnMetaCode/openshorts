import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);

const distributeWords = (text, start, end) => {
  const tokens = /\s/.test(text.trim()) ? text.trim().split(/\s+/) : [...text.trim()];
  const span = Math.max(.001,end-start); const total = tokens.reduce((sum,item) => sum + Math.max(1,item.length),0); let cursor = start;
  return tokens.map((token,index) => {const next = index === tokens.length-1 ? end : cursor + span * Math.max(1,token.length) / total; const word = {text:token,start:cursor,end:next}; cursor=next; return word;});
};

export const normalizeTranscript = (data) => {
  const raw = Array.isArray(data) ? data : data?.segments; if (!Array.isArray(raw)) throw new Error('ASR 输出必须包含 segments 数组');
  const segments = raw.map((item) => {
    const text = String(item.text ?? '').trim(); const start = Math.max(0,Number(item.start ?? 0)); const end = Math.max(start+.01,Number(item.end ?? start+.01));
    const words = Array.isArray(item.words) && item.words.length ? item.words.map((word) => ({text:String(word.text ?? word.word ?? '').trim(),start:Number(word.start),end:Number(word.end)})) : distributeWords(text,start,end);
    return {text,start,end,words:words.filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end))};
  }).filter((item) => item.text);
  return {language:String(data?.language ?? 'zh'),segments,duration:segments.at(-1)?.end ?? 0};
};

export const transcriptToCaptions = (transcript, fps, maxFrames) => transcript.segments.map((segment) => {
  const fromFrame = Math.max(0,Math.min(maxFrames-1,Math.floor(segment.start*fps))); const toFrame = Math.max(fromFrame+1,Math.min(maxFrames,Math.ceil(segment.end*fps)));
  return {text:segment.text,fromFrame,toFrame,words:segment.words.map((word) => ({text:word.text,fromFrame:Math.max(fromFrame,Math.floor(word.start*fps)),toFrame:Math.min(toFrame,Math.max(fromFrame+1,Math.ceil(word.end*fps))) }))};
});

export const runAsr = async ({audioPath,env=process.env,runner=exec}) => {
  if (!env.PAPERCUT_ASR_COMMAND) throw new Error('未设置 PAPERCUT_ASR_COMMAND');
  let extra=[]; try {extra=JSON.parse(env.PAPERCUT_ASR_ARGS_JSON ?? '[]');} catch {throw new Error('PAPERCUT_ASR_ARGS_JSON 必须是 JSON 数组');}
  const {stdout} = await runner(env.PAPERCUT_ASR_COMMAND,[...extra,audioPath],{maxBuffer:20*1024*1024});
  return normalizeTranscript(JSON.parse(String(stdout)));
};
