// 素材溯源。
//
// 原来的问题：溯源写在 projects/<故事>.json 的 production.assetPlan 里，
// 但那个文件是 build-story.mjs 每次重新生成的——写进去下次构建就没了。
// 所以两个故事的 assetPlan 一直是空的，荔枝道那批 PNG 的来源已经查不回来。
//
// 修法是把溯源放回源头 content/<故事>/assets.json，构建时再materialize 进工程。

export const UNKNOWN = 'unknown';

// 已知的来源类型。handwritten-svg 指仓库里手写的 SVG 路径数据，无版权风险。
export const PROVIDERS = {
  'handwritten-svg': {label: '手写 SVG', needsModel: false, licensable: true},
  'comfyui': {label: 'ComfyUI 本地工作流', needsModel: true, licensable: true},
  'imagegen-agent': {label: 'Agent 图像生成', needsModel: true, licensable: true},
  'stock': {label: '图库素材', needsModel: false, licensable: true},
  'photograph': {label: '自行拍摄', needsModel: false, licensable: true},
  // 评论/解说用途的短引用，必须记录来源与作者；素材本体不进仓库（.gitignore public/assets/quoted/）
  'quotation': {label: '第三方引用（评论用途）', needsModel: false, licensable: true},
  'repo-render': {label: '本仓库渲染产物', needsModel: false, licensable: true},
  [UNKNOWN]: {label: '来源未知', needsModel: false, licensable: false},
};

/** 收集分镜里实际引用到的素材路径（去重，保持出现顺序）。 */
export const collectAssetSources = (board) =>
  [...new Set((board.scenes ?? []).flatMap((scene) => (scene.layers ?? []).map((layer) => layer.src)).filter(Boolean))];

/**
 * 把分镜图层和 assets.json 的记录合成 production.assetPlan。
 * 一个素材文件可能被多个图层复用，这里按文件聚合，assetPlan 每个文件一条。
 */
export const buildAssetPlan = ({board, provenance = {}}) => {
  const usedBy = new Map();
  for (const scene of board.scenes ?? []) {
    for (const layer of scene.layers ?? []) {
      if (!layer.src || layer.kind === 'text') continue;   // 文字图层无文件可溯源
      if (!usedBy.has(layer.src)) usedBy.set(layer.src, []);
      usedBy.get(layer.src).push({role: layer.role, name: layer.name});
    }
  }
  return [...usedBy.entries()].map(([src, layers], index) => {
    const record = provenance[src] ?? {};
    const provider = record.provider ?? UNKNOWN;
    return {
      id: `asset-${String(index + 1).padStart(2, '0')}`,
      role: layers[0].role,
      name: record.name ?? layers[0].name,
      prompt: record.prompt ?? '',
      requirements: record.requirements ?? [],
      status: record.status ?? (provider === UNKNOWN ? 'planned' : 'approved'),
      src,
      promptVersions: [],
      reviewHistory: record.reviewHistory ?? [],
      generation: {
        provider,
        model: record.model ?? (PROVIDERS[provider]?.needsModel ? UNKNOWN : '-'),
        ...(record.seed == null ? {} : {seed: record.seed}),
        ...(record.workflowId ? {workflowId: String(record.workflowId)} : {}),
        parameters: {
          usedIn: layers.length,
          ...(record.license ? {license: record.license} : {}),
          ...(record.credit ? {credit: record.credit} : {}),
          ...(record.note ? {note: record.note} : {}),
          ...(record.parameters ?? {}),
        },
        createdAt: record.createdAt ?? UNKNOWN,
      },
    };
  });
};

/** 找出没有可信来源的素材——公开发布前必须清空这个列表。 */
export const unresolvedAssets = (assetPlan = []) =>
  assetPlan.filter((asset) => {
    const provider = asset.generation?.provider ?? UNKNOWN;
    return provider === UNKNOWN || !PROVIDERS[provider]?.licensable;
  });
