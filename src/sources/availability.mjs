/**
 * 本机可用的画面来源及原因（架构文档 §3 的 availability()）。M0 只做检测，不做生成。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readConfig, aoHome } from '../config.mjs';

function aoKeys() {
  try { return JSON.parse(fs.readFileSync(path.join(aoHome(), '.local', 'web-keys.json'), 'utf-8')); } catch { return {}; }
}
const has = (cmd) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0;

export function sourcesAvailability({ lang = 'zh' } = {}) {
  // 界面有英文切换（?lang=en），reason 是唯一由服务端说话的地方——不跟着翻，
  // 英文界面里就永远嵌着几段中文。zh/en 各写一份，别做机翻式插值拼接。
  const en = lang === 'en';
  const cfg = readConfig();
  const keys = aoKeys();
  const keyedNames = [cfg.stock?.pexelsKey && 'Pexels', cfg.stock?.pixabayKey && 'Pixabay'].filter(Boolean);
  const keyed = keyedNames.length > 0;
  const envKey = (name) => !!process.env[name];
  const memGB = Math.round(os.totalmem() / 1024 ** 3);
  const sdcli = process.env.OPENSHORTS_SD_CLI || path.join(process.env.OPENSHORTS_HOME || path.join(os.homedir(), '.openshorts'), 'bin', 'sd-cli');
  const sdOk = fs.existsSync(sdcli) || has('sd-cli');
  const videoProviders = ['metaso', 'apimart', 'agnes', 'volcengine'].filter((p) => keys[p]?.apiKey || envKey(`${p.toUpperCase()}_API_KEY`) || (p === 'volcengine' && envKey('ARK_API_KEY')));
  const ENV_IMAGE = { openai: 'OPENAI_API_KEY', agnes: 'AGNES_API_KEY', apimart: 'APIMART_API_KEY', lanox: 'LANOX_API_KEY', volcengine: 'ARK_API_KEY', 'volcengine-plan': 'ARK_PLAN_API_KEY' };
  const imageProviders = [...new Set([...Object.keys(keys).filter((p) => keys[p]?.apiKey), ...Object.keys(ENV_IMAGE).filter((p) => envKey(ENV_IMAGE[p]))])];
  const localTier = memGB >= 64 ? (en ? 'Q4_K (usable)' : 'Q4_K（可用档）') : memGB >= 32 ? (en ? 'UD-Q2_K_XL (draft; ~216 s per 1.6 s clip on M2 Max 32G)' : 'UD-Q2_K_XL（草稿档，M2 Max 32G 实测 216 s / 1.6 s 片）') : memGB >= 24 ? (en ? 'Q2_K (draft)' : 'Q2_K（草稿档）') : null;
  return {
    // Wikimedia Commons 不要 key，所以素材库永远有兜底——这里如实标"能用但画面偏科教"，
    // 而不是像以前那样一律 ⛔（新用户会以为什么都干不了，其实 0 key 就能出第一条片）
    stock: keyed
      ? { ok: true, tier: 'keyed', reason: en ? `Stock keys configured: ${keyedNames.join(' / ')} (+ Wikimedia fallback)` : `已配素材库 key：${keyedNames.join(' / ')}（+ Wikimedia 兜底）` }
      : { ok: true, tier: 'free', reason: en ? 'Wikimedia Commons, no key needed (CC images first, video second; stills get a blurred backdrop and slow push-in; solid color only when nothing matches). A free Pexels key upgrades you to real stock video.' : 'Wikimedia Commons 免 key（CC 图片为主 + 视频为辅，静图会加虚化垫底与缓推；都没命中才退纯色底）；配一把免费 Pexels key 换成实拍视频更好' },
    image: { ok: imageProviders.length > 0, reason: imageProviders.length ? (en ? `Keys in AO: ${imageProviders.join(', ')}` : `AO 已配 key：${imageProviders.join(', ')}`) : (en ? 'No API key configured in AO' : '未在 AO 配任何 API key') },
    local: { ok: sdOk && !!localTier, reason: !localTier ? (en ? `${memGB} GB RAM < 24 GB — local H3 unavailable` : `内存 ${memGB} GB < 24 GB，本地 H3 不可用（可接 LTX/Wan，M2）`) : sdOk ? (en ? `sd-cli ready · tier ${localTier}` : `sd-cli 就绪 · 档位 ${localTier}`) : (en ? `sd-cli not installed (${memGB} GB RAM can run ${localTier})` : `未装 sd-cli（内存 ${memGB} GB 可跑 ${localTier}）`), tier: localTier, memGB },
    cloud: { ok: videoProviders.length > 0, reason: videoProviders.length ? (en ? `Video providers: ${videoProviders.join(', ')}` : `视频供应商：${videoProviders.join(', ')}`) : (en ? 'No video-provider key (Metaso / APIMart / Agnes / Volcengine)' : '未配视频供应商 key（秘塔 / APIMart / Agnes / 火山）') },
    layered: { ok: has('ffmpeg'), reason: has('ffmpeg') ? (en ? 'ffmpeg ready (Remotion layered animation)' : 'ffmpeg 就绪（Remotion 图层动画）') : (en ? 'ffmpeg missing' : '缺 ffmpeg') },
    tools: { ffmpeg: has('ffmpeg'), whisper: has('whisper-cli'), magick: has('magick') || has('convert') },
  };
}
