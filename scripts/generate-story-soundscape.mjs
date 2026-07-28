import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const out = path.resolve(process.argv[2] ?? 'public/audio/lychee-road');
await fs.mkdir(out, {recursive: true});
const ff = async (name, args) => run('ffmpeg', ['-y', '-v', 'error', ...args, path.join(out, name)]);

await ff('original-underscore.wav', ['-f','lavfi','-i','aevalsrc=(0.070*sin(2*PI*196*t)+0.052*sin(2*PI*293.66*t)+0.036*sin(2*PI*392*t))*(0.72+0.28*sin(2*PI*0.12*t))+0.055*sin(2*PI*523.25*t)*sin(2*PI*1.5*t)*sin(2*PI*1.5*t)*sin(2*PI*1.5*t)*sin(2*PI*1.5*t):s=48000:d=58','-af','highpass=f=120,lowpass=f=6200,afade=t=in:st=0:d=1.2,afade=t=out:st=54:d=4,volume=1.6','-ac','2']);
await ff('impact.wav', ['-f','lavfi','-i','aevalsrc=(0.45*sin(2*PI*(72-42*t)*t)+0.18*random(3))*exp(-6*t):s=48000:d=1.1','-af','lowpass=f=900,volume=0.85','-ac','2']);
await ff('hoofbeats.wav', ['-f','lavfi','-i','aevalsrc=0.34*sin(2*PI*82*t)*sin(2*PI*2.325*t)*sin(2*PI*2.325*t)*sin(2*PI*2.325*t)*sin(2*PI*2.325*t)*sin(2*PI*2.325*t)*sin(2*PI*2.325*t):s=48000:d=4.3','-af','lowpass=f=650,aecho=0.8:0.35:110:0.25','-ac','2']);
await ff('whoosh.wav', ['-f','lavfi','-i','anoisesrc=color=pink:amplitude=0.32:d=1.4:s=48000','-af','highpass=f=250,lowpass=f=4800,afade=t=in:st=0:d=0.9,afade=t=out:st=0.9:d=0.5','-ac','2']);
await ff('rain.wav', ['-f','lavfi','-i','anoisesrc=color=pink:amplitude=.12:d=14:s=48000','-af','highpass=f=900,lowpass=f=6500,afade=t=in:st=0:d=1,afade=t=out:st=12:d=2','-ac','2']);
console.log(`✓ 原创配乐与 4 组音效已生成：${out}`);
