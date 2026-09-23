import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'openshorts.mjs');
// 这些用例断言的是中文原话,必须**显式钉住语言**:CLI 现在跟随系统 locale,
// 而 CI runner 上 LANG=en_US.UTF-8 —— 不钉的话本机全绿、CI 全红(真栽过一次)。
const cli = (...args) => spawnSync(process.execPath, [bin, ...args],
  { encoding: 'utf-8', timeout: 30000, env: { ...process.env, OPENSHORTS_LANG: 'zh' } });

test('打错命令要 exit 1：脚本和 CI 不能把 rnu 当成功', () => {
  const r = cli('rnu');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /未知命令/);
});

test('help 是正常求助，exit 0', () => {
  const r = cli('help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /用法/);
});

test('run 指到不存在的文件：一句人话，不甩 ENOENT 堆栈', () => {
  const r = cli('run', '/绝对不存在/x.json');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /找不到项目文件/);
  assert.doesNotMatch(r.stderr, /at .*node:/, '不应有原始堆栈');
});

test('drama --help 不该需要 key：以前它一路透传给引擎，用户想看用法却被告知"缺少 API Key：文本供应商 deepseek"', () => {
  // 显式清掉所有文本模型 key，模拟新用户
  const env = { ...process.env, OPENSHORTS_LANG: 'zh' };
  for (const k of Object.keys(env)) if (/_API_KEY$/.test(k)) delete env[k];
  const r = spawnSync(process.execPath, [bin, 'drama', '--help'], { encoding: 'utf-8', timeout: 60000, env });
  assert.equal(r.status, 0, `--help 应当 exit 0，实际 ${r.status}：${r.stderr.slice(0, 160)}`);
  assert.match(r.stdout, /用法：openshorts drama/);
  assert.match(r.stdout, /--plan/); assert.match(r.stdout, /--validate/);
  assert.ok(!/API Key/i.test(r.stdout + r.stderr), '看用法不该提到 key');
  const en = spawnSync(process.execPath, [bin, 'drama', '-h'], { encoding: 'utf-8', timeout: 60000, env: { ...env, OPENSHORTS_LANG: 'en' } });
  assert.equal(en.status, 0); assert.match(en.stdout, /Usage: openshorts drama/);
  assert.ok(!/[\u4e00-\u9fff]/.test(en.stdout), '英文用法里不该有中文');
});

test('drama 默认用设置里选的文本模型：口播线早就这么做了，短剧线一直漏——选了别家却报"缺 deepseek 的 key"', async () => {
  const fs = await import('node:fs'); const os = await import('node:os');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'os-dramallm-'));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ text: { provider: 'ollama', model: 'qwen2.5:14b' } }));
  // 桩引擎：只把收到的参数打出来。只断言退出码的话，这条测试永远绿——证明不了参数真传下去了
  const ao = fs.mkdtempSync(path.join(os.tmpdir(), 'os-aostub-'));
  fs.mkdirSync(path.join(ao, 'dist'), { recursive: true }); fs.mkdirSync(path.join(ao, 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(ao, 'package.json'), '{"name":"stub","version":"0.0.0"}');
  fs.writeFileSync(path.join(ao, 'dist', 'cli.js'), 'console.log("ARGS " + JSON.stringify(process.argv.slice(2)));');
  const env = { ...process.env, OPENSHORTS_LANG: 'zh', OPENSHORTS_HOME: home, OPENSHORTS_AO_DIR: ao };
  const run = (...extra) => spawnSync(process.execPath, [bin, 'drama', '-i', 'story=x', ...extra], { encoding: 'utf-8', timeout: 60000, env });

  const args = JSON.parse(run().stdout.match(/ARGS (\[.*\])/)[1]);
  assert.deepEqual(args.slice(-4), ['-i', 'story=x', '--provider', 'ollama'].slice(0, 0).concat(['--provider', 'ollama', '--model', 'qwen2.5:14b']), `配置里的模型要带给引擎，实际：${JSON.stringify(args)}`);

  // 用户显式传了 --provider 就不覆盖他
  const explicit = JSON.parse(run('--provider', 'deepseek').stdout.match(/ARGS (\[.*\])/)[1]);
  assert.equal(explicit.filter((x) => x === '--provider').length, 1, `不该叠加两个 --provider：${JSON.stringify(explicit)}`);
  assert.ok(explicit.includes('deepseek') && !explicit.includes('ollama'));

  fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(ao, { recursive: true, force: true });
});
