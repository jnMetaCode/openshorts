import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const host=process.env.HOST && process.env.HOST !== '0.0.0.0' ? process.env.HOST : '127.0.0.1';
const port=Number(process.env.PORT ?? 4174);const url=`http://${host}:${port}`;
const ready=async()=>fetch(`${url}/api/health`).then((response)=>response.ok).catch(()=>false);
const openBrowser=()=>{
  const command=process.platform==='darwin'?'open':process.platform==='win32'?'cmd':'xdg-open';
  const args=process.platform==='win32'?['/c','start','',url]:[url];
  spawn(command,args,{stdio:'ignore',detached:true}).unref();
};

if(await ready()){console.log(`✓ PaperCut Studio 已在运行：${url}`);openBrowser();process.exit(0);}
if(!await fs.access(path.join(root,'dist','index.html')).then(()=>true).catch(()=>false)){
  console.log('首次启动：正在构建网页…');const built=spawnSync('npm',['run','build'],{cwd:root,stdio:'inherit'});if(built.status!==0) process.exit(built.status ?? 1);
}
console.log(`正在启动 PaperCut Studio：${url}`);
const child=spawn(process.execPath,['server/index.mjs'],{cwd:root,stdio:'inherit',env:{...process.env,HOST:host,PORT:String(port)}});
let stopped=false;child.once('exit',(code)=>{stopped=true;if(code && code!==0) console.error(`服务启动失败，退出码 ${code}`);});
for(let attempt=0;attempt<40&&!stopped;attempt++){if(await ready()){console.log(`\n✓ 已打开：${url}\n保持本窗口运行，按 Ctrl+C 停止服务。`);openBrowser();break;}await new Promise((resolve)=>setTimeout(resolve,250));}
if(stopped) process.exit(child.exitCode ?? 1);
if(!await ready()&&!stopped){console.error(`无法访问 ${url}，请确认端口 ${port} 未被防火墙或其他程序占用。`);child.kill('SIGTERM');process.exit(1);}
const stop=()=>{if(!child.killed) child.kill('SIGTERM');};process.on('SIGINT',stop);process.on('SIGTERM',stop);
await new Promise((resolve)=>child.once('exit',resolve));
