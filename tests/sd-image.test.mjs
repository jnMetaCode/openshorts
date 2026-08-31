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
  const st = await m.sdImageStatus({ memGB: 32 });   // 固定内存：CI 的 macOS runner 只有 7 GB
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
  let st = await m.sdImageStatus({ memGB: 32 });
  assert.equal(st.models.find((x) => x.id === 'flux-schnell-q2').present, false, '0 字节文件必须算缺失');

  for (const [n] of m.modelFiles(q2)) fs.writeFileSync(path.join(dir, n), Buffer.alloc(2048));
  st = await m.sdImageStatus({ memGB: 32 });
  assert.equal(st.models.find((x) => x.id === 'flux-schnell-q2').present, true);
});

test('挑档位：装好且跑得动的优先；指定了就按指定的来', async () => {
  const st = await m.sdImageStatus({ memGB: 32 });
  assert.equal(m.pickImageModel(st)?.id, 'flux-schnell-q2', '上一条测试把 q2 装成"有内容"了，该选它');
  assert.equal(m.pickImageModel(st, 'flux-schnell-q4')?.id, 'flux-schnell-q4');
  assert.equal(m.pickImageModel(st, '不存在'), null);
  const lowMem = { models: st.models.map((x) => ({ ...x, usable: false })) };
  assert.equal(m.pickImageModel(lowMem), null, '内存都不够时返回 null，而不是硬选一个跑不动的');

  // 内存不够的机器上（CI 的 macOS runner 就是 7 GB），理由要说内存而不是缺文件
  const small = await m.sdImageStatus({ memGB: 7 });
  assert.equal(small.ok, false);
  assert.ok(small.models.every((x) => !x.usable));
  assert.match(small.models[0].reason, /需要 ≥ \d+ GB 内存（本机 7 GB）/);
  assert.equal(m.pickImageModel(small), null, '一档都跑不动时不该硬推一个');
});

test('模型没下全就出图 → 报清楚缺什么、该跑哪条命令，不是一句底层报错', async () => {
  await assert.rejects(
    () => m.generateImage('a cat', { out: path.join(HOME, 'x.png'), model: 'flux-schnell-q4' }),
    /没装 sd-cli|还缺 .* 个模型文件/,
  );
});

/**
 * 上游 2026 年把 CI 换到 macOS 26 之后，最近的所有发布只提供 macOS 26 的包。
 * 不看资源名里那段版本号的话，会给 macOS 14 的用户装一个跑不起来的二进制——
 * 装"成功"、cliFound 为真，直到出图那一刻才 dyld 崩溃。
 */
test('挑预编译包要看资源名里写的系统版本，跑不动的宁可不装', async () => {
  const { pickSdcppAsset, assetMacOS } = await import('../src/local/download.mjs');
  assert.equal(assetMacOS('sd-master-6b3edaa-bin-Darwin-macOS-26.5.2-arm64.zip'), 26.05);
  assert.equal(assetMacOS('sd-master-bin-Darwin-macOS-14-arm64.zip'), 14);
  assert.equal(assetMacOS('sd-master-bin-Linux-x86_64.zip'), null, '非 macOS 的包不带这段');

  const newOnly = [{ name: 'sd-bin-Darwin-macOS-26.5.2-arm64.zip' }];
  assert.equal(pickSdcppAsset(newOnly, 'darwin', 'arm64', 'auto', 14.07), null, 'macOS 14 上不该选 macOS 26 的包');
  assert.ok(pickSdcppAsset(newOnly, 'darwin', 'arm64', 'auto', 26.05), '系统够新就能选');

  const both = [{ name: 'sd-bin-Darwin-macOS-26.5.2-arm64.zip' }, { name: 'sd-bin-Darwin-macOS-13.0-arm64.zip' }];
  assert.equal(pickSdcppAsset(both, 'darwin', 'arm64', 'auto', 14.07).name, 'sd-bin-Darwin-macOS-13.0-arm64.zip', '挑跑得动的那个');

  // 不知道本机版本时不要瞎挡（比如测试环境）
  assert.ok(pickSdcppAsset(newOnly, 'darwin', 'arm64', 'auto', null));
  // 非 macOS 平台不受影响
  assert.ok(pickSdcppAsset([{ name: 'sd-bin-Linux-x86_64.zip' }], 'linux', 'x64'));
});
