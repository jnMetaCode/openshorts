import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
// 生成结果与故事无关（纯合成、无随机），所以放在共享目录，各故事只保留自己的旁白。
// 以前每个故事目录都复制一份，两条故事就白占约 28MB，而且全都进了 git。
const out = path.resolve(process.argv[2] ?? 'public/audio/common');
const force = process.argv.includes('--force');
await fs.mkdir(out, {recursive: true});

const EXPECTED = ['original-underscore.wav', 'impact.wav', 'hoofbeats.wav', 'whoosh.wav', 'rain.wav'];
const present = await Promise.all(EXPECTED.map((name) => fs.access(path.join(out, name)).then(() => true).catch(() => false)));
if (!force && present.every(Boolean)) {
  console.log(`✓ 共享音效已存在，跳过生成：${out}（需要重建请加 --force）`);
  process.exit(0);
}

const ff = async (name, args) => run('ffmpeg', ['-y', '-v', 'error', ...args, path.join(out, name)]);

const writeMusic = async (file) => {
  const sampleRate=48000,duration=58,frames=sampleRate*duration,channels=2,data=Buffer.alloc(frames*channels*2);
  const melody=[293.66,329.63,369.99,440,493.88,440,369.99,329.63,293.66,369.99,440,493.88,587.33,493.88,440,369.99];
  const bass=[146.83,123.47,110,123.47]; const beat=.75; let peak=0;
  for(let i=0;i<frames;i++){
    const t=i/sampleRate,n=Math.floor(t/beat),local=t%beat,f=melody[n%melody.length],attack=Math.min(1,local/.035),release=Math.min(1,(beat-local)/.18),env=attack*release*Math.exp(-.72*local);
    const phrase=Math.min(1,t/1.2)*Math.min(1,(duration-t)/3.5);const pluck=.18*env*(Math.sin(2*Math.PI*f*t)+.28*Math.sin(2*Math.PI*f*2*t)+.10*Math.sin(2*Math.PI*f*3*t));
    const bf=bass[Math.floor(t/3)%bass.length],pad=.055*(Math.sin(2*Math.PI*bf*t)+.35*Math.sin(2*Math.PI*bf*2*t));const pulse=t%1.5,kick=.045*Math.sin(2*Math.PI*(82-22*pulse)*pulse)*Math.exp(-14*pulse);
    const left=phrase*(pad+kick+pluck*(n%2?.88:1)),right=phrase*(pad+kick+pluck*(n%2?1:.88));peak=Math.max(peak,Math.abs(left),Math.abs(right));data.writeInt16LE(Math.round(Math.max(-1,Math.min(1,left))*32767),i*4);data.writeInt16LE(Math.round(Math.max(-1,Math.min(1,right))*32767),i*4+2);
  }
  const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+data.length,4);header.write('WAVE',8);header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(channels,22);header.writeUInt32LE(sampleRate,24);header.writeUInt32LE(sampleRate*channels*2,28);header.writeUInt16LE(channels*2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);await fs.writeFile(file,Buffer.concat([header,data]));return peak;
};
const musicPeak=await writeMusic(path.join(out,'original-underscore.wav'));
await ff('impact.wav', ['-f','lavfi','-i','aevalsrc=0.42*sin(2*PI*(92-48*t)*t)*exp(-7*t):s=48000:d=1.1','-af','lowpass=f=700,volume=0.8','-ac','2']);
await ff('hoofbeats.wav', ['-f','lavfi','-i','aevalsrc=0.34*sin(2*PI*82*t)*sin(2*PI*2.325*t)*sin(2*PI*2.325*t)*sin(2*PI*2.325*t)*sin(2*PI*2.325*t)*sin(2*PI*2.325*t)*sin(2*PI*2.325*t):s=48000:d=4.3','-af','lowpass=f=650,aecho=0.8:0.35:110:0.25','-ac','2']);
await ff('whoosh.wav', ['-f','lavfi','-i','aevalsrc=0.16*sin(2*PI*(210+720*t)*t)*sin(PI*t/1.4):s=48000:d=1.4','-af','highpass=f=180,lowpass=f=2600,volume=0.65','-ac','2']);
await ff('rain.wav', ['-f','lavfi','-i','aevalsrc=0.025*sin(2*PI*1760*t)*sin(2*PI*3.1*t)*sin(2*PI*3.1*t):s=48000:d=14','-af','highpass=f=1200,lowpass=f=2600,afade=t=in:st=0:d=1,afade=t=out:st=12:d=2','-ac','2']);
console.log(`✓ 五声音阶旋律与无随机噪声音效已生成：${out}（音乐峰值 ${musicPeak.toFixed(3)}）`);
