import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';

const exists=async(file)=>fs.access(file).then(()=>true).catch(()=>false);
const pythonCandidates=[process.env.PAPERCUT_KOKORO_PYTHON,path.resolve('.venv/bin/python'),'/Users/yx/work/ai-tools/开源项目翻译优化/.demo-venv312/bin/python'].filter(Boolean);
const modelCandidates=[process.env.PAPERCUT_KOKORO_MODEL_DIR,path.resolve('models/Kokoro-82M'),'/Users/yx/.cache/huggingface/opentone_modelscope/hexgrad/Kokoro-82M'].filter(Boolean);
const python=(await Promise.all(pythonCandidates.map(async file=>await exists(file)?file:null))).find(Boolean);
const modelDir=(await Promise.all(modelCandidates.map(async dir=>await exists(path.join(dir,'kokoro-v1_0.pth'))?dir:null))).find(Boolean);
if(!python||!modelDir)throw new Error('未找到 Kokoro Python 环境或模型。设置 PAPERCUT_KOKORO_PYTHON 与 PAPERCUT_KOKORO_MODEL_DIR 后重试。');
const child=execFile(python,['scripts/generate-kokoro-story.py','--story','content/lychee-road/story.json','--output','public/audio/lychee-road','--model-dir',modelDir],{cwd:process.cwd()});
child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
await new Promise((resolve,reject)=>child.once('exit',code=>code===0?resolve():reject(new Error(`Kokoro 退出码 ${code}`))).once('error',reject));
console.log('✓ 本地 Kokoro 旁白已生成；正在按真实语音时长重建工程');
