import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'os-sdimg-'));
process.env.OPENSHORTS_HOME = HOME;
const m = await import('../src/local/sd-image.mjs');

test('档位表：四个文件、地址都指向可商用许可的仓库', () => {
  const q2 = m.SD_IMAGE_MODELS.find((x) => x.id === 'flux-schnell-q2');
  const files = m.modelFiles(q2);
  assert.equal(files.length, 4, 'diffusion + t5 + clip_l + vae');
  assert.deepEqual(files.map(([n]) => n).sort(), ['ae.safetensors', 'clip_l.safetensors', 'flux1-schnell-Q2_K.gguf', 't5-v1_1-xxl-encoder-Q3_K_M.gguf']);
  for (const [, url] of files) assert.match(url, /^https:\/\/huggingface\.co\//);
  // 许可证是选型的硬条件：用户要把片子发平台，SDXL-Turbo / FLUX.1-dev 都是非商用，不能用
  assert.match(m.LICENSE_NOTE, /Apache-2\.0/);
});

test('没装 sd-cli / 没下模型时，状态如实说缺什么，不假装可用', async () => {
  const st = await m.sdImageStatus();
  assert.equal(st.cliFound, false);
  assert.equal(st.ok, false);
  assert.equal(st.ready, null);
  assert.ok(st.models.every((x) => !x.present));
  assert.match(st.models[0].reason, /缺 4 个模型文件/);
});

test('0 字节的壳不算"已装"——下载中断会留下它，只查 existsSync 会误判', async () => {
  const dir = path.join(HOME, 'models');
  fs.mkdirSync(dir, { recursive: true });
  const q2 = m.SD_IMAGE_MODELS.find((x) => x.id === 'flux-schnell-q2');
  for (const [n] of m.modelFiles(q2)) fs.writeFileSync(path.join(dir, n), '');   // 空壳
  let st = await m.sdImageStatus();
  assert.equal(st.models.find((x) => x.id === 'flux-schnell-q2').present, false, '0 字节文件必须算缺失');

  for (const [n] of m.modelFiles(q2)) fs.writeFileSync(path.join(dir, n), Buffer.alloc(2048));
  st = await m.sdImageStatus();
  assert.equal(st.models.find((x) => x.id === 'flux-schnell-q2').present, true);
});

test('挑档位：装好且跑得动的优先；指定了就按指定的来', async () => {
  const st = await m.sdImageStatus();
  assert.equal(m.pickImageModel(st)?.id, 'flux-schnell-q2', '上一条测试把 q2 装成"有内容"了，该选它');
  assert.equal(m.pickImageModel(st, 'flux-schnell-q4')?.id, 'flux-schnell-q4');
  assert.equal(m.pickImageModel(st, '不存在'), null);
  const lowMem = { models: st.models.map((x) => ({ ...x, usable: false })) };
  assert.equal(m.pickImageModel(lowMem), null, '内存都不够时返回 null，而不是硬选一个跑不动的');
});

test('模型没下全就出图 → 报清楚缺什么、该跑哪条命令，不是一句底层报错', async () => {
  await assert.rejects(
    () => m.generateImage('a cat', { out: path.join(HOME, 'x.png'), model: 'flux-schnell-q4' }),
    /没装 sd-cli|还缺 .* 个模型文件/,
  );
});
