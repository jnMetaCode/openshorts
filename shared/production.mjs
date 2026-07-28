const normalize = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ');

export const addPromptVersion = (asset, prompt, note = '') => {
  const versions = [...(asset.promptVersions ?? [])];
  const id = `pv-${String(versions.length + 1).padStart(3, '0')}`;
  versions.push({id, prompt: String(prompt).trim(), note: String(note).trim(), createdAt: new Date().toISOString()});
  return {...asset, prompt: String(prompt).trim(), promptVersions: versions, activePromptVersion: id};
};

export const activatePromptVersion = (asset, id) => {
  const version = (asset.promptVersions ?? []).find((item) => item.id === id);
  if (!version) throw new Error(`提示词版本不存在：${id}`);
  return {...asset, prompt: version.prompt, activePromptVersion: id};
};

const matchScore = (asset, candidate) => {
  if (candidate.assetPlanId === asset.id) return 1000;
  let score = 0;
  if (candidate.sceneId && asset.sceneId === candidate.sceneId) score += 100;
  if (candidate.role === asset.role) score += 60;
  if (candidate.role === 'tertiary' && asset.role === 'secondary') score += 35;
  const words = normalize(`${asset.id} ${asset.name}`).split(' ').filter((item) => item.length > 1);
  const haystack = normalize(`${candidate.path} ${candidate.name ?? ''}`);
  score += words.filter((word) => haystack.includes(word)).length * 12;
  return score;
};

export const matchAssets = (assetPlan, candidates) => {
  const unused = new Set(candidates.map((_, index) => index));
  const matches = [];
  for (const asset of assetPlan) {
    const ranked = [...unused].map((index) => ({index, score: matchScore(asset, candidates[index])})).sort((a, b) => b.score - a.score);
    if (!ranked.length || ranked[0].score < 35) continue;
    const winner = ranked[0]; unused.delete(winner.index);
    matches.push({assetPlanId: asset.id, path: candidates[winner.index].path, score: winner.score});
  }
  return matches;
};

export const applyAssetMatches = (project, candidates) => {
  if (!project.production?.assetPlan) return {project, matches: []};
  const next = structuredClone(project); const matches = matchAssets(next.production.assetPlan, candidates);
  for (const match of matches) {
    const plan = next.production.assetPlan.find((item) => item.id === match.assetPlanId);
    if (plan) Object.assign(plan, {src: match.path, status: 'assigned'});
    for (const scene of next.scenes) for (const layer of scene.layers) if (layer.assetPlanId === match.assetPlanId) layer.src = match.path;
  }
  return {project: next, matches};
};
