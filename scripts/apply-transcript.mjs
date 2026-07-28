import fs from 'node:fs/promises';
import path from 'node:path';
import {normalizeTranscript,transcriptToCaptions} from '../server/lib/asr.mjs';
import {retimeScene} from '../shared/review.mjs';

const args=Object.fromEntries(process.argv.slice(2).map((item)=>{const [key,...rest]=item.replace(/^--/,'').split('=');return [key,rest.join('=')||true];}));
if(!args.project||!args.transcript) throw new Error('用法：--project=项目.json --transcript=转写.json [--scene=scene-01]');
const projectFile=path.resolve(String(args.project));const project=JSON.parse(await fs.readFile(projectFile,'utf8'));const transcript=normalizeTranscript(JSON.parse(await fs.readFile(path.resolve(String(args.transcript)),'utf8')));
const index=args.scene?project.scenes.findIndex((item)=>item.id===args.scene):0;if(index<0) throw new Error(`镜头不存在：${args.scene}`);
const durationFrames=Math.max(1,Math.ceil((transcript.duration+.2)*project.fps));project.scenes[index]=retimeScene(project.scenes[index],durationFrames);project.scenes[index].captions=transcriptToCaptions(transcript,project.fps,durationFrames);
await fs.writeFile(projectFile,`${JSON.stringify(project,null,2)}\n`);console.log(`✓ 已向 ${project.scenes[index].id} 写入 ${project.scenes[index].captions.length} 段逐字字幕`);
