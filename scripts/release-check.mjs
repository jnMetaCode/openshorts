import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const required=['LICENSE','README.md','CHANGELOG.md','SECURITY.md','CONTRIBUTING.md','CODE_OF_CONDUCT.md','Dockerfile','docker-compose.yml','.env.example','.github/workflows/ci.yml','.github/workflows/release.yml'];
const missing=[];for(const file of required) if(!await fs.access(path.join(root,file)).then(()=>true).catch(()=>false)) missing.push(file);
if(missing.length) throw new Error(`发布文件缺失：${missing.join(', ')}`);
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));const changelog=await fs.readFile(path.join(root,'CHANGELOG.md'),'utf8');
if(!changelog.includes(`## ${pkg.version}`)) throw new Error(`CHANGELOG 缺少 ${pkg.version}`);
const run=(command,args)=>execFileSync(command,args,{cwd:root,stdio:'inherit',env:process.env});
run('npm',['test']);run('npm',['run','build']);run('npm',['run','validate','--','projects/sample.json']);
try{run('docker',['compose','config','--quiet']);}catch(error){if(error?.code==='ENOENT') console.warn('! Docker CLI 未安装，跳过 Compose 解析');else throw error;}
console.log(`✓ OpenShorts ${pkg.version} 发布检查通过`);
