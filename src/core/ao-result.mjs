/**
 * AO 运行结果 → OpenShorts 项目 JSON 回填（纯函数，架构文档 §1.2）。
 * 输入：AO 的 metadata.json（steps[] 带 status / imageAsset / videoAsset / verification）+ 模板清单。
 * 输出：schemaVersion 2 的项目，每个媒体步骤一个 shot，验收结论进 shots[].verification。
 * 不读盘、不猜：没有 asset 的媒体步骤不生成 shot；skipped 的步骤不出现。
 */
export function aoResultToProject(metadata, template, opts = {}) {
  const steps = Array.isArray(metadata?.steps) ? metadata.steps : [];
  const assetsBase = opts.assetsBase ?? 'assets';
  const shots = [];
  for (const s of steps) {
    if (s.status !== 'completed') continue;
    const asset = s.videoAsset ?? s.imageAsset;
    if (!asset?.filename) continue;
    const isVideo = !!s.videoAsset;
    const shotOrder = Number((String(s.id).match(/(\d+)$/) || [])[1]) || shots.length + 1;
    shots.push({
      id: s.id,
      order: shotOrder,
      kind: s.id === 'film' ? 'final' : isVideo ? 'video' : 'image',
      durationSec: asset.seconds ?? null,
      visual: {
        source: 'cloud',
        provider: s.provider ?? template?.defaults?.provider ?? null,
        model: s.model ?? template?.defaults?.model ?? null,
        file: `${assetsBase}/${asset.filename}`,
        cost: isVideo ? { kind: 'per-second', seconds: asset.seconds ?? null } : { kind: 'per-image', count: 1 },
      },
      verification: s.verification ? { pass: !!s.verification.pass, failed: s.verification.failed ?? [], reworked: !!s.verification.reworked } : null,
      status: s.verification && !s.verification.pass ? 'ready' : 'approved',
      stepName: s.agentName ?? s.id,
    });
  }
  shots.sort((a, b) => (a.kind === 'final') - (b.kind === 'final') || a.order - b.order);
  const final = shots.find((x) => x.kind === 'final');
  return {
    schemaVersion: 2,
    id: opts.id ?? slug(metadata?.name ?? 'project'),
    template: template?.id ?? 'ai-drama',
    line: template?.line ?? 'drama',
    title: metadata?.name ?? '',
    inputs: metadata?.inputs ?? {},
    output: { w: 1280, h: 720, fps: 24, platform: opts.platform ?? 'douyin' },
    defaults: { visualSource: 'cloud' },
    shots: shots.filter((x) => x.kind !== 'final'),
    final: final ? { file: final.visual.file } : null,
    provenance: shots.map((x) => ({ shot: x.id, source: x.visual.source, provider: x.visual.provider, model: x.visual.model, file: x.visual.file })),
    ao: { file: metadata?.file ?? null, finishedAt: metadata?.finishedAt ?? null, success: !!metadata?.success, totalTokens: metadata?.totalTokens ?? null },
  };
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '') || 'project';
