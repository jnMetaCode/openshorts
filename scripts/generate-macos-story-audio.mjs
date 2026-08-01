import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const run=promisify(execFile);
const args=Object.fromEntries(process.argv.slice(2).map((item)=>{const [key,...rest]=item.replace(/^--/,'').split('=');return [key,rest.join('=')||true];}));
if(!args.story||!args.output) throw new Error('用法：--story=content/story.json --output=public/audio/story [--provider=auto|macos|edge]');
const story=JSON.parse(await fs.readFile(path.resolve(String(args.story)),'utf8'));const output=path.resolve(String(args.output));const raw=path.join(output,'raw');await fs.rm(raw,{recursive:true,force:true});await fs.mkdir(raw,{recursive:true});
const provider=String(args.provider??'auto');const voice=String(args.voice??'zh-CN-YunjianNeural');const edgeRate=String(args.rate??'+6%');const edgePitch=String(args.pitch??'+0Hz');const timings=[];let cursor=0;const cacheDir=path.resolve('data/tts-cache',story.id);await fs.mkdir(cacheDir,{recursive:true});
const durationOf=async(file)=>{const stat=await fs.stat(file).catch(()=>null);if(!stat||stat.size<1000)return 0;const {stdout}=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',file]);return Number(JSON.parse(stdout).format?.duration)||0;};
// macOS 兜底用的是 0–1 的语速系数，和 edge 的百分比不是一回事；
// 以前两者共用 --rate，传 "+0%" 会让 macOS 分支拿到非法值。
const macos=async(text,wav)=>{if(process.platform!=='darwin')throw new Error('非 macOS');const cache=path.resolve('data/swift-cache');await fs.mkdir(cache,{recursive:true});await run('swift',['scripts/macos-tts.swift',text,wav,String(args['macos-rate']??0.48)],{env:{...process.env,SWIFT_MODULECACHE_PATH:cache,CLANG_MODULE_CACHE_PATH:cache}});};
const edge=async(text,wav,basename)=>{const mp3=path.join(raw,`${basename}.mp3`),vtt=path.join(raw,`${basename}.vtt`);await run('edge-tts',['--voice',voice,`--rate=${edgeRate}`,`--pitch=${edgePitch}`,'--text',text,'--write-media',mp3,'--write-subtitles',vtt]);await run('ffmpeg',['-y','-v','error','-i',mp3,'-af','loudnorm=I=-16:LRA=7:TP=-1.5','-ar','48000','-ac','1',wav]);};
for(const [index,segment] of story.segments.entries()){
  const basename=`${String(index+1).padStart(2,'0')}-${segment.id}`;const wav=path.join(output,`${basename}.wav`);const signature=createHash('sha256').update(JSON.stringify({text:segment.text,provider,voice,edgeRate,edgePitch})).digest('hex');const sigFile=path.join(cacheDir,`${basename}.txt`);let used='';const errors=[];
  if(await durationOf(wav)>.2&&await fs.readFile(sigFile,'utf8').catch(()=>null)===signature)used='cache';
  for(const candidate of used?[]:(provider==='auto'?['edge','macos']:[provider])){try{await fs.rm(wav,{force:true});await (candidate==='macos'?macos(segment.text,wav):edge(segment.text,wav,basename));if(await durationOf(wav)>.2){used=candidate;await fs.writeFile(sigFile,signature);break;}throw new Error('生成了空音频');}catch(error){errors.push(`${candidate}: ${error.message}`);await fs.rm(wav,{force:true});}}
  const duration=await durationOf(wav);if(!used||duration<=.2)throw new Error(`旁白 ${basename} 生成失败。不会输出静默成片。\n${errors.join('\n')}\n可在普通终端运行 npm run story -- lychee-road audio，或安装 edge-tts 后使用 --provider=edge。`);
  timings.push({...segment,index,file:path.relative(process.cwd(),wav),provider:used,start:cursor,end:cursor+duration,duration});cursor+=duration;
}
await fs.writeFile(path.join(output,'timings.json'),`${JSON.stringify({storyId:story.id,voice,rate:edgeRate,pitch:edgePitch,totalDuration:cursor,segments:timings},null,2)}\n`);
await fs.rm(raw,{recursive:true,force:true});console.log(`✓ 已生成 ${timings.length} 段有效旁白，共 ${cursor.toFixed(2)} 秒\n${path.join(output,'timings.json')}`);
