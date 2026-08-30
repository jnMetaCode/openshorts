import test from 'node:test';
import assert from 'node:assert/strict';
// 服务端模块必须能整体加载（曾有一次提交引用了不存在的文件，main 坏了几分钟——这条在 CI 里兜底）
test('server/kaipian.mjs 与全部 src 模块可加载', async () => {
  const mods = ['../server/kaipian.mjs', '../src/config.mjs', '../src/sources/availability.mjs', '../src/sources/stock.mjs', '../src/voice/edge-tts.mjs', '../src/captions/build.mjs', '../src/compose/koubo.mjs', '../src/project/koubo.mjs', '../src/pipeline/koubo-run.mjs', '../src/core/ao-result.mjs', '../src/quality/check.mjs', '../src/doctor.mjs', '../src/local/download.mjs', '../src/input/url-text.mjs', '../src/publish/pack.mjs', '../src/pipeline/batch.mjs'];
  for (const m of mods) { const mod = await import(m); assert.ok(mod, m); }
});
