// 从 ComfyUI API workflow JSON 里抽取溯源信息。
//
// 手工抄 model / seed / prompt 到 assets.json 是不可持续的——荔枝道那 5 张 PNG
// 就是因为「生成」和「记录」是两步，中间断了。工作流 JSON 里本来就有这些字段，
// 直接解析出来，生成完立刻落盘。
//
// ComfyUI API 格式：{ "<节点id>": {"class_type": "...", "inputs": {...}} }
// 节点之间用 [nodeId, outputSlot] 二元组连线。

// 模型名可能出现在不同 loader 的不同字段里。
const MODEL_FIELDS = ['ckpt_name', 'unet_name', 'model_name', 'lora_name'];
const SAMPLER_TYPES = new Set(['KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'KSamplerSelect']);

const nodesOf = (workflow) => Object.entries(workflow ?? {}).filter(([, node]) => node && typeof node === 'object');

/** 顺着 [nodeId, slot] 连线找到上游节点。 */
const follow = (workflow, link) => Array.isArray(link) && workflow[link[0]] ? {id: String(link[0]), node: workflow[link[0]]} : null;

/** 从 CLIPTextEncode 一类节点里取出文本；有些节点把文本再往上游接一层。 */
const textOf = (workflow, link, depth = 0) => {
  const found = follow(workflow, link);
  if (!found || depth > 4) return null;
  const value = found.node.inputs?.text;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return textOf(workflow, value, depth + 1);
  return null;
};

export const extractComfyTrace = (workflow) => {
  const nodes = nodesOf(workflow);
  if (!nodes.length) return {provider: 'comfyui', model: 'unknown', parameters: {}};

  // 采样器节点带着 seed 和正负提示词的连线，是解析的入口。
  const sampler = nodes.find(([, node]) => SAMPLER_TYPES.has(node.class_type))?.[1]
    ?? nodes.find(([, node]) => node.inputs && ('seed' in node.inputs || 'noise_seed' in node.inputs))?.[1];

  let model = null;
  for (const [, node] of nodes) {
    for (const field of MODEL_FIELDS) {
      const value = node.inputs?.[field];
      if (typeof value === 'string' && value) { model ??= value; break; }
    }
    if (model) break;
  }

  const inputs = sampler?.inputs ?? {};
  const seed = inputs.noise_seed ?? inputs.seed;
  const prompt = textOf(workflow, inputs.positive);
  const negative = textOf(workflow, inputs.negative);

  const parameters = {};
  for (const key of ['steps', 'cfg', 'sampler_name', 'scheduler', 'denoise']) {
    if (inputs[key] !== undefined && !Array.isArray(inputs[key])) parameters[key] = inputs[key];
  }
  if (negative) parameters.negativePrompt = negative;
  const size = nodes.find(([, node]) => node.inputs?.width && node.inputs?.height)?.[1]?.inputs;
  if (size && !Array.isArray(size.width) && !Array.isArray(size.height)) parameters.size = `${size.width}x${size.height}`;

  return {
    provider: 'comfyui',
    model: model ?? 'unknown',
    ...(seed !== undefined && !Array.isArray(seed) ? {seed} : {}),
    ...(prompt ? {prompt} : {}),
    parameters,
  };
};

/** 溯源是否足够复现：有模型和种子才谈得上重跑同一张图。 */
export const isReproducible = (trace) =>
  Boolean(trace?.model && trace.model !== 'unknown' && trace.seed !== undefined);
