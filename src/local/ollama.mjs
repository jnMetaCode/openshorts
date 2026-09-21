/**
 * 本机 Ollama：让"写脚本"这一步也能 0 元 0 key。
 *
 * 引擎（AO）早就带 ollama 连接器，但界面的供应商下拉只读"要 key 的 API 供应商表"，本地模型选不到——
 * 号称本地优先，写脚本却必须先去注册一把云端 key。真机：qwen2.5-coder:7b 43 秒写出合法脚本，全程不联网。
 * 这里只做探测（在不在、装了哪些能聊天的模型）；真正的调用仍走 AO 的连接器，地址规则与它一致。
 */
export const ollamaBaseUrl = (env = process.env) => {
  const raw = String(env.OLLAMA_BASE_URL || env.OLLAMA_HOST || 'http://localhost:11434').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
};

/** 嵌入模型聊不了天：列进下拉等于埋雷（选了它写脚本直接报错） */
const isEmbedding = (m) => /embed|bge-|minilm|nomic|e5-|gte-/i.test(m.name ?? '') || /bert/i.test(m.details?.family ?? '');

export async function ollamaStatus({ fetchImpl = fetch, env = process.env, timeoutMs = 1500 } = {}) {
  const baseUrl = ollamaBaseUrl(env);
  try {
    const r = await fetchImpl(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { running: false, baseUrl, models: [], reason: `HTTP ${r.status}` };
    const all = (await r.json()).models ?? [];
    // 大的在前：同一台机器上，参数多的那个写口播稿明显更稳
    const models = all.filter((m) => !isEmbedding(m)).sort((a, b) => (b.size ?? 0) - (a.size ?? 0)).map((m) => m.name);
    return { running: true, baseUrl, models };
  } catch (e) { return { running: false, baseUrl, models: [], reason: String(e?.cause?.code ?? e?.name ?? e).slice(0, 60) }; }
}
