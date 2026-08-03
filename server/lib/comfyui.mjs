import {randomUUID} from 'node:crypto';

const wait = (milliseconds, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds);
  signal?.addEventListener('abort', () => {clearTimeout(timer); reject(new Error('ComfyUI 任务已取消'));}, {once: true});
});

export const collectComfyImages = (history) => {
  const images = [];
  for (const output of Object.values(history?.outputs ?? {})) for (const image of output.images ?? []) if (image.filename) images.push({filename: image.filename, subfolder: image.subfolder ?? '', type: image.type ?? 'output'});
  return images;
};

export const runComfyWorkflow = async ({endpoint, workflow, signal, timeoutMs = 180000, pollIntervalMs = 1000, fetchImpl = fetch, onPoll = () => {}}) => {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow) || !Object.keys(workflow).length) throw new Error('ComfyUI workflow 必须是非空 API JSON 对象');
  const base = String(endpoint).replace(/\/$/, ''); const clientId = `openshorts-${randomUUID()}`;
  const queued = await fetchImpl(`${base}/prompt`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({prompt: workflow, client_id: clientId}), signal});
  if (!queued.ok) throw new Error(`ComfyUI 提交失败：HTTP ${queued.status}`);
  const {prompt_id: promptId, error} = await queued.json(); if (!promptId) throw new Error(error ? JSON.stringify(error) : 'ComfyUI 未返回 prompt_id');
  const started = Date.now(); let polls = 0;
  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) throw new Error('ComfyUI 任务已取消');
    const response = await fetchImpl(`${base}/history/${encodeURIComponent(promptId)}`, {signal});
    if (!response.ok) throw new Error(`ComfyUI 历史查询失败：HTTP ${response.status}`);
    const history = (await response.json())[promptId]; const images = collectComfyImages(history);
    onPoll({promptId, polls: ++polls, elapsedMs: Date.now() - started});
    if (images.length) {
      const results = [];
      for (const image of images) {
        const params = new URLSearchParams(image); const file = await fetchImpl(`${base}/view?${params}`, {signal});
        if (!file.ok) throw new Error(`ComfyUI 图片下载失败：HTTP ${file.status}`);
        results.push({...image, data: Buffer.from(await file.arrayBuffer()), contentType: file.headers.get('content-type') ?? 'image/png'});
      }
      return {promptId, images: results};
    }
    if (history?.status?.status_str === 'error') throw new Error('ComfyUI 工作流执行失败');
    await wait(pollIntervalMs, signal);
  }
  throw new Error(`ComfyUI 执行超过 ${Math.round(timeoutMs / 1000)} 秒`);
};
