/**
 * OpenShorts 自己的设置：~/.openshorts/config.json（输出目录、素材库 key、TTS 默认音色）。
 * API key / 供应商沿用 AO 的 ~/.ao（用户配一次两边都能用，ADR-008）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const OPENSHORTS_HOME = process.env.OPENSHORTS_HOME || path.join(os.homedir(), '.openshorts');
export const CONFIG_FILE = path.join(OPENSHORTS_HOME, 'config.json');
export const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), 'OpenShorts');

const DEFAULTS = { outputDir: DEFAULT_OUTPUT_DIR, stock: { pexelsKey: '', pixabayKey: '' }, tts: { provider: 'edge-tts', voice: 'zh-CN-XiaoxiaoNeural' }, vision: { provider: '', model: '' }, text: { provider: '', model: '' }, telemetry: false };

export function readConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) }; } catch { return { ...DEFAULTS }; }
}
export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(OPENSHORTS_HOME, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n');
  return next;
}
/** AO 的数据目录（key 存这里）：与 AO 的 web/data-dir 规则一致，优先 AO_DATA_DIR / AO_HOME，默认 ~/.ao */
export function aoHome() { return process.env.AO_DATA_DIR || process.env.AO_HOME || path.join(os.homedir(), '.ao'); }

/** AO 保存的 key（Studio 存的）：{ provider: { apiKey } } */
export function aoSavedKeys() { try { return JSON.parse(fs.readFileSync(path.join(aoHome(), '.local', 'web-keys.json'), 'utf-8')); } catch { return {}; } }

/**
 * 把 Studio 存的 key 映射成对应的环境变量。
 *
 * AO 的 **CLI** 会读 `<数据目录>/.local/web-keys.json`，但**库函数 `run()` 不读**——它只认环境变量。
 * 而开片调的正是库函数。结果就是：在界面里存好 key、验证也通过（验证那条路是显式传 api_key 的），
 * 一到"写脚本"就报"缺少 API Key"。典型的"看着好了，后面才炸"。
 * 这里在进程启动时补上这一步，跟 AO CLI 的行为对齐；已经设了的环境变量优先，不覆盖用户的显式设置。
 */
export async function applyAoKeysToEnv(env = process.env) {
  const saved = aoSavedKeys();
  const ids = Object.keys(saved).filter((k) => saved[k]?.apiKey);
  if (!ids.length) return [];
  let providers = [];
  try {
    const { fileURLToPath } = await import('node:url');
    const main = fileURLToPath(import.meta.resolve('agency-orchestrator'));
    providers = (await import(path.join(path.dirname(main), 'connectors', 'api-providers.js'))).API_PROVIDERS ?? [];
  } catch { return []; }
  const applied = [];
  for (const p of providers) {
    if (!p.envKey || !saved[p.id]?.apiKey || env[p.envKey]) continue;
    env[p.envKey] = saved[p.id].apiKey;
    applied.push(p.id);
  }
  return applied;
}
