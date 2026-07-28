import fs from 'node:fs/promises';
import path from 'node:path';

const fps = 30;
const root = process.cwd();
const story = JSON.parse(await fs.readFile(path.join(root, 'content/lychee-road/story.json'), 'utf8'));
const timingPath = path.join(root, 'public/audio/lychee-road/timings.json');
const timings = await fs.readFile(timingPath, 'utf8').then(JSON.parse).catch(() => null);
const fallback = [9, 10, 13, 6.5, 5.5, 10.5];
const A = 'assets/generated/lychee-road/';
const L = `${A}layers/`;
const base = (id, name, src, role, x, y, width, zIndex, entrance='none', delayFrames=0, extras={}) => ({id,name,src,role,x,y,width,zIndex,entrance,delayFrames,rotation:0,opacity:1,flipX:false,paperEdge:role!=='background',keyframes:[],...extras});
const bg = (sceneId, src) => base(`bg-${sceneId}`, '背景', `${A}${src}`, 'background', -140, -50, 1360, 0, 'none', 0, {paperEdge:false, keyframes:[{frame:0,x:-140,y:-50,width:1360,rotation:0,opacity:1,easing:'ease-in-out'},{frame:360,x:-185,y:-90,width:1460,rotation:0,opacity:1,easing:'ease-in-out'}]});
const splitCaptions = (text, frames) => {
  const bits = text.split(/(?<=[。？！；])/).filter(Boolean).flatMap((part) => part.length > 24 ? [part.slice(0, Math.ceil(part.length/2)), part.slice(Math.ceil(part.length/2))] : [part]);
  let cursor = 4;
  return bits.map((part, index) => {const available=frames-8; const share=index===bits.length-1?frames-4-cursor:Math.max(24,Math.round(available*part.length/text.length));const item={text:part,fromFrame:cursor,toFrame:Math.min(frames-2,cursor+share),words:[]};cursor=item.toFrame;return item;});
};
const durationFor = (i) => timings?.segments?.[i]?.duration ? timings.segments[i].duration + 0.55 : fallback[i];
const narrationFor = (i) => timings?.segments?.[i]?.file?.replace(/^public\//,'');
const audio = (src, fromFrame=0, volume=.5) => ({src:`audio/lychee-road/${src}`,fromFrame,volume});
const layerSets = [
  [bg('hook','storm-road.png'), base('basket-hook','一筐荔枝',`${A}lychee-basket.svg`,'primary',220,720,650,3,'scale',5), base('runner-hook','驿卒',`${L}courier-running.png`,'foreground',520,870,500,4,'right',18)],
  [bg('deadline','route-map.svg'), base('official','驿站官员',`${L}post-official.png`,'primary',615,890,430,3,'right',22), base('basket-deadline','荔枝',`${A}lychee-basket.svg`,'secondary',-30,1080,520,2,'left',8)],
  [bg('journey','storm-road.png'), base('horse','换马疾驰',`${L}relay-horse.png`,'primary',330,880,800,4,'right',5,{flipX:true}), base('runner-road','不歇的驿卒',`${L}courier-running.png`,'secondary',-60,980,470,3,'left',28)],
  [bg('arrival','palace-gate.svg'), base('kneel-arrive','跪献荔枝',`${L}courier-kneeling.png`,'primary',420,1020,480,4,'scale',12), base('basket-arrive','荔枝抵京',`${A}lychee-basket.svg`,'secondary',30,1110,520,3,'left',24)],
  [bg('cost','palace-gate.svg'), base('runner-cost','倒下的普通人',`${L}courier-running.png`,'primary',320,960,500,3,'fade',14,{rotation:82,opacity:.72}), base('official-cost','冷眼的命令',`${L}post-official.png`,'tertiary',690,920,360,2,'fade',30,{opacity:.52})],
  [bg('ending','route-map.svg'), base('kneel-end','无名驿卒',`${L}courier-kneeling.png`,'secondary',600,1100,430,3,'right',10,{opacity:.76}), base('basket-end','最后一颗荔枝',`${A}lychee-basket.svg`,'primary',120,710,680,4,'scale',26)],
];
const cues = [[audio('impact.wav',0,.8),audio('rain.wav',0,.28)],[audio('whoosh.wav',4,.5)],[audio('hoofbeats.wav',0,.78),audio('rain.wav',0,.18)],[audio('impact.wav',8,.65)],[audio('impact.wav',2,.5)],[audio('whoosh.wav',15,.42)]];
const scenes = story.segments.map((segment, i) => {
  const durationFrames=Math.ceil(durationFor(i)*fps); const narration=narrationFor(i);
  return {id:segment.id,name:`${i+1}. ${segment.purpose}`,durationFrames,backgroundColor:'#241b1b',cameraZoom:i===2?1.08:1.035,layers:layerSets[i],captions:splitCaptions(segment.text,durationFrames),...(narration?{narrationSrc:narration}:{}),audioCues:cues[i]};
});
const project={schemaVersion:1,id:'lychee-road',title:'三天荔枝道',width:1080,height:1920,fps,theme:{paper:'#f6eedb',ink:'#271c19',accent:'#efb84f',subtitleBackground:'rgba(53,14,16,.86)'},soundtrackSrc:'audio/lychee-road/original-underscore.wav',production:{plannerVersion:1,sourceText:story.segments.map(x=>x.text).join('\n'),style:{format:'9:16',look:'唐代古籍线描与复古纸片拼贴',disclaimer:'路线与时限存在史料争议，本片为史料启发的戏剧化表达'},characters:[{id:'courier',name:'无名驿卒',description:'承担不可能任务的普通人'},{id:'official',name:'驿站官员',description:'制度命令的具象化'}],assetPlan:[]},scenes};
await fs.mkdir(path.join(root,'projects'),{recursive:true});
await fs.writeFile(path.join(root,'projects/lychee-road.json'),`${JSON.stringify(project,null,2)}\n`);
console.log(`✓ 已构建《三天荔枝道》：${(scenes.reduce((n,s)=>n+s.durationFrames,0)/fps).toFixed(1)} 秒${timings?'，已挂载分段旁白':'，当前为配乐音效预览版'}`);
