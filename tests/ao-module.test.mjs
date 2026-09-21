import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aoModuleUrl, importAo } from '../src/core/ao-module.mjs';

/**
 * Windows 上 `import('D:\\…')` 会抛 ERR_UNSUPPORTED_ESM_URL_SCHEME；macOS / Linux 上裸路径恰好能用，
 * 所以这个 bug 在开发机上永远撞不到——只能靠"不管在哪个平台，交给 import() 的必须是 file:// URL"来守。
 */
test('aoModuleUrl：交给 import() 的一定是 file:// URL，不是裸路径', () => {
  const u = aoModuleUrl(['connectors', 'api-providers.js']);
  assert.match(u, /^file:\/\/\//);
  assert.ok(u.endsWith('/connectors/api-providers.js'));
});

test('aoModuleUrl：Windows 盘符路径也得出合法的 file:// URL（真机漏掉的就是这个样本）', { skip: process.platform !== 'win32' && '盘符路径只有在 Windows 上 pathToFileURL 才按盘符解析' }, () => {
  const u = aoModuleUrl(['utils', 'env-proxy.js']);
  assert.match(u, /^file:\/\/\/[A-Za-z]:\//);
});

test('importAo：开片用到的 AO 内部模块全都取得到（AO 挪了文件这里先红，而不是用户那里静默失效）', async () => {
  assert.ok(Array.isArray((await importAo('connectors', 'api-providers.js')).API_PROVIDERS));
  assert.equal(typeof (await importAo('connectors', 'tts.js')).generateSpeech, 'function');
  assert.equal(typeof (await importAo('utils', 'env-proxy.js')).installEnvProxy, 'function');
  assert.equal(typeof (await importAo('connectors', 'local-sdcpp.js')).sdcppPaths, 'function');
});

test('仓库里不许再出现"把拼出来的路径直接交给 import()"', async () => {
  const fs = await import('node:fs');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const bad = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) { if (!/node_modules|release|dist/.test(e.name)) walk(f); continue; }
    if (!/\.(mjs|cjs|js)$/.test(e.name)) continue;
    fs.readFileSync(f, 'utf-8').split('\n').forEach((line, i) => { if (/\bimport\(\s*path\.(join|resolve)\(/.test(line)) bad.push(`${path.relative(root, f)}:${i + 1}`); });
  } };
  for (const d of ['server', 'src', 'bin', 'scripts', 'desktop']) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
  assert.deepEqual(bad, [], '用 src/core/ao-module.mjs 的 importAo，或先 pathToFileURL');
});
