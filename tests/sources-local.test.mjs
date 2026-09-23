import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 本机出片的"就绪"要和引擎出片时用的判断同源：真机上 H3 的文本编码器被删、软链断了，
// 体检照样 ✅，同一屏 AO 却说模型未齐。
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'os-srclocal-'));
process.env.OPENSHORTS_HOME = HOME;
delete process.env.OPENSHORTS_SD_CLI; delete process.env.AO_SD_CLI; delete process.env.AO_SD_MODELS; delete process.env.OPENSHORTS_SD_MODELS;
fs.mkdirSync(path.join(HOME, 'bin'), { recursive: true });
fs.writeFileSync(path.join(HOME, 'bin', 'sd-cli'), '#!/bin/sh\n', { mode: 0o755 });
const models = path.join(HOME, 'models');
fs.mkdirSync(models);
const { sourcesAvailability } = await import('../src/sources/availability.mjs');
const memGB = Math.round(os.totalmem() / 1024 ** 3);

// 不整齐的状态：Q4 文件齐但内存不够、Q2 能跑但缺一个——不能被 Q4 的"齐"骗成就绪
const st = (q2Missing) => ({ modelsDir: '/m', memGB: 32, models: [
  { id: 'minimax-h3-q2', usable: true, present: q2Missing.length === 0, missing: q2Missing },
  { id: 'minimax-h3-q4', usable: false, present: true, missing: [] },
] });

test('能跑的档缺文件：不就绪，并点名缺的文件（中英）', { skip: memGB < 24 && '本机内存不够 24 GB，本地档不参与' }, async () => {
  const zh = await sourcesAvailability({ sdcpp: st(['qwen3vl_32b_minimax_h3-Q2_K_M.gguf']) });
  assert.equal(zh.local.ok, false);
  assert.match(zh.local.reason, /qwen3vl_32b_minimax_h3-Q2_K_M\.gguf/);
  const en = await sourcesAvailability({ lang: 'en', sdcpp: st(['qwen3vl_32b_minimax_h3-Q2_K_M.gguf']) });
  assert.match(en.local.reason, /^models incomplete .*qwen3vl/);
  const ok = await sourcesAvailability({ sdcpp: st([]) });
  assert.equal(ok.local.ok, true);
});

test('查不了引擎：不就绪，原因带出来', { skip: memGB < 24 && '本机内存不够 24 GB' }, async () => {
  const a = await sourcesAvailability({ sdcpp: { error: 'Cannot find module local-sdcpp.js' } });
  assert.equal(a.local.ok, false);
  assert.match(a.local.reason, /Cannot find module/);
});

test('不注入时真去问引擎：断掉的软链算缺', async () => {
  fs.symlinkSync(path.join(HOME, 'gone.gguf'), path.join(models, 'qwen3vl_32b_minimax_h3-Q2_K_M.gguf'));
  const a = await sourcesAvailability();
  assert.equal(a.local.ok, false);
  if (memGB >= 24) assert.match(a.local.reason, /qwen3vl_32b_minimax_h3-Q2_K_M\.gguf/);
});
