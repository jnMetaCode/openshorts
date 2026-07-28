import test from 'node:test';
import assert from 'node:assert/strict';
import {renderWaveform} from '../scripts/lib/audio.mjs';

test('波形生成使用确定尺寸且不经过 shell', async()=>{let call;const run=async(command,args)=>{call={command,args};};await renderWaveform({input:'/tmp/a.wav',output:'/tmp/a.png',width:800,height:100,run});assert.equal(call.command,'ffmpeg');assert.ok(call.args.includes('showwavespic=s=800x100:colors=#b58a3d'));assert.equal(call.args.at(-1),'/tmp/a.png');});
