import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

// 界面走的逐镜首帧：同一个任务里先后两段引擎 + 中间三次云端合成，进度要推给界面，失败原因要透出来
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'os-kfapi-'));
process.env.OPENSHORTS_HOME = path.join(home, '.openshorts');
process.env.AO_DATA_DIR = path.join(home, '.ao');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 5, 0x40, 0, 0, 3, 0]);
const SCRIPT = '## 主角\nx\n## 镜头 1（建立）\n他收伞\n## 镜头 2（冲突）\n他捡起收音机\n## 镜头 3（收束）\n他愣住';

const hits = [];
const provider = await new Promise((ok) => { const s = http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { hits.push(JSON.parse(b)); r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] })); }); }); s.listen(0, '127.0.0.1', () => ok(s)); });
process.env.AGNES_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
process.env.AGNES_API_KEY = 'k';

const ao = path.join(home, 'ao'); fs.mkdirSync(path.join(ao, 'dist'), { recursive: true }); fs.mkdirSync(path.join(ao, 'workflows'), { recursive: true });
fs.writeFileSync(path.join(ao, 'package.json'), '{"name":"stub","version":"0.0.0"}');
fs.copyFileSync(path.join(root, 'node_modules', 'agency-orchestrator', 'workflows', '短剧流水线.yaml'), path.join(ao, 'workflows', '短剧流水线.yaml'));
const calls = path.join(home, 'calls.jsonl');
// 第一次：在 --output 下造第一段运行目录（带剧本）；第二次：记参数后以 1 退出，带一句像样的报错
fs.writeFileSync(path.join(ao, 'dist', 'cli.js'), `const fs=require('fs'),p=require('path');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(a)+'\\n');
const n=fs.readFileSync(${JSON.stringify(calls)},'utf-8').trim().split('\\n').length;
if(n===1){const d=p.join(a[a.indexOf('--output')+1],'runA');fs.mkdirSync(p.join(d,'steps'),{recursive:true});fs.mkdirSync(p.join(d,'assets'));
fs.writeFileSync(p.join(d,'steps','1-script.md'),'> x\\n\\n---\\n\\n'+${JSON.stringify(SCRIPT)});
const m=JSON.parse(fs.readFileSync(p.join(a[a.indexOf('--resume')+1],'metadata.json'),'utf-8'));fs.writeFileSync(p.join(d,'metadata.json'),JSON.stringify(m));
console.log('── [1/17] ✍️ 编剧 (script) ──');console.log('  详细输出: '+d);}
else{console.log('❌ shot1: 测试桩：出片失败');process.exit(1);}`);
process.env.OPENSHORTS_AO_DIR = ao;

const express = (await import('express')).default;
const { kaipian } = await import('../server/kaipian.mjs');
const { writeConfig } = await import('../src/config.mjs');
const cards = await import('../src/characters/cards.mjs');
writeConfig({ outputDir: path.join(home, 'OpenShorts') });
const app = express(); app.use('/api/kaipian', express.json(), kaipian);
const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/kaipian`;
test.after(() => { server.close(); provider.close(); fs.rmSync(home, { recursive: true, force: true }); });

test('逐镜首帧：没卡 / 没供应商先 400；两段引擎 + 三次合成；第二段用派生工作流；失败原因透到界面', async () => {
  const c = cards.saveCard({ name: '阿杰', basics: '外卖骑手', face: '黑框眼镜' });
  const noPortrait = await fetch(`${base}/drama/run?story=x&tier=local&character=${c.id}&keyframes=1&edit_provider=agnes&edit_model=m`);
  assert.equal(noPortrait.status, 400);
  cards.setUploadedPortrait(c.id, PNG);
  const noProv = await fetch(`${base}/drama/run?story=x&tier=local&character=${c.id}&keyframes=1&lang=en`);
  assert.equal(noProv.status, 400); assert.match((await noProv.json()).error, /image-edit provider/);
  assert.equal(fs.existsSync(calls), false, '参数不全时一次引擎都不该起');

  const r = await fetch(`${base}/drama/run?story=${encodeURIComponent('避雨')}&tier=local&character=${c.id}&keyframes=1&edit_provider=agnes&edit_model=agnes-image-2.5-flash`);
  const sse = await r.text();
  const runs = fs.readFileSync(calls, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(runs.length, 2);
  assert.ok(runs[0][1].endsWith('短剧流水线.yaml')); assert.match(runs[1][1], /drama-keyframes-.*\.yaml$/);
  assert.ok(runs[0].includes('video_resolution=640x384') && runs[1].includes('video_resolution=640x384'));
  const seedB = runs[1][runs[1].indexOf('--resume') + 1];
  assert.ok(fs.existsSync(path.join(seedB, 'assets', 'shot3_keyframe.png')));
  assert.equal(hits.length, 3); assert.ok(hits[1].prompt.includes('他捡起收音机'));
  assert.match(sse, /逐镜首帧 ①/); assert.match(sse, /shot2 首帧/); assert.match(sse, /逐镜首帧 ②/);
  assert.match(sse, /event: error[\s\S]*测试桩：出片失败/, '第二段的失败原因要到界面，不能只剩"退出码 1"');
});
