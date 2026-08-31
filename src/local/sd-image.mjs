/**
 * 本地文生图（stable-diffusion.cpp 的 `-M img_gen`）。
 *
 * 为什么口播线要的是"本地出图"而不是"本地出视频"：
 * H3 出视频每镜 3–4 分钟、模型 27 GB，一条 6 镜的口播要 20 分钟以上；而口播真正缺画面的地方，
 * 是"狭小空间让它感到安全"这类抽象句——素材库里本来就没有对应画面，现在这些镜头会退成纯色底
 * （案例里 6 镜退了 2 镜）。本地出图几秒到几十秒一张，只对退化的那一两镜付出，
 * 而且出来的就是一张图，直接走已有的图片渲染路径（完整图居中 + 虚化垫底 + 缓推），不必新开链路。
 *
 * 模型选 FLUX.1-schnell：**Apache-2.0**，可商用。这一条是硬要求——用户是要把片子发到平台上的，
 * 而 SDXL-Turbo 和 FLUX.1-dev 都是非商用许可，不能给他们埋雷。
 * 文本编码器（T5-XXL GGUF）同样 Apache-2.0，clip_l 是 MIT。
 *
 * 二进制复用装 H3 时那份 sd-cli，模型也放同一个目录，不重复下载、不另立门户。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { downloadWithResume } from './download.mjs';
import { OPENSHORTS_HOME } from '../config.mjs';

const HF = 'https://huggingface.co';
const CLIP_L = ['clip_l.safetensors', `${HF}/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors`];
// VAE 不从 black-forest-labs/FLUX.1-schnell 拿：那个仓库是 gated 的，未登录下载直接 401
// （许可证是 Apache-2.0，但 HF 上仍然要求先登录并接受条款）——对"免 key 免登录"的路线是硬伤。
// second-state 的 GGUF 仓库未设门、同为 Apache-2.0，文件一模一样。
const AE = ['ae.safetensors', `${HF}/second-state/FLUX.1-schnell-GGUF/resolve/main/ae.safetensors`];

/** 档位。sizeGB 是四个文件加起来的下载量，minMemGB 是跑得动的最低内存。 */
export const SD_IMAGE_MODELS = [
  {
    id: 'flux-schnell-q2', label: 'FLUX.1-schnell Q2（轻档，12 GB+ 内存）', minMemGB: 12, sizeGB: 6.4,
    diffusion: 'flux1-schnell-Q2_K.gguf', t5: 't5-v1_1-xxl-encoder-Q3_K_M.gguf',
  },
  {
    id: 'flux-schnell-q4', label: 'FLUX.1-schnell Q4（标准档，16 GB+ 内存）', minMemGB: 16, sizeGB: 10.0,
    diffusion: 'flux1-schnell-Q4_0.gguf', t5: 't5-v1_1-xxl-encoder-Q5_K_M.gguf',
  },
];

export const LICENSE_NOTE = 'FLUX.1-schnell 权重与 T5-XXL 编码器均为 Apache-2.0（可商用），clip_l 为 MIT';

/** 一个档位要下的四个文件：[本地文件名, 下载地址] */
export const modelFiles = (m) => [
  [m.diffusion, `${HF}/city96/FLUX.1-schnell-gguf/resolve/main/${m.diffusion}`],
  [m.t5, `${HF}/city96/t5-v1_1-xxl-encoder-gguf/resolve/main/${m.t5}`],
  CLIP_L, AE,
];

/** 与 AO 的 local-sdcpp 共用同一个 sd-cli 和模型目录（装 H3 时已经下过 cli 了就别再下一遍） */
export async function sdImagePaths() {
  try {
    const main = fileURLToPath(import.meta.resolve('agency-orchestrator'));
    const m = await import(path.join(path.dirname(main), 'connectors', 'local-sdcpp.js'));
    if (m.sdcppPaths) return m.sdcppPaths();
  } catch { /* AO 没暴露就用同样的默认路径 */ }
  return { cli: path.join(OPENSHORTS_HOME, 'bin', `sd-cli${process.platform === 'win32' ? '.exe' : ''}`), modelsDir: path.join(OPENSHORTS_HOME, 'models') };
}

export async function sdImageStatus() {
  const { cli, modelsDir } = await sdImagePaths();
  const cliFound = fs.existsSync(cli);
  const memGB = Math.round(os.totalmem() / 1024 ** 3);
  const models = SD_IMAGE_MODELS.map((m) => {
    // 要看大小不能只看存在：下载中断会留下 0 字节的壳，只查 existsSync 会把它当"已装"
    // （本机的 H3 模型目录就是这样——4 个 0 字节文件，AO 的状态里报 present:true）
    const missing = modelFiles(m).map(([n]) => n).filter((n) => { try { return fs.statSync(path.join(modelsDir, n)).size < 1024; } catch { return true; } });
    const enoughMem = memGB >= m.minMemGB;
    return { id: m.id, label: m.label, sizeGB: m.sizeGB, present: missing.length === 0, missing,
      usable: enoughMem, reason: !enoughMem ? `需要 ≥ ${m.minMemGB} GB 内存（本机 ${memGB} GB）` : missing.length ? `缺 ${missing.length} 个模型文件（共 ${m.sizeGB} GB）` : '就绪' };
  });
  const ready = cliFound && models.find((m) => m.present && m.usable);
  return { ok: !!ready, cli, cliFound, modelsDir, memGB, models, ready: ready?.id ?? null, license: LICENSE_NOTE };
}

/** 按内存挑一个能跑的档位（present 的优先，否则给出该装哪个） */
export function pickImageModel(status, wanted) {
  if (wanted) return status.models.find((m) => m.id === wanted) ?? null;
  return status.models.find((m) => m.present && m.usable)
    ?? [...status.models].reverse().find((m) => m.usable)
    ?? null;
}

export async function installSdImage({ model = 'flux-schnell-q4', onLog = () => {}, onProgress = () => {}, signal } = {}) {
  const m = SD_IMAGE_MODELS.find((x) => x.id === model);
  if (!m) throw new Error(`未知档位 ${model}（有 ${SD_IMAGE_MODELS.map((x) => x.id).join('、')}）`);
  const { modelsDir } = await sdImagePaths();
  fs.mkdirSync(modelsDir, { recursive: true });
  onLog(`${m.label} · 共约 ${m.sizeGB} GB · ${LICENSE_NOTE}`);
  for (const [name, url] of modelFiles(m)) {
    onLog(`下载 ${name}`);
    await downloadWithResume(url, path.join(modelsDir, name), { signal, onProgress: (p) => onProgress({ file: name, ...p }) });
  }
  onLog('模型就绪');
  return sdImageStatus();
}

/**
 * 出一张图。Flux-schnell 是蒸馏过的 4 步模型：cfg 必须给 1（给默认的 7 会糊成一团），步数 4 就够。
 *
 * 默认 576×1024 而不是 768×1344：真机（M2 Max，Q2 档，Metal）实测 768×1344 要 113 秒、
 * 576×1024 只要 68 秒，而这张图是给字幕当背景的，放到 1080×1920 里差别看不出来。
 * 一条片通常只有一两镜落到本地出图，省下的是分钟级的等待。
 */
export async function generateImage(prompt, { out, width = 576, height = 1024, model, steps = 4, seed = -1, signal, onLog = () => {}, timeoutMs = 15 * 60_000 } = {}) {
  const status = await sdImageStatus();
  if (!status.cliFound) throw new Error(`没装 sd-cli（本地出图/出片都要它）：${status.cli}`);
  const tier = pickImageModel(status, model);
  if (!tier) throw new Error('没有可用的本地出图档位（内存不足）');
  if (!tier.present) throw new Error(`${tier.label} 还缺 ${tier.missing.length} 个模型文件（共 ${tier.sizeGB} GB），先跑 openshorts install-image`);
  const cat = SD_IMAGE_MODELS.find((x) => x.id === tier.id);
  const p = (n) => path.join(status.modelsDir, n);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = ['-M', 'img_gen', '--diffusion-model', p(cat.diffusion), '--t5xxl', p(cat.t5), '--clip_l', p('clip_l.safetensors'), '--vae', p('ae.safetensors'),
    '-p', prompt, '-W', String(width), '-H', String(height), '--steps', String(steps), '--cfg-scale', '1.0', '--sampling-method', 'euler', '--seed', String(seed), '-o', out];
  onLog(`本地出图 ${width}×${height} · ${tier.label} · ${steps} 步`);
  const t0 = Date.now();
  // 用 spawn 不用 execFile：sd-cli 一跑几分钟、进度一行行往 stderr 打，execFile 会把它全缓存下来，
  // 超过 maxBuffer 就直接把子进程杀掉——那是个只在"图出得慢"时才发作的坑。这里只留最后几行做报错用。
  await new Promise((resolve, reject) => {
    const child = spawn(status.cli, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const tail = [];
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`本地出图超时（${Math.round(timeoutMs / 60000)} 分钟）`)); }, timeoutMs);
    const onAbort = () => { child.kill('SIGTERM'); reject(new Error('本地出图已取消')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (d) => { for (const line of String(d).split('\n')) { const t = line.trim(); if (t) { tail.push(t); if (tail.length > 12) tail.shift(); } } });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`跑不起来 sd-cli：${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort);
      if (code === 0) return resolve();
      reject(new Error(`本地出图失败（退出码 ${code}）：${tail.slice(-3).join(' | ').slice(0, 300)}`));
    });
  });
  if (!fs.existsSync(out) || !fs.statSync(out).size) throw new Error('本地出图跑完了但没产出文件');
  onLog(`出图完成 ${(Date.now() - t0) / 1000 | 0}s → ${path.basename(out)}`);
  return { file: out, model: tier.id, prompt, seed, width, height, seconds: (Date.now() - t0) / 1000 };
}
