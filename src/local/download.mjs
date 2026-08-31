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
  if (!r.ok && r.status !== 206) {
    // 401/403 在 HuggingFace 上基本都是"这个仓库要先登录并接受条款"（gated），
    // 而不是网络问题——直接说清楚，别让人对着一个裸状态码猜
    const gated = (r.status === 401 || r.status === 403) && /huggingface\.co/.test(String(url));
    throw new Error(gated
      ? `下载失败 HTTP ${r.status}：这个模型仓库需要登录并接受条款（gated），换一个未设门的镜像，或手动下好放进模型目录。${url}`
      : `下载失败 HTTP ${r.status}：${url}`);
  }
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

/**
 * 资源名里写着这个包是给哪个 macOS 编的：`sd-master-xxxx-bin-Darwin-macOS-26.5.2-arm64.zip`。
 * 不看这一段的话，会给 macOS 14 的用户装一个 macOS 26 的包——装"成功"、cliFound 为真，
 * 一跑就 `dyld: Symbol not found ... built for macOS 26.0 which is newer than running OS`。
 * 真机上就是这样：最新 release 只有 macOS 26.5.2 的包，而本机 14.7.4。
 */
export const assetMacOS = (name) => { const m = String(name).match(/macOS-(\d+)(?:\.(\d+))?/i); return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 100 : 0) : null; };

/** stable-diffusion.cpp Release 里对应本机平台的预编译包（macOS 还要版本跑得动） */
export function pickSdcppAsset(assets, platform = process.platform, arch = process.arch, gpu = 'auto', macOSVersion = null) {
  const names = assets.map((a) => a.name);
  const pick = (re) => { const n = names.find((x) => re.test(x)); return n ? assets.find((a) => a.name === n) : null; };
  if (platform === 'darwin') {
    const runs = (a) => { const v = assetMacOS(a.name); return !v || macOSVersion == null || v <= macOSVersion + 1e-9; };
    const ok = assets.filter((a) => /Darwin.*\.zip$/i.test(a.name) && runs(a));
    return ok.find((a) => /arm64\.zip$/i.test(a.name)) ?? ok[0] ?? null;
  }
  if (platform === 'win32') return (gpu === 'cuda' && pick(/win-cuda12-x64\.zip$/i)) || pick(/win-vulkan-x64\.zip$/i) || pick(/win-cpu-x64\.zip$/i);
  return (gpu === 'cuda' && pick(/Linux.*cuda.*\.zip$/i)) || pick(/Linux.*vulkan\.zip$/i) || pick(/Linux.*x86_64\.zip$/i);
}
