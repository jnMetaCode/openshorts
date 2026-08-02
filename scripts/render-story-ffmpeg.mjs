import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {subtitleBottomRatio, subtitleFontSize} from '../shared/captions.mjs';
import {AAC_ARGS, buildAudioGraph} from './lib/audio-master.mjs';
import {rotatedTopLeft} from './lib/layout.mjs';

const run=promisify(execFile);const root=process.cwd();
const projectPath=path.resolve(process.argv[2]??'projects/lychee-road.json');
const project=JSON.parse(await fs.readFile(projectPath,'utf8'));const temp=await fs.mkdtemp(path.join(os.tmpdir(),'papercut-story-'));const clips=[];let absoluteFrame=0;const subtitles=[];let subIndex=1;
const publicFile=(src)=>path.join(root,'public',src.replace(/^\//,''));
const stamp=(frame)=>{const sec=frame/project.fps;const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=Math.floor(sec%60),ms=Math.round((sec-Math.floor(sec))*1000);return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;};

// 字幕字体按平台探测：macOS 用 PingFang，Docker/Linux 用 fonts-noto-cjk，其余可用环境变量覆盖。
const FONT_CANDIDATES=[process.env.PAPERCUT_SUBTITLE_FONT,'/System/Library/Fonts/PingFang.ttc','/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc','/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc','C:/Windows/Fonts/msyh.ttc'].filter(Boolean);
const font=await (async()=>{for(const file of FONT_CANDIDATES){if(await fs.access(file).then(()=>true).catch(()=>false))return file;}throw new Error(`找不到中文字体，请用 PAPERCUT_SUBTITLE_FONT 指向一个 CJK 字体文件。已尝试：${FONT_CANDIDATES.join('、')}`);})();
// 字幕排版与 Remotion 渲染器共用同一套尺寸与安全区规则，避免两条渲染路径不一致。
const MONO_CANDIDATES=[process.env.PAPERCUT_MONO_FONT,'/System/Library/Fonts/SFNSMono.ttf','/System/Library/Fonts/Menlo.ttc','/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf','/usr/share/fonts/opentype/noto/NotoSansMonoCJKsc-Regular.otf'].filter(Boolean);
const monoFont=await (async()=>{for(const f of MONO_CANDIDATES){if(await fs.access(f).then(()=>true).catch(()=>false))return f;}return font;})();
const fontSize=subtitleFontSize(project.width,project.height);
const captionWidth=Math.round(project.width*.86);
const captionHeight=Math.round(fontSize*2.9);
const captionMargin=Math.round(project.height*subtitleBottomRatio(project.width,project.height));

// ImageMagick 没有 librsvg 时会退回自带的 MSVG 渲染器，它会丢掉 stroke——
// 描边画的自行车、箭头、划线会整条消失。Remotion 走 Chrome，不受影响。
const usesSvg=project.scenes.some(s=>s.layers.some(l=>l.src&&/\.svgz?$/i.test(l.src)));
if(usesSvg){
  const {stdout}=await run('magick',['-list','delegate']).catch(()=>({stdout:''}));
  if(!/rsvg-convert/.test(stdout)) console.warn('! 未检测到 librsvg，ImageMagick 将用内置 MSVG 渲染 SVG，描边可能丢失。\n  修复：brew install librsvg（或 apt install librsvg2-bin）。正式渲染走 Remotion 不受影响。');
}

const identify=async(file)=>{const {stdout}=await run('magick',['identify','-format','%w %h',file]);const [w,h]=stdout.trim().split(' ').map(Number);return {width:w,height:h};};

for(const [sceneIndex,scene] of project.scenes.entries()){
  const canvas=path.join(temp,`scene-${sceneIndex}.png`);const ordered=[...scene.layers].sort((a,b)=>a.zIndex-b.zIndex);const background=ordered.find(x=>x.role==='background'&&x.kind!=='text')??ordered.find(x=>x.kind!=='text');
  if(background)await run('magick',[publicFile(background.src),'-resize',`${project.width}x${project.height}^`,'-gravity','center','-extent',`${project.width}x${project.height}`,canvas]);else await run('magick',['-size',`${project.width}x${project.height}`,`xc:${scene.backgroundColor??'#000'}`,canvas]);
  for(const [layerIndex,layer] of ordered.filter(x=>x!==background).entries()){
    const sprite=path.join(temp,`sprite-${sceneIndex}-${layerIndex}.png`);
    if(layer.kind==='text'){
      // 文字图层用 ImageMagick 排版。降级路径不做逐行显现，整块一次画出——
      // 位置和字号与 Remotion 一致，只是没有动画。
      const st=layer.style;const pad=Math.round(st.padding??0);
      const args=['-background',st.background??'none','-fill',st.color??project.theme?.paper??'#f6eedb','-font',st.mono?monoFont:font,
        '-pointsize',String(Math.round(st.fontSize)),'-interline-spacing',String(Math.round(st.fontSize*((st.lineHeight??1.28)-1))),
        '-gravity',st.align==='center'?'center':st.align==='right'?'east':'west',
        '-size',`${Math.max(1,Math.round(layer.width)-pad*2)}x`,`caption:${st.text}`];
      if(pad)args.push('-bordercolor',st.background??'none','-border',String(pad));
      if(layer.opacity!=null&&layer.opacity<1)args.push('-channel','A','-evaluate','multiply',String(layer.opacity),'+channel');
      args.push(sprite);await run('magick',args);
    } else if(layer.kind==='video'){
      // 降级路径不播视频：取 startFrom 处的海报帧当静态图，与「不保证运动」的定位一致
      const poster=path.join(temp,`poster-${sceneIndex}-${layerIndex}.png`);
      await run('ffmpeg',['-y','-v','error','-ss',String(layer.startFrom??0),'-i',publicFile(layer.src),'-frames:v','1',poster]);
      const args=[poster,'-resize',`${Math.round(layer.width)}x`];
      if(layer.opacity!=null&&layer.opacity<1)args.push('-channel','A','-evaluate','multiply',String(layer.opacity),'+channel');
      args.push(sprite);await run('magick',args);
    } else {
      const args=['-background','none',publicFile(layer.src),'-resize',`${Math.round(layer.width)}x`];if(layer.flipX)args.push('-flop');if(layer.opacity!=null&&layer.opacity<1)args.push('-channel','A','-evaluate','multiply',String(layer.opacity),'+channel');args.push(sprite);await run('magick',args);
    }
    const flat=await identify(sprite);
    if(layer.rotation)await run('magick',[sprite,'-background','none','-rotate',String(layer.rotation),sprite]);
    // ImageMagick 绕素材中心旋转并撑大画布，Remotion 绕底边中点旋转；换算贴图偏移让两者落点一致。
    const {x,y}=rotatedTopLeft({layer,flat,rotated:layer.rotation?await identify(sprite):flat});
    const composed=path.join(temp,`composed-${sceneIndex}-${layerIndex}.png`);await run('magick',[canvas,sprite,'-geometry',`+${x}+${y}`,'-compose','over','-composite',composed]);await fs.copyFile(composed,canvas);
  }
  const captionCards=[];for(const [captionIndex,caption] of scene.captions.entries()){const card=path.join(temp,`caption-${sceneIndex}-${captionIndex}.png`);await run('magick',['-background',project.theme?.subtitleBackground??'rgba(53,14,16,0.88)','-fill','#f7f0df','-font',font,'-pointsize',String(fontSize),'-gravity','center','-size',`${captionWidth}x${captionHeight}`,`caption:${caption.text}`,card]);captionCards.push({card,caption});}
  const clip=path.join(temp,`clip-${sceneIndex}.mp4`);const zoomEnd=scene.cameraZoom??1.035;const clipArgs=['-y','-v','error','-loop','1','-i',canvas];for(const {card} of captionCards)clipArgs.push('-loop','1','-i',card);const filters=[`[0:v]zoompan=z='min(zoom+${((zoomEnd-1)/scene.durationFrames).toFixed(7)},${zoomEnd})':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${scene.durationFrames}:s=${project.width}x${project.height}:fps=${project.fps}[zoomed]`];let previous='zoomed';for(const [captionIndex,{caption}] of captionCards.entries()){const next=`captioned${captionIndex}`;filters.push(`[${previous}][${captionIndex+1}:v]overlay=(W-w)/2:H-h-${captionMargin}:enable='between(n,${caption.fromFrame},${caption.toFrame-1})'[${next}]`);previous=next;}filters.push(`[${previous}]format=yuv420p[video]`);clipArgs.push('-filter_complex',filters.join(';'),'-map','[video]','-frames:v',String(scene.durationFrames),'-c:v','libx264','-preset','veryfast','-crf','18',clip);await run('ffmpeg',clipArgs);clips.push(clip);
  for(const caption of scene.captions){subtitles.push(`${subIndex++}\n${stamp(absoluteFrame+caption.fromFrame)} --> ${stamp(absoluteFrame+caption.toFrame)}\n${caption.text}\n`);}absoluteFrame+=scene.durationFrames;
}
const concat=path.join(temp,'clips.txt');await fs.writeFile(concat,clips.map(x=>`file '${x.replaceAll("'","'\\''")}'`).join('\n'));const silent=path.join(temp,'silent.mp4');await run('ffmpeg',['-y','-v','error','-f','concat','-safe','0','-i',concat,'-c','copy',silent]);
const subtitled=silent;
const total=absoluteFrame/project.fps;
// 音轨与 Remotion 路径共用 buildAudioGraph，两个渲染器的声音完全一致。
const {sources,filters,outLabel}=buildAudioGraph({project,totalSeconds:total});
const ffargs=['-y','-v','error','-i',subtitled];for(const src of sources)ffargs.push('-i',publicFile(src));
const output=path.join(root,'out',`${project.id}.mp4`);await fs.mkdir(path.dirname(output),{recursive:true});
if(outLabel)ffargs.push('-filter_complex',filters.join(';'),'-map','0:v','-map',outLabel,'-c:v','copy',...AAC_ARGS,'-t',total.toFixed(3),'-movflags','+faststart',output);
else ffargs.push('-map','0:v','-c:v','copy','-t',total.toFixed(3),'-movflags','+faststart',output);
await run('ffmpeg',ffargs,{maxBuffer:20*1024*1024});
console.log(`✓ FFmpeg 无服务器渲染完成：${output}`);console.log(`  ${project.width}×${project.height} · ${project.fps} FPS · ${total.toFixed(1)} 秒 · 配乐/音效/烧录字幕`);
