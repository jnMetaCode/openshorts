/**
 * 大文件断点续传下载（本地模型 27 GB 这种量级）：写 .part、带 Range 续传、按字节报进度；
 * 完成后重命名。
 *
 * 校验：HTTP 头里确实没有稳定的 sha，但 HuggingFace 的 LFS 指针文件（/raw/ 路径）带
 * 权威 sha256——传 expectedSha256 时下载完成后整文件校验，对不上就删掉重来，
 * 而不是让坏文件活到"sd-cli 加载失败"那一步（27 GB 下完才发现，报错还看不出是文件坏了）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export async function fileSha256(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((res, rej) => { const s = fs.createReadStream(file); s.on('data', (c) => hash.update(c)); s.on('end', res); s.on('error', rej); });
  return hash.digest('hex');
}

/** HF 下载链接 → 该文件 LFS 指针里的 sha256；拿不到（非 HF、小文件、断网）返回 null，不阻塞下载。
 *  自带 10s 超时：HF 被墙时连接常常是黑洞（既不通也不拒），CLI 那条路没有外部 signal，
 *  不设超时的话 install 会在打印任何东西之前就吊死。 */
export async function hfExpectedSha256(url, { fetchImpl = fetch, signal } = {}) {
  const m = String(url).match(/^https:\/\/huggingface\.co\/(.+?)\/resolve\/([^/]+)\/(.+?)(?:\?.*)?$/);
  if (!m) return null;
  try {
    const t = AbortSignal.timeout(10_000);
    const r = await fetchImpl(`https://huggingface.co/${m[1]}/raw/${m[2]}/${m[3]}`, { headers: { 'User-Agent': 'OpenShorts/2.0' }, signal: signal ? AbortSignal.any([signal, t]) : t });
    if (!r.ok) return null;
    return (await r.text()).slice(0, 500).match(/oid sha256:([0-9a-f]{64})/)?.[1] ?? null;
  } catch { return null; }
}

async function verifyOrThrow(dest, expected, onProgress) {
  if (!expected) return;
  onProgress({ verifying: true });
  const got = await fileSha256(dest);
  if (got !== expected) { fs.rmSync(dest, { force: true }); throw new Error(`下载的文件校验不过（sha256 ${got.slice(0, 12)}… ≠ 官方 ${expected.slice(0, 12)}…），已删除——多半是传输中断或镜像出错，重跑一次会重新下`); }
}

export async function downloadWithResume(url, dest, { onProgress = () => {}, fetchImpl = fetch, signal, expectedSha256 = null } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    // 已存在的文件也要过校验（install 是低频动作，哈希这一分钟值得花）：
    // 老版本下的、或落盘后坏掉的文件，不校验就正好活到"sd-cli 加载失败"——这是本功能要防的原案。
    // 对不上不抛错：当场删掉、落回下面的正常下载，一条命令内自愈。
    if (expectedSha256) {
      onProgress({ verifying: true });
      if (await fileSha256(dest) === expectedSha256) { onProgress({ done: true, skipped: true, bytes: fs.statSync(dest).size }); return dest; }
      fs.rmSync(dest, { force: true });
    } else { onProgress({ done: true, skipped: true, bytes: fs.statSync(dest).size }); return dest; }
  }
  const part = dest + '.part';
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const headers = { 'User-Agent': 'OpenShorts/2.0' }; if (have > 0) headers.Range = `bytes=${have}-`;
  const r = await fetchImpl(url, { headers, redirect: 'follow', signal });
  if (r.status === 416) { fs.renameSync(part, dest); await verifyOrThrow(dest, expectedSha256, onProgress); onProgress({ done: true, bytes: have }); return dest; }
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
  fs.renameSync(part, dest);
  await verifyOrThrow(dest, expectedSha256, onProgress);
  onProgress({ done: true, bytes, total });
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
