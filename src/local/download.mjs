/**
 * 大文件断点续传下载（本地模型 27 GB 这种量级）：写 .part、带 Range 续传、按字节报进度；
 * 完成后重命名。不校验 sha（HF 不提供稳定的 sha 头；靠大小 + 后续 sd-cli 加载失败兜底）。
 */
import fs from 'node:fs';
import path from 'node:path';

export async function downloadWithResume(url, dest, { onProgress = () => {}, fetchImpl = fetch, signal } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { onProgress({ done: true, skipped: true, bytes: fs.statSync(dest).size }); return dest; }
  const part = dest + '.part';
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const headers = { 'User-Agent': 'OpenShorts/2.0' }; if (have > 0) headers.Range = `bytes=${have}-`;
  const r = await fetchImpl(url, { headers, redirect: 'follow', signal });
  if (r.status === 416) { fs.renameSync(part, dest); onProgress({ done: true, bytes: have }); return dest; }
  if (!r.ok && r.status !== 206) throw new Error(`下载失败 HTTP ${r.status}：${url}`);
  if (r.status === 200 && have > 0) { have = 0; fs.rmSync(part, { force: true }); }   // 服务端不支持 Range，从头来
  const total = (r.status === 206 ? have : 0) + Number(r.headers.get('content-length') || 0);
  const out = fs.createWriteStream(part, { flags: r.status === 206 ? 'a' : 'w' });
  let bytes = have, last = Date.now();
  for await (const chunk of r.body) {
    out.write(chunk); bytes += chunk.length;
    if (Date.now() - last > 1000) { onProgress({ bytes, total }); last = Date.now(); }
  }
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  fs.renameSync(part, dest); onProgress({ done: true, bytes, total });
  return dest;
}

/** stable-diffusion.cpp 最新 Release 里对应本机平台的预编译包 */
export function pickSdcppAsset(assets, platform = process.platform, arch = process.arch, gpu = 'auto') {
  const names = assets.map((a) => a.name);
  const pick = (re) => { const n = names.find((x) => re.test(x)); return n ? assets.find((a) => a.name === n) : null; };
  if (platform === 'darwin') return pick(/Darwin.*arm64\.zip$/i) ?? pick(/Darwin.*\.zip$/i);
  if (platform === 'win32') return (gpu === 'cuda' && pick(/win-cuda12-x64\.zip$/i)) || pick(/win-vulkan-x64\.zip$/i) || pick(/win-cpu-x64\.zip$/i);
  return (gpu === 'cuda' && pick(/Linux.*cuda.*\.zip$/i)) || pick(/Linux.*vulkan\.zip$/i) || pick(/Linux.*x86_64\.zip$/i);
}
