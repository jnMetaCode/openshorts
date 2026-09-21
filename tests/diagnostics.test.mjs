import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 「复制诊断信息」会被用户原样贴到公开的 issue 里——这里守的是"贴出去的文本里不能有任何一把 key"。
 * 输入故意不整齐：界面存的 key、环境变量里的 key、素材库 key、报错原文里回显的 key、没登记过但长得像 key 的串。
 */
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'os-diag-'));
process.env.OPENSHORTS_HOME = path.join(home, '.openshorts');
process.env.AO_DATA_DIR = path.join(home, '.ao');
const SAVED = 'zp-7f3a9c.saved-in-ui-ABCDEFGH', ENVK = 'ms_env_only_key_1234567890', PEX = 'pexels563492ad6f91700001000001', STRAY = 'sk-proj-Zx81kQpLmN0923aBcDeF';
fs.mkdirSync(path.join(home, '.ao', '.local'), { recursive: true });
fs.writeFileSync(path.join(home, '.ao', '.local', 'web-keys.json'), JSON.stringify({ zhipu: { apiKey: SAVED }, empty: { apiKey: '' } }));
process.env.MOONSHOT_API_KEY = ENVK;

const { writeConfig } = await import('../src/config.mjs');
writeConfig({ outputDir: path.join(os.homedir(), 'OpenShorts'), stock: { pexelsKey: PEX, pixabayKey: '' }, text: { provider: 'zhipu', model: 'glm-4-flash' } });
const { collectDiagnostics, redact, installMode } = await import('../src/diagnostics.mjs');
test.after(() => { delete process.env.MOONSHOT_API_KEY; fs.rmSync(home, { recursive: true, force: true }); });

const fakeDoctor = async () => [{ status: 'ok', msg: `ffmpeg 就绪（${path.join(os.homedir(), '.openshorts', 'bin')}）` }, { status: 'fail', msg: '缺 libass' }];

test('诊断文本里一把 key 都不能有：界面存的 / 环境变量的 / 素材库的 / 报错里回显的 / 没登记过的', async () => {
  const lastError = `API error 401: invalid key ${SAVED}\n  Authorization: Bearer ${ENVK}\n  另一把没登记过的 ${STRAY}，文件在 ${path.join(os.homedir(), 'OpenShorts', '猫', 'project.json')}`;
  const text = await collectDiagnostics({ lastError, doctorFn: fakeDoctor });
  for (const secret of [SAVED, ENVK, PEX, STRAY]) assert.ok(!text.includes(secret), `泄露了 ${secret.slice(0, 6)}…`);
  assert.ok(!text.includes(os.homedir()), '家目录（常带真名）要换成 ~');
  // 打码不能把有用的信息一起抹掉
  assert.match(text, /keys saved for: zhipu\b/); assert.ok(!/keys saved for:.*empty/.test(text), '空 key 不算配了');
  assert.match(text, /keys from env: MOONSHOT_API_KEY/); assert.match(text, /stock: pexels/);
  assert.match(text, /script model: zhipu \/ glm-4-flash/); assert.match(text, /API error 401/);
  assert.match(text, /OpenShorts \d+\.\d+\.\d+/); assert.match(text, /agency-orchestrator\) \d+\.\d+\.\d+/, '引擎版本要真取到，不是 ?');
  assert.match(text, /⛔ 缺 libass/);
});

test('redact：短串不当 key 抹（否则 "ok" 这种值会把全文抹花）；长的先抹，避免留下半截', () => {
  assert.equal(redact('status ok, token abcdefgh-long', { secrets: ['ok', 'abcdefgh', 'abcdefgh-long'], home: '' }), 'status ok, token ***');
});

test('installMode：桌面包 / Docker / npm / 源码', () => {
  const no = () => false;
  assert.equal(installMode({ env: { ELECTRON_RUN_AS_NODE: '1' }, versions: {}, rootDir: '/x', exists: no }), 'desktop');
  assert.equal(installMode({ env: {}, versions: {}, rootDir: '/app', exists: (f) => f === '/.dockerenv' }), 'docker');
  assert.equal(installMode({ env: {}, versions: {}, rootDir: '/Users/a/.npm/_npx/1f2e/node_modules/openshorts', exists: no }), 'npm');
  assert.equal(installMode({ env: {}, versions: {}, rootDir: 'C:\\Users\\a\\AppData\\npm-cache\\_npx\\9\\node_modules\\openshorts', exists: no }), 'npm');
  assert.equal(installMode({ env: {}, versions: {}, rootDir: '/src/openshorts', exists: (f) => f.endsWith('.git') }), 'source');
});
