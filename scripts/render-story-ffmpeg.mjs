import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);const root=process.cwd();
const projectPath=path.resolve(process.argv[2]??'projects/lychee-road.json');
const project=JSON.parse(await fs.readFile(projectPath,'utf8'));const temp=await fs.mkdtemp(path.join(os.tmpdir(),'papercut-story-'));const clips=[];let absoluteFrame=0;const subtitles=[];let subIndex=1;
const publicFile=(src)=>path.join(root,'public',src.replace(/^\//,''));
const stamp=(frame)=>{const sec=frame/project.fps;const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=Math.floor(sec%60),ms=Math.round((sec-Math.floor(sec))*1000);return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;};

for(const [sceneIndex,scene] of project.scenes.entries()){
  const canvas=path.join(temp,`scene-${sceneIndex}.png`);const ordered=[...scene.layers].sort((a,b)=>a.zIndex-b.zIndex);const background=ordered.find(x=>x.role==='background')??ordered[0];
  await run('magick',[publicFile(background.src),'-resize',`${project.width}x${project.height}^`,'-gravity','center','-extent',`${project.width}x${project.height}`,canvas]);
  for(const [layerIndex,layer] of ordered.filter(x=>x!==background).entries()){
    const sprite=path.join(temp,`sprite-${sceneIndex}-${layerIndex}.png`);const args=['-background','none',publicFile(layer.src),'-resize',`${Math.round(layer.width)}x`];if(layer.flipX)args.push('-flop');if(layer.rotation)args.push('-background','none','-rotate',String(layer.rotation));args.push(sprite);await run('magick',args);
    const composed=path.join(temp,`composed-${sceneIndex}-${layerIndex}.png`);await run('magick',[canvas,sprite,'-geometry',`+${Math.round(layer.x)}+${Math.round(layer.y)}`,'-compose','over','-composite',composed]);await fs.copyFile(composed,canvas);
  }
  const captionCard=path.join(temp,`caption-${sceneIndex}.png`);const captionText=scene.captions.map(x=>x.text).join('\n');await run('magick',['-background','rgba(53,14,16,0.88)','-fill','#f7f0df','-font','/System/Library/Fonts/PingFang.ttc','-pointsize','48','-gravity','center','-size','920x320',`caption:${captionText}`,captionCard]);const captioned=path.join(temp,`captioned-${sceneIndex}.png`);await run('magick',[canvas,captionCard,'-gravity','south','-geometry','+0+95','-compose','over','-composite',captioned]);await fs.copyFile(captioned,canvas);
  const clip=path.join(temp,`clip-${sceneIndex}.mp4`);const zoomEnd=scene.cameraZoom??1.035;await run('ffmpeg',['-y','-v','error','-loop','1','-i',canvas,'-vf',`zoompan=z='min(zoom+${((zoomEnd-1)/scene.durationFrames).toFixed(7)},${zoomEnd})':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${scene.durationFrames}:s=${project.width}x${project.height}:fps=${project.fps},format=yuv420p`,'-frames:v',String(scene.durationFrames),'-c:v','libx264','-preset','veryfast','-crf','18',clip]);clips.push(clip);
  for(const caption of scene.captions){subtitles.push(`${subIndex++}\n${stamp(absoluteFrame+caption.fromFrame)} --> ${stamp(absoluteFrame+caption.toFrame)}\n${caption.text}\n`);}absoluteFrame+=scene.durationFrames;
}
const concat=path.join(temp,'clips.txt');await fs.writeFile(concat,clips.map(x=>`file '${x.replaceAll("'","'\\''")}'`).join('\n'));const silent=path.join(temp,'silent.mp4');await run('ffmpeg',['-y','-v','error','-f','concat','-safe','0','-i',concat,'-c','copy',silent]);
const subtitled=silent;
const audioInputs=[project.soundtrackSrc,...project.scenes.flatMap(scene=>[scene.narrationSrc,...(scene.audioCues??[]).map(c=>c.src)])];const unique=[...new Set(audioInputs.filter(Boolean))];const ffargs=['-y','-v','error','-i',subtitled];for(const src of unique)ffargs.push('-i',publicFile(src));const filters=[];const mix=[];const musicIndex=unique.indexOf(project.soundtrackSrc)+1;if(musicIndex>0){filters.push(`[${musicIndex}:a]volume=0.8[music]`);mix.push('[music]');}
let sceneStart=0,cueNo=0;for(const scene of project.scenes){if(scene.narrationSrc){const input=unique.indexOf(scene.narrationSrc)+1;const delay=Math.round(sceneStart/project.fps*1000);const label=`voice${cueNo++}`;filters.push(`[${input}:a]adelay=${delay}|${delay},volume=1.0[${label}]`);mix.push(`[${label}]`);}for(const cue of scene.audioCues??[]){const input=unique.indexOf(cue.src)+1;const delay=Math.round((sceneStart+cue.fromFrame)/project.fps*1000);const label=`cue${cueNo++}`;filters.push(`[${input}:a]adelay=${delay}|${delay},volume=${cue.volume}[${label}]`);mix.push(`[${label}]`);}sceneStart+=scene.durationFrames;}
const total=absoluteFrame/project.fps;filters.push(`${mix.join('')}amix=inputs=${mix.length}:duration=longest:normalize=0,atrim=0:${total.toFixed(3)},loudnorm=I=-18:LRA=9:TP=-1.5[a]`);const output=path.join(root,'out',`${project.id}.mp4`);await fs.mkdir(path.dirname(output),{recursive:true});ffargs.push('-filter_complex',filters.join(';'),'-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t',total.toFixed(3),'-movflags','+faststart',output);await run('ffmpeg',ffargs,{maxBuffer:20*1024*1024});
console.log(`✓ FFmpeg 无服务器渲染完成：${output}`);console.log(`  ${project.width}×${project.height} · ${project.fps} FPS · ${total.toFixed(1)} 秒 · 配乐/音效/烧录字幕`);
