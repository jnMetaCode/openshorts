/**
 * ffmpeg 的解析、能力探测与自助安装。
 *
 * 为什么需要这个文件：Homebrew 现在的 `ffmpeg` formula 已经不再依赖 libass / freetype / fontconfig
 * （`brew deps ffmpeg` 里没有它们），所以按 README 里那句 `brew install ffmpeg` 装出来的 ffmpeg
 * **没有 subtitles 滤镜也没有 drawtext**。后果不是"少个角标"这么轻：口播线找不到素材时会退纯色底，
 * 让字幕成为画面主体——字幕烧不进去，那一镜就是一块纯黑；而软字幕轨抖音/视频号上传时会被丢掉。
 * 也就是说免费路径的成片在 Mac 上默认是"没有字的"。
 *
 * 修法和本地出片模型一致：缺什么就地装什么。eugeneware/ffmpeg-static 的预编译单文件带
 * --enable-libass / --enable-libfreetype / --enable-fontconfig，覆盖 mac/win/linux 各架构，
 * 装到 ~/.openshorts/bin 下，只对开片生效，不动用户系统里的 ffmpeg。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { OPENSHORTS_HOME } from '../config.mjs';

const run = promisify(execFile);
const EXE = process.platform === 'win32' ? '.exe' : '';
/** 开片自己装的那份（不污染系统 PATH） */
export const MANAGED_DIR = path.join(OPENSHORTS_HOME, 'bin');
export const managedPath = (kind) => path.join(MANAGED_DIR, `${kind}${EXE}`);

/** 优先级：环境变量指定 > 开片自己装的 > PATH 里的 */
export function ffmpegPath() {
  const env = process.env.OPENSHORTS_FFMPEG || process.env.AO_FFMPEG;
  if (env) return env;
  const m = managedPath('ffmpeg');
  return fs.existsSync(m) ? m : 'ffmpeg';
}
export function ffprobePath() {
  const env = process.env.OPENSHORTS_FFPROBE || process.env.AO_FFPROBE;
  if (env) return env;
  const m = managedPath('ffprobe');
  if (fs.existsSync(m)) return m;
  const ff = ffmpegPath();
  return ff === 'ffmpeg' ? 'ffprobe' : ff.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
}

/** 这个 ffmpeg 能干什么。bin 不传就用 ffmpegPath()。 */
export async function ffmpegCaps(bin = ffmpegPath()) {
  try {
    const r = await run(bin, ['-hide_banner', '-filters'], { maxBuffer: 8 << 20 });
    const set = new Set(String(r.stdout).split('\n').map((l) => l.trim().split(/\s+/)[1]).filter(Boolean));
    let version = '';
    try { version = String((await run(bin, ['-version'])).stdout).split('\n')[0].replace(/^ffmpeg version /, '').split(' ')[0]; } catch { /* 版本拿不到不影响判断 */ }
    return { bin, found: true, version, subtitles: set.has('subtitles'), drawtext: set.has('drawtext'), ebur128: set.has('ebur128'), managed: bin === managedPath('ffmpeg') };
  } catch {
    return { bin, found: false, version: '', subtitles: false, drawtext: false, ebur128: false, managed: false };
  }
}

/** 成片能不能"有字"——这是口播线真正的及格线，不是可选项 */
export const canBurnCaptions = (caps) => !!caps?.subtitles;

// ───────────── 安装 ─────────────

const FALLBACK_TAG = 'b6.1.1';   // API 拿不到 latest 时用这个已验证过的版本
const REPO = 'eugeneware/ffmpeg-static';

/** 本机对应的资源名（ffmpeg-static 的命名规则） */
export function ffmpegAssetName(kind = 'ffmpeg', platform = process.platform, arch = process.arch) {
  const os = platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win32' : 'linux';
  const cpu = arch === 'arm64' ? 'arm64' : arch === 'arm' ? 'arm' : arch === 'ia32' ? 'ia32' : 'x64';
  if (os === 'win32' && cpu !== 'x64') return null;          // 上游只出 win32-x64
  if (os === 'darwin' && !['arm64', 'x64'].includes(cpu)) return null;
  return `${kind}-${os}-${cpu}.gz`;
}

async function latestTag(fetchImpl = fetch, signal) {
  try {
    const r = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': 'OpenShorts/2.0' }, signal });
    if (!r.ok) return FALLBACK_TAG;
    return (await r.json()).tag_name || FALLBACK_TAG;
  } catch { return FALLBACK_TAG; }
}

/** 下载一个 .gz 单文件二进制并解压到 dest（写 .part 再改名，中断不会留下半截可执行文件） */
async function fetchGzBinary(url, dest, { fetchImpl = fetch, signal, onProgress = () => {} }) {
  const r = await fetchImpl(url, { headers: { 'User-Agent': 'OpenShorts/2.0' }, redirect: 'follow', signal });
  if (!r.ok) throw new Error(`下载失败 HTTP ${r.status}：${url}`);
  const total = Number(r.headers.get('content-length') || 0);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.${process.pid}.part`;
  let bytes = 0, last = 0;
  const counter = new (await import('node:stream')).Transform({
    transform(chunk, _e, cb) { bytes += chunk.length; if (Date.now() - last > 700) { onProgress({ bytes, total }); last = Date.now(); } cb(null, chunk); },
  });
  try {
    await pipeline(Readable.fromWeb(r.body), counter, zlib.createGunzip(), fs.createWriteStream(part));
    fs.renameSync(part, dest);
    onProgress({ bytes, total, done: true });
  } catch (e) { fs.rmSync(part, { force: true }); throw e; }
  return dest;
}

/**
 * 装一份带 libass 的 ffmpeg（和 ffprobe）到 ~/.openshorts/bin。
 * 装完当场验一遍 subtitles 滤镜在不在——装了但还是烧不了字，等于没装，要说出来。
 */
export async function installFfmpeg({ kinds = ['ffmpeg', 'ffprobe'], fetchImpl = fetch, signal, onLog = () => {}, onProgress = () => {} } = {}) {
  const names = kinds.map((k) => [k, ffmpegAssetName(k)]);
  const missing = names.filter(([, n]) => !n).map(([k]) => k);
  if (missing.length) throw new Error(`没有 ${process.platform}/${process.arch} 的预编译 ffmpeg，请自行安装带 libass 的构建后设 OPENSHORTS_FFMPEG`);
  const tag = await latestTag(fetchImpl, signal);
  fs.mkdirSync(MANAGED_DIR, { recursive: true });
  for (const [kind, name] of names) {
    const dest = managedPath(kind);
    onLog(`下载 ${name}（${tag}）`);
    await fetchGzBinary(`https://github.com/${REPO}/releases/download/${tag}/${name}`, dest, { fetchImpl, signal, onProgress: (p) => onProgress({ file: name, ...p }) });
    if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
    if (process.platform === 'darwin') { try { spawnSync('xattr', ['-cr', dest]); } catch { /* 没有隔离属性就算了 */ } }
    onLog(`${kind} 就绪：${dest}`);
  }
  const caps = await ffmpegCaps(managedPath('ffmpeg'));
  if (!caps.found) throw new Error(`装完了但跑不起来：${managedPath('ffmpeg')}`);
  if (!caps.subtitles) throw new Error('装到的构建仍然没有 libass（subtitles 滤镜），字幕还是烧不进画面');
  onLog(`验证通过：ffmpeg ${caps.version} · 字幕可烧进画面 · AI 标识可叠加`);
  return caps;
}
