/**
 * 「复制诊断信息」：报 bug 时一键带上版本 / 系统 / 安装方式 / 体检结果 / 选了哪家模型。
 *
 * 第一个真用户 issue（#12）里，版本一栏填的是"mac"、复现步骤填的是"1、"——不是用户敷衍，
 * 是桌面包用户根本没处查版本，也跑不了 `openshorts doctor`。让界面替他把这些备好。
 *
 * **两条硬规矩**：key 的值一个字符都不能出现（只列"哪几家配了"）；家目录换成 ~（路径里常带真名）。
 * 末尾再整体过一遍 redact：万一哪条报错原文里带着 key（供应商的 401 有时会回显），也得打码。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, aoSavedKeys, isEnvAppliedByUs } from './config.mjs';
import { aoModuleUrl } from './core/ao-module.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return null; } };

export function installMode({ env = process.env, versions = process.versions, rootDir = root, exists = fs.existsSync } = {}) {
  if (env.ELECTRON_RUN_AS_NODE || versions.electron) return 'desktop';
  if (exists('/.dockerenv')) return 'docker';
  if (/[\\/](node_modules|_npx)[\\/]/.test(rootDir)) return 'npm';
  return exists(path.join(rootDir, '.git')) ? 'source' : 'unknown';
}

/** 把已知的 key 值和家目录从任意文本里抹掉。secrets 传进来的是真值，出去的文本里不能再有 */
export function redact(text, { secrets = [], home = os.homedir() } = {}) {
  let out = String(text ?? '');
  for (const s of [...new Set(secrets)].filter((x) => x && x.length >= 6).sort((a, b) => b.length - a.length)) out = out.split(s).join('***');
  if (home && home.length > 1) out = out.split(home).join('~');
  // 兜底：没登记过的、长得像 key 的串（sk-… / Bearer …）
  return out.replace(/\b(sk|pk|key|ak)-[A-Za-z0-9_-]{12,}/g, '$1-***').replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '$1***');
}

export async function collectDiagnostics({ lastError = '', doctorFn = null, env = process.env } = {}) {
  const pkg = readJson(path.join(root, 'package.json')) ?? {};
  let aoVersion = '?';
  try { aoVersion = readJson(path.join(fileURLToPath(aoModuleUrl([])), '..', 'package.json'))?.version ?? '?'; } catch (e) { aoVersion = `unresolved (${String(e.message).split('\n')[0].slice(0, 80)})`; }
  const cfg = readConfig(); const saved = aoSavedKeys();
  const savedIds = Object.keys(saved).filter((k) => saved[k]?.apiKey);
  const envKeys = Object.keys(env).filter((k) => /_API_KEY$/.test(k) && env[k] && !isEnvAppliedByUs(k, env));
  const secrets = [...savedIds.map((k) => saved[k].apiKey), ...Object.keys(env).filter((k) => /_API_KEY$|_TOKEN$/.test(k)).map((k) => env[k]), cfg.stock?.pexelsKey, cfg.stock?.pixabayKey];
  let doc = [];
  try { doc = await (doctorFn ?? (await import('./doctor.mjs')).doctor)(); } catch (e) { doc = [{ status: 'fail', msg: `doctor failed: ${String(e.message).split('\n')[0]}` }]; }
  const mark = { ok: '✅', warn: '⚠️', fail: '⛔' };
  const lines = [
    '### OpenShorts diagnostics',
    `- OpenShorts ${pkg.version ?? '?'} · engine (agency-orchestrator) ${aoVersion} · install: ${installMode({ env })}`,
    `- ${os.platform()} ${os.release()} ${os.arch()} · Node ${process.versions.node}${process.versions.electron ? ` · Electron ${process.versions.electron}` : ''} · RAM ${Math.round(os.totalmem() / 2 ** 30)} GB · locale ${env.LC_ALL || env.LANG || Intl.DateTimeFormat().resolvedOptions().locale}`,
    `- script model: ${cfg.text?.provider || '(engine default)'} / ${cfg.text?.model || '-'} · visual check: ${cfg.vision?.provider ? `${cfg.vision.provider} / ${cfg.vision.model}` : 'off'} · voice: ${cfg.tts?.voice ?? '-'}${cfg.tts?.fallback?.provider ? ` (fallback ${cfg.tts.fallback.provider})` : ''}`,
    `- keys saved for: ${savedIds.join(', ') || 'none'} · keys from env: ${envKeys.join(', ') || 'none'} · stock: ${[cfg.stock?.pexelsKey && 'pexels', cfg.stock?.pixabayKey && 'pixabay'].filter(Boolean).join(', ') || 'none'}`,
    `- proxy: ${['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'].some((k) => env[k]) ? 'yes' : 'no'} · output dir: ${cfg.outputDir}`,
    '', '**Health check**', ...doc.map((i) => `- ${mark[i.status] ?? '•'} ${i.msg}`),
    ...(lastError ? ['', '**Last error shown in the app**', '```', String(lastError).slice(0, 2000), '```'] : []),
  ];
  return redact(lines.join('\n'), { secrets });
}
