import assert from 'node:assert/strict';
import test from 'node:test';
import {collectComfyImages, runComfyWorkflow} from '../server/lib/comfyui.mjs';

test('从 ComfyUI history 收集所有输出图片', () => {
  const images = collectComfyImages({outputs: {'9': {images: [{filename: 'a.png', subfolder: 'x', type: 'output'}]}, '10': {text: ['x']}}});
  assert.deepEqual(images, [{filename: 'a.png', subfolder: 'x', type: 'output'}]);
});

test('ComfyUI 执行器可提交、轮询并下载图片', async () => {
  let historyCalls = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/prompt')) return new Response(JSON.stringify({prompt_id: 'p1'}), {status: 200});
    if (url.includes('/history/')) {historyCalls += 1; return new Response(JSON.stringify({p1: historyCalls > 1 ? {outputs: {node: {images: [{filename: 'result.png'}]}}} : {outputs: {}}}), {status: 200});}
    if (url.includes('/view?')) return new Response(new Uint8Array([1, 2, 3]), {status: 200, headers: {'content-type': 'image/png'}});
    return new Response('', {status: 404});
  };
  const result = await runComfyWorkflow({endpoint: 'http://comfy.local', workflow: {node: {}}, pollIntervalMs: 1, fetchImpl});
  assert.equal(result.promptId, 'p1'); assert.equal(result.images[0].data.length, 3);
});
