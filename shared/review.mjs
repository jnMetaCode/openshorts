const REVIEW_STATES = new Set(['approved', 'rejected']);

export const reviewAssets = (project, {assetIds, status, note = ''}) => {
  if (!REVIEW_STATES.has(status)) throw new Error('审核状态必须是 approved 或 rejected');
  const selected = new Set(assetIds ?? []); if (!selected.size) throw new Error('至少选择一项素材');
  const next = structuredClone(project); let updated = 0; const createdAt = new Date().toISOString();
  for (const asset of next.production?.assetPlan ?? []) {
    if (!selected.has(asset.id)) continue;
    asset.status = status; asset.reviewHistory = [...(asset.reviewHistory ?? []), {status, note:String(note), createdAt}]; updated++;
  }
  return {project: next, updated};
};

export const attachGenerationTrace = (project, assetId, trace) => {
  const next = structuredClone(project); const asset = next.production?.assetPlan?.find((item) => item.id === assetId);
  if (!asset) throw new Error(`素材计划不存在：${assetId}`);
  asset.generation = {provider:String(trace.provider || 'unknown'),model:String(trace.model || 'unknown'),...(trace.seed === '' || trace.seed == null ? {} : {seed:trace.seed}),...(trace.workflowId ? {workflowId:String(trace.workflowId)} : {}),parameters:trace.parameters && typeof trace.parameters === 'object' ? trace.parameters : {},createdAt:new Date().toISOString()};
  return next;
};

export const retimeScene = (scene, durationFrames) => {
  const next = structuredClone(scene); const oldDuration = Math.max(1, next.durationFrames); const target = Math.max(1, Math.round(durationFrames)); const scale = target / oldDuration;
  next.durationFrames = target;
  next.captions = next.captions.map((item) => ({...item,fromFrame:Math.min(target - 1,Math.max(0,Math.round(item.fromFrame * scale))),toFrame:Math.min(target,Math.max(1,Math.round(item.toFrame * scale))),words:(item.words ?? []).map((word) => ({...word,fromFrame:Math.min(target-1,Math.max(0,Math.round(word.fromFrame*scale))),toFrame:Math.min(target,Math.max(1,Math.round(word.toFrame*scale)))})).map((word) => ({...word,toFrame:Math.max(word.fromFrame+1,word.toFrame)}))})).map((item) => ({...item,toFrame:Math.max(item.fromFrame + 1,item.toFrame)}));
  next.layers = next.layers.map((layer) => ({...layer,delayFrames:Math.min(target - 1,Math.round(layer.delayFrames * scale)),keyframes:(layer.keyframes ?? []).map((item) => ({...item,frame:Math.min(target - 1,Math.round(item.frame * scale))})).filter((item,index,items) => items.findIndex((other) => other.frame === item.frame) === index)}));
  return next;
};

export const retimeProjectFromNarration = (project, durationsByScene, paddingSeconds = 0.2) => {
  const next = structuredClone(project); let updated = 0;
  next.scenes = next.scenes.map((scene) => {
    const seconds = Number(durationsByScene[scene.id]); if (!(seconds > 0)) return scene;
    updated++; return retimeScene(scene, Math.ceil((seconds + Math.max(0,paddingSeconds)) * next.fps));
  });
  return {project:next,updated};
};
