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

const DEFAULTS = { outputDir: DEFAULT_OUTPUT_DIR, stock: { pexelsKey: '', pixabayKey: '' }, tts: { provider: 'edge-tts', voice: 'zh-CN-XiaoxiaoNeural' }, telemetry: false };

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
