import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const output=path.join(root,'out','releases');const cache=path.join(root,'data','npm-cache');await fs.mkdir(output,{recursive:true});await fs.mkdir(cache,{recursive:true});
execFileSync('npm',['pack','--pack-destination',output],{cwd:root,stdio:'inherit',env:{...process.env,npm_config_cache:cache}});
console.log(`✓ 发布包目录：${output}`);
