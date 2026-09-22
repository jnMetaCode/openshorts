import test from 'node:test';
import assert from 'node:assert/strict';
import { ollamaStatus, ollamaBaseUrl } from '../src/local/ollama.mjs';

// 照着真机 `GET /api/tags` 的样子：聊天模型和嵌入模型混着、大小不一、顺序是安装时间不是大小
const TAGS = { models: [
  { name: 'bge-m3:latest', size: 1_200_000_000, details: { family: 'bert' } },
  { name: 'llama3:latest', size: 4_661_000_000, details: { family: 'llama' } },
  { name: 'mxbai-embed-large:latest', size: 669_000_000, details: { family: 'bert' } },
  { name: 'qwen2.5:14b', size: 8_988_000_000, details: { family: 'qwen2' } },
  { name: 'qwen2.5-coder:7b', size: 4_683_000_000, details: { family: 'qwen2' } },
  { name: 'qwen2.5vl:3b', size: 3_200_000_000, details: { family: 'qwen25vl' } },
  { name: 'llava:7b', size: 4_700_000_000, details: { family: 'llama' } },
] };
const ok = (body) => async () => ({ ok: true, json: async () => body });

test('嵌入模型不进下拉（选了它写脚本会直接报错）；大模型排前面', async () => {
  const s = await ollamaStatus({ fetchImpl: ok(TAGS), env: {} });
  assert.equal(s.running, true);
  assert.deepEqual(s.models, ['qwen2.5:14b', 'llava:7b', 'qwen2.5-coder:7b', 'llama3:latest', 'qwen2.5vl:3b']);
  assert.deepEqual(s.visionModels, ['llava:7b', 'qwen2.5vl:3b'], '看图把关只列能看图的；纯文本模型选了等于没开');
});

test('没在跑 / 回了错误码：running=false 并带原因，不抛', async () => {
  const down = await ollamaStatus({ fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }, env: {} });
  assert.deepEqual([down.running, down.models, down.reason], [false, [], 'ECONNREFUSED']);
  const bad = await ollamaStatus({ fetchImpl: async () => ({ ok: false, status: 502 }), env: {} });
  assert.equal(bad.running, false); assert.match(bad.reason, /502/);
});

test('地址规则与 Ollama 自己一致：OLLAMA_HOST 常常不带协议；BASE_URL 优先；去尾斜杠', async () => {
  assert.equal(ollamaBaseUrl({}), 'http://localhost:11434');
  assert.equal(ollamaBaseUrl({ OLLAMA_HOST: '0.0.0.0:11500' }), 'http://0.0.0.0:11500');
  assert.equal(ollamaBaseUrl({ OLLAMA_HOST: 'x:1', OLLAMA_BASE_URL: 'https://gpu-box.lan:11434/' }), 'https://gpu-box.lan:11434');
  let asked = ''; await ollamaStatus({ fetchImpl: async (u) => { asked = u; return { ok: true, json: async () => ({}) }; }, env: { OLLAMA_HOST: '127.0.0.1:9' } });
  assert.equal(asked, 'http://127.0.0.1:9/api/tags');
});
