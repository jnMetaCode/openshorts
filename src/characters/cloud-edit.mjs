/**
 * 云端改图：拿一张（或几张）参考图 + 一句要求，出一张新图——"保住这张脸，只换背景 / 服装"。
 *
 * 本机 FLUX schnell 只会按文字从零画：同一个种子改一处细节，衣服气质还在，脸就变了（9-24 真机）。
 * 要"保脸"只能交给有改图能力的模型。走 OpenAI 兼容的 `POST {base}/images/edits`（multipart：image + prompt + model），
 * GPT-Image、Agnes 与多数中转都认这个形状；供应商 / base_url / key 与 AO 同一张表、同一份存好的 key，不另配。
 *
 * 能进 AO 的通用能力：先在这里验证，再上提到 AO 的 image 连接器（AGENTS.md 的约定）。
 */
import { aoSavedKeys } from '../config.mjs';
import { importAo } from '../core/ao-module.mjs';
import { tt } from '../project/lang.mjs';

/** 供应商 → { baseUrl, apiKey }：环境变量优先（用户在 shell 里设的），再看界面存的 key */
export async function resolveProvider(id, { env = process.env, providers } = {}) {
  const list = providers ?? (await importAo('connectors', 'api-providers.js')).API_PROVIDERS ?? [];
  const p = list.find((x) => x.id === id);
  if (!p) throw Object.assign(new Error(`unknown provider: ${id}`), { status: 400 });
  const apiKey = (p.envKey && env[p.envKey]) || aoSavedKeys()[id]?.apiKey || '';
  const baseUrl = String((p.envBase && env[p.envBase]) || aoSavedKeys()[id]?.baseUrl || p.defaultBaseUrl || '').replace(/\/+$/, '');
  return { id, baseUrl, apiKey };
}

const mimeOf = (b) => (b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b.length > 11 && b.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : 'image/png');

/**
 * 两种接口形状。Agnes / 火山 Seedream 的"参考图出图"走 `/images/generations` + JSON 的 `image` 数组（data URL）；
 * GPT-Image 等走 `/images/edits` multipart。9-24 真机：Agnes 的 /images/edits 连着 503"没有可用服务器"，
 * 而 generations 带 image 15 秒出图、脸保得住——所以按供应商排优先，前一种挂了自动试另一种，两种都挂就把两边原话都报出来。
 */
export const PREFER_GENERATIONS = new Set(['agnes', 'volcengine', 'volcengine-plan']);

async function callShape(shape, { p, model, images, prompt, size, fetchImpl, timeoutMs }) {
  let init;
  if (shape === 'generations') {
    init = { method: 'POST', headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, ...(size ? { size } : {}), image: images.map((b) => `data:${mimeOf(b)};base64,${b.toString('base64')}`) }) };
  } else {
    const form = new FormData();
    form.append('model', model); form.append('prompt', prompt);
    if (size) form.append('size', size);
    // 一张用 image；多张按 OpenAI 的写法用 image[]（gpt-image-1 的多图参考就是这么收的）
    images.forEach((b, i) => form.append(images.length > 1 ? 'image[]' : 'image', new Blob([new Uint8Array(b)], { type: mimeOf(b) }), `ref-${i}.${mimeOf(b).split('/')[1]}`));
    init = { method: 'POST', headers: { Authorization: `Bearer ${p.apiKey}` }, body: form };
  }
  let r;
  try { r = await fetchImpl(`${p.baseUrl}/images/${shape}`, { ...init, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { return { err: `/images/${shape}: ${e.message}`, network: true }; }
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { /* 按原文报 */ }
  if (!r.ok || j?.error) return { err: `/images/${shape} HTTP ${r.status}: ${String(j?.error?.message ?? text).slice(0, 240)}`, status: r.status };
  const item = j?.data?.[0];
  if (item?.b64_json) return { bytes: Buffer.from(item.b64_json, 'base64') };
  if (item?.url) {
    const img = await fetchImpl(item.url, { signal: AbortSignal.timeout(120_000) });
    if (!img.ok) return { err: `/images/${shape}: image URL HTTP ${img.status}` };
    return { bytes: Buffer.from(await img.arrayBuffer()) };
  }
  return { err: `/images/${shape}: no image in response: ${text.slice(0, 160)}` };
}

/**
 * @param images Buffer[]：第一张是要保住的人；第二张（可选）是要放进去的场景
 * @param size "宽x高"（Agnes 认这种写法，写 "16:9" 会 500）
 * @returns {Promise<Buffer>}
 */
export async function editImage({ provider, model, images, prompt, size, lang = 'zh', fetchImpl = fetch, providers, timeoutMs = 300_000 }) {
  const T = tt(lang);
  if (!images?.length) throw new Error('editImage needs at least one image');
  const p = await resolveProvider(provider, { providers });
  if (!p.apiKey) throw Object.assign(new Error(T(`供应商 ${provider} 还没配 key（设置里存一次，或设环境变量）`, `Provider ${provider} has no API key (save one in settings, or set the environment variable)`)), { status: 400 });
  const order = PREFER_GENERATIONS.has(provider) ? ['generations', 'edits'] : ['edits', 'generations'];
  const errs = [];
  for (const shape of order) {
    const r = await callShape(shape, { p, model, images, prompt, size, fetchImpl, timeoutMs });
    if (r.bytes) return r.bytes;
    errs.push(r.err);
    // 401 / 402 / 403 是 key 或余额的事，换个接口也没用，别再白打一次
    if ([401, 402, 403].includes(r.status)) break;
  }
  // 失败原因原样带出来：供应商的原话（503 没有可用服务器 / 余额不足 / 模型不支持改图）比我们猜的有用
  throw Object.assign(new Error(T(`${provider} 改图失败：${errs.join(' ｜ ')}`, `${provider} image edit failed: ${errs.join(' | ')}`)), { status: 502 });
}
