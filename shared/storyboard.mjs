const STYLE_PRESETS = {
  'tang-collage': {name: '唐风古籍拼贴', palette: '米白宣纸、朱砂红、鎏金、深墨', visual: '唐代服饰，古籍线描，复古纸片拼贴，白色剪纸描边，天然纸张纤维', background: '水墨山脉与唐代宫殿，撕纸边缘、印章和网点装饰'},
  'ink-paper': {name: '水墨纸片', palette: '米白、墨黑、灰青、少量朱红', visual: '中国水墨线描，手工剪纸轮廓，克制留白，纸张颗粒', background: '水墨远山与抽象建筑，宣纸肌理，淡墨层次'},
  'modern-paper': {name: '现代商业纸片', palette: '暖白、炭黑、品牌强调色', visual: '现代编辑设计，几何纸片拼贴，清晰轮廓，克制阴影', background: '抽象城市与数据图形，纸张纹理，简洁网格'},
};

export const listStylePresets = () => Object.entries(STYLE_PRESETS).map(([id, value]) => ({id, ...value}));

export const splitSentences = (text) => String(text ?? '').replace(/\r/g, '').split(/(?<=[。！？!?；;])|\n+/).map((item) => item.trim()).filter(Boolean);

export const groupSentences = (sentences, maxChars = 34) => {
  const groups = [];
  for (const sentence of sentences) {
    const current = groups.at(-1);
    if (current && `${current.join('')}${sentence}`.length <= maxChars) current.push(sentence);
    else groups.push([sentence]);
  }
  return groups;
};

export const estimateFrames = (text, fps = 30, charsPerSecond = 4.2) => {
  const speakingChars = String(text).replace(/[\s，。！？；、,.!?;:“”"'（）()—-]/g, '').length;
  const seconds = Math.max(3, Math.min(10, speakingChars / charsPerSecond + 0.8));
  return Math.ceil(seconds * fps);
};

export const parseCharacterBible = (value) => String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
  const [name, ...description] = line.split(/[：:]/);
  return {id: `character-${index + 1}`, name: name.trim(), description: description.join('：').trim() || '保持服饰、发型、年龄和面部特征在所有镜头中一致'};
});

const captionsFor = (sentences, durationFrames) => {
  const weights = sentences.map((sentence) => Math.max(1, sentence.length)); const total = weights.reduce((sum, weight) => sum + weight, 0); let cursor = 0;
  return sentences.map((text, index) => {const fromFrame = cursor; const toFrame = index === sentences.length - 1 ? durationFrames : Math.max(cursor + 1, Math.round(cursor + durationFrames * weights[index] / total)); cursor = toFrame; return {text, fromFrame, toFrame};});
};

const assetPrompts = ({scene, style, character}) => {
  const anchor = character ? `固定角色设定：${character.name}，${character.description}。所有镜头保持同一人物身份、年龄、发型、服装配色和面部特征。` : '主体角色在同一项目的所有镜头中保持外形、服饰和配色一致。';
  const common = `${style.visual}。主色：${style.palette}。完整构图，无文字，无水印。`;
  return [
    {id: `${scene.id}-background`, sceneId: scene.id, role: 'background', name: `${scene.title}背景底板`, prompt: `${scene.narration}。${style.background}。只生成环境，不要主要人物。${common}`, requirements: ['无主要人物', '覆盖完整画布', '边缘可延展']},
    {id: `${scene.id}-primary`, sceneId: scene.id, role: 'primary', name: `${scene.title}主体`, prompt: `${anchor}${scene.narration}。生成完整主体人物，全身不裁头、不裁手脚，正面或明确朝向，纯绿色背景。${common}`, requirements: ['完整全身', '纯色背景', '白色剪纸描边', '无场景']},
    {id: `${scene.id}-secondary`, sceneId: scene.id, role: 'secondary', name: `${scene.title}配角组`, prompt: `${anchor}${scene.narration}。生成两名叙事配角素材表，人物彼此不重叠，完整全身，纯绿色背景。${common}`, requirements: ['规则素材表', '人物不重叠', '明确朝向']},
    {id: `${scene.id}-foreground`, sceneId: scene.id, role: 'foreground', name: `${scene.title}前景装饰`, prompt: `${scene.narration}。生成撕纸、纸花、胶带或印章组成的横向前景装饰，透明或纯绿色背景。${common}`, requirements: ['横向构图', '适合遮挡画面底部', '无文字']},
  ];
};

export const buildStoryboard = ({title = '纸片故事', text, styleId = 'tang-collage', aspect = '16:9', fps = 30, characterBible = '', scenePlan, planner = 'rules'}) => {
  const style = STYLE_PRESETS[styleId] ?? STYLE_PRESETS['tang-collage']; const characters = parseCharacterBible(characterBible);
  const groups = Array.isArray(scenePlan) && scenePlan.length ? scenePlan.map((item) => [String(item.narration ?? '')]) : groupSentences(splitSentences(text)); if (!groups.length) throw new Error('请先输入文案');
  const shotTypes = ['wide', 'medium', 'close'];
  const scenes = groups.slice(0, 12).map((sentences, index) => {
    const planned = scenePlan?.[index]; const narration = sentences.join(''); const durationFrames = estimateFrames(narration, fps); const shotType = ['wide','medium','close'].includes(planned?.shotType) ? planned.shotType : shotTypes[index % shotTypes.length];
    const scene = {id: `scene-${String(index + 1).padStart(2, '0')}`, title: `镜头 ${String(index + 1).padStart(2, '0')}`, narration, durationFrames, shotType, purpose: planned?.purpose || (shotType === 'wide' ? '交代环境与规模' : shotType === 'close' ? '突出关键人物与情绪' : '推进人物关系与事件'), captions: captionsFor(sentences, durationFrames)};
    return {...scene, assets: assetPrompts({scene, style, character: characters[index % Math.max(1, characters.length)]})};
  });
  return {version: 2, planner, title, sourceText: text, style: {id: styleId, ...style}, aspect, fps, characters, scenes, totalFrames: scenes.reduce((sum, scene) => sum + scene.durationFrames, 0)};
};

const sceneLayers = (scene, width, height, index) => {
  const portrait = height > width; const close = scene.shotType === 'close';
  const layers = portrait ? [
    {id:`${scene.id}-bg`,name:'背景底板',src:index % 2 ? 'assets/sample/red-bg.svg':'assets/sample/tang-bg.svg',role:'background',x:-1167,y:0,width:3414,rotation:0,opacity:1,zIndex:0,delayFrames:0,entrance:'none',flipX:false,paperEdge:false},
    {id:`${scene.id}-rear`,name:'后排人物',src:'assets/sample/ministers.svg',role:'tertiary',x:610,y:970,width:440,rotation:1,opacity:.82,zIndex:2,delayFrames:30,entrance:'right',flipX:false,paperEdge:true},
    {id:`${scene.id}-primary`,name:'主体人物',src:close?'assets/sample/gift-bearer.svg':'assets/sample/emperor.svg',role:'primary',x:190,y:480,width:700,rotation:0,opacity:1,zIndex:5,delayFrames:4,entrance:'scale',flipX:false,paperEdge:true},
    {id:`${scene.id}-secondary`,name:'前排配角',src:'assets/sample/attendant.svg',role:'secondary',x:55,y:1050,width:350,rotation:-3,opacity:1,zIndex:6,delayFrames:18,entrance:'left',flipX:false,paperEdge:true},
    {id:`${scene.id}-fg`,name:'前景装饰',src:'assets/sample/foreground.svg',role:'foreground',x:-1167,y:1460,width:3414,rotation:0,opacity:1,zIndex:10,delayFrames:42,entrance:'down',flipX:false,paperEdge:false},
  ] : [
    {id:`${scene.id}-bg`,name:'背景底板',src:index % 2 ? 'assets/sample/red-bg.svg':'assets/sample/tang-bg.svg',role:'background',x:0,y:0,width:1920,rotation:0,opacity:1,zIndex:0,delayFrames:0,entrance:'none',flipX:false,paperEdge:false},
    {id:`${scene.id}-rear`,name:'后排人物',src:'assets/sample/ministers.svg',role:'tertiary',x:1320,y:525,width:450,rotation:1,opacity:.82,zIndex:2,delayFrames:30,entrance:'right',flipX:false,paperEdge:true},
    {id:`${scene.id}-primary`,name:'主体人物',src:close?'assets/sample/gift-bearer.svg':'assets/sample/emperor.svg',role:'primary',x:close?680:650,y:close?205:235,width:close?575:650,rotation:0,opacity:1,zIndex:5,delayFrames:4,entrance:'scale',flipX:false,paperEdge:true},
    {id:`${scene.id}-secondary`,name:'前排配角',src:'assets/sample/attendant.svg',role:'secondary',x:310,y:535,width:300,rotation:-2,opacity:1,zIndex:6,delayFrames:18,entrance:'left',flipX:false,paperEdge:true},
    {id:`${scene.id}-fg`,name:'前景装饰',src:'assets/sample/foreground.svg',role:'foreground',x:0,y:795,width:1920,rotation:0,opacity:1,zIndex:10,delayFrames:42,entrance:'down',flipX:false,paperEdge:false},
  ];
  return layers.map((layer) => {
    const keyframes = layer.role === 'background' ? [] : [
      {frame:Math.min(scene.durationFrames - 1,layer.delayFrames + 12),x:layer.x,y:layer.y,width:layer.width,rotation:layer.rotation,opacity:layer.opacity,easing:'ease-out'},
      {frame:scene.durationFrames - 1,x:layer.x,y:layer.y - (layer.role === 'primary' ? 8 : 4),width:layer.width * (layer.role === 'primary' ? 1.015 : 1),rotation:layer.rotation + (layer.role === 'foreground' ? .4 : 0),opacity:layer.opacity,easing:'ease-in-out'},
    ].filter((item,index,items) => index === 0 || item.frame !== items[0].frame);
    return {...layer, assetPlanId: `${scene.id}-${layer.role === 'tertiary' ? 'secondary' : layer.role === 'foreground' ? 'foreground' : layer.role}`, keyframes};
  });
};

export const createDraftProject = (storyboard, id) => {
  const portrait = storyboard.aspect === '9:16'; const width = portrait ? 1080 : 1920; const height = portrait ? 1920 : 1080;
  const createdAt = new Date().toISOString();
  const scenes = storyboard.scenes.map((scene, index) => ({id:scene.id,name:`${scene.title} · ${scene.purpose}`,durationFrames:scene.durationFrames,backgroundColor:index%2?'#9d3029':'#d9c6a3',cameraZoom:scene.shotType==='close'?1.055:1.025,layers:sceneLayers(scene,width,height,index),captions:scene.captions}));
  const assetPlan = storyboard.scenes.flatMap((scene) => scene.assets).map((asset) => ({...asset,src:scenes.flatMap((scene) => scene.layers).find((layer) => layer.assetPlanId === asset.id)?.src,status:'planned',promptVersions:[{id:'pv-001',prompt:asset.prompt,note:'初始分镜提示词',createdAt}],activePromptVersion:'pv-001',reviewHistory:[]}));
  return {schemaVersion: 1, id, title: storyboard.title, width, height, fps: storyboard.fps, theme: {paper:'#f5eedc',ink:'#201712',accent:'#a72d24',subtitleBackground:'rgba(31,20,15,.84)'}, production: {plannerVersion: 2, planner: storyboard.planner ?? 'rules', sourceText: storyboard.sourceText, style: storyboard.style, characters: storyboard.characters, assetPlan}, scenes};
};

export const storyboardMarkdown = (storyboard) => `# ${storyboard.title} · 分镜与素材需求单

- 风格：${storyboard.style.name}
- 画幅：${storyboard.aspect}
- 镜头：${storyboard.scenes.length}
- 预计时长：${(storyboard.totalFrames / storyboard.fps).toFixed(1)} 秒

## 角色一致性

${storyboard.characters.length ? storyboard.characters.map((item) => `- **${item.name}**：${item.description}`).join('\n') : '- 未指定角色；生成素材后应补充角色锚点。'}

${storyboard.scenes.map((scene) => `## ${scene.title} · ${scene.shotType}

旁白：${scene.narration}

目的：${scene.purpose} · ${(scene.durationFrames / storyboard.fps).toFixed(1)} 秒

${scene.assets.map((asset) => `### ${asset.name}\n\n${asset.prompt}\n\n验收：${asset.requirements.join('；')}`).join('\n\n')}`).join('\n\n')}
`;
