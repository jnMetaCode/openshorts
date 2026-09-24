/**
 * 角色卡要用到的两件"真家伙"：本机出图（FLUX via sd-cli）与文本模型（把中文外形翻成出图提示词）。
 * 与 cards.mjs 分开放：卡片逻辑的测试注入假的 gen / chat，不必起模型。
 */
import { readConfig } from '../config.mjs';

/** 设置里选的文本模型；没选返回 null（出图时就直接用中文描述，结果里会标 translated:false） */
export async function configuredChat({ provider, model } = {}) {
  const cfg = readConfig();
  const p = provider || cfg.text?.provider;
  if (!p) return null;
  const m = model || (provider ? undefined : cfg.text?.model);
  const { createConnector } = await import('agency-orchestrator');
  const c = { provider: p, ...(m ? { model: m } : {}), timeout: 180000, retry: 1 };
  return async (system, user) => String((await createConnector(c).chat(system, user, { ...c, max_tokens: 800, temperature: 0.3 })).content ?? '');
}

export async function localGen() {
  const { generateImage } = await import('../local/sd-image.mjs');
  return (prompt, opts) => generateImage(prompt, opts);
}
