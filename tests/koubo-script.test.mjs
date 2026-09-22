import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKoubo } from '../src/pipeline/koubo-script.mjs';
import { scriptLength } from '../src/project/koubo.mjs';

/**
 * 长度门槛的自动重写。模板里把字数区间写得再清楚，模型也是时灵时不灵
 * （真机同一话题两次分别 278 / 183 字）——以前只报一条警告，这里验证它真的会重写。
 * runFn 注入假的 AO run：不花 token，也不依赖网络。
 */

// 60秒 目标 → 合格区间约 237–302 字（60×4.5×(1±12%)）
const makeResult = (totalChars) => {
  const hook = '钩'.repeat(20), outro = '尾'.repeat(20);
  const body = '正'.repeat(Math.max(totalChars - 40, 1));
  return { name: '口播科普', success: true, steps: [
    { id: 'script', status: 'completed', output: JSON.stringify({ hook, segments: [{ id: 's1', text: body, visualIntent: '画面', query: 'cat close up', emphasis: [] }], outro }) },
    { id: 'meta', status: 'completed', output: '{"titles":["T1"],"tags":["科普"],"publishNote":"n","aiLabel":"AI"}' },
  ] };
};
const inputs = { topic: '猫为什么爱钻纸箱', duration: '60秒', tone: '科普讲解' };

test('脚本太短会带着量化反馈自动重写一次', async () => {
  const calls = [];
  const runFn = async (_wf, attemptInputs) => { calls.push(attemptInputs); return calls.length === 1 ? makeResult(120) : makeResult(270); };
  const logs = [];
  const g = await generateKoubo({ wf: 'x.yaml', inputs, runFn, log: (m) => logs.push(m) });
  assert.equal(g.ok, true);
  assert.equal(g.attempts, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].topic, inputs.topic, '第一次用原始话题');
  assert.match(calls[1].topic, /退回/, '第二次话题里带上退回原因');
  assert.match(calls[1].topic, /243–297|243-297/, '反馈里有量化的目标区间');
  assert.equal(g.project.topic, inputs.topic, '项目 topic 保持原始话题，不带反馈文案');
  assert.equal(g.project.scriptWarnings.filter((w) => w.includes('目标')).length, 0, '重写后的脚本不再有长度警告');
  assert.equal(logs.length, 1, '重写这件事要让用户看见');
});

test('长度合格就不重写，只跑一次', async () => {
  let n = 0;
  const g = await generateKoubo({ wf: 'x.yaml', inputs, runFn: async () => { n++; return makeResult(270); } });
  assert.equal(g.ok, true); assert.equal(g.attempts, 1); assert.equal(n, 1);
});

test('JSON 写坏也自动重跑一次；第二次好了就正常返回', async () => {
  let n = 0;
  const bad = { name: '口播科普', success: true, steps: [{ id: 'script', status: 'completed', output: '{"hook":"只有钩子没有别的"' }] };
  const g = await generateKoubo({ wf: 'x.yaml', inputs, runFn: async () => { n++; return n === 1 ? bad : makeResult(270); } });
  assert.equal(g.ok, true); assert.equal(n, 2);
});

test('重写一次仍太短、也没有可扩写的模型：不再无限重试，项目带着说真话的长度警告返回', async () => {
  let n = 0;
  const g = await generateKoubo({ wf: 'x.yaml', inputs, chatFn: null, runFn: async () => { n++; return makeResult(120); } });
  assert.equal(g.ok, true); assert.equal(n, 2, '最多两次——每次都花真 token');
  const w = g.project.scriptWarnings.find((x) => x.includes('目标'));
  assert.ok(w, '还是短就把警告留给用户');
  assert.ok(!w.includes('重新生成一次通常就对了'), '已经重写过了，不能再说"重新生成一次通常就对了"');
  assert.match(w, /已自动重写 2 次/);
});

test('留最好的一稿，不是最后的一稿（真机：重写后 114 → 110 字反而更差）', async () => {
  let n = 0;
  const g = await generateKoubo({ wf: 'x.yaml', inputs, chatFn: null, runFn: async () => { n++; return makeResult(n === 1 ? 200 : 120); } });
  assert.equal(scriptLength(g.project.shots), 200, '200 字离 243 更近，留它');
});

test('从零重写救不回来 → 扩写现有稿：只改文字、保留 id / 画面意图 / 检索词、明说不要编数字；落进区间就用它', async () => {
  const chats = [];
  const chatFn = async (system, user) => {
    chats.push(user);
    const draft = JSON.parse(user.slice(user.indexOf('{')));
    // 照小模型的样子：每段多说几句
    return JSON.stringify({ hook: draft.hook + '钩'.repeat(30), segments: draft.segments.map((x) => ({ id: x.id, text: x.text + '补'.repeat(100) })), outro: draft.outro + '尾'.repeat(20) });
  };
  const logs = [];
  const g = await generateKoubo({ wf: 'x.yaml', inputs, chatFn, log: (m) => logs.push(m), runFn: async () => makeResult(120) });
  assert.equal(chats.length, 1); assert.match(chats[0], /不要编造数字/); assert.match(chats[0], /243–297/); assert.match(chats[0], /增加约 150 个字/, "算好要加多少（120 → 中点 270）");
  assert.equal(scriptLength(g.project.shots), 270); assert.equal(g.attempts, 3);
  assert.equal(g.project.scriptWarnings.filter((w) => w.includes('目标')).length, 0);
  const s1 = g.project.shots.find((x) => x.id === 's1');
  assert.equal(s1.query, 'cat close up', '扩写只动文字，检索词原样');
  assert.ok(logs.some((m) => m.includes('扩写')), '扩写这件事要让用户看见');
});

test('扩写回来的是垃圾 / 太长：不炸，留最接近的一稿；太长时要求的是精简', async () => {
  const g = await generateKoubo({ wf: 'x.yaml', inputs, chatFn: async () => 'sorry, no json here', runFn: async () => makeResult(120) });
  assert.equal(g.ok, true); assert.equal(scriptLength(g.project.shots), 120);
  const asked = [];
  const g2 = await generateKoubo({ wf: 'x.yaml', inputs, chatFn: async (_s, u) => { asked.push(u); return '{}'; }, runFn: async () => makeResult(400) });
  assert.match(asked[0], /删去约 130 个字/, "太长时要求删去、并算好数量（400 → 区间中点 270）"); assert.equal(scriptLength(g2.project.shots), 400);
  assert.equal(asked.length, 2, '扩写最多两轮');
});

test('AO 步骤失败原样交回，不重试', async () => {
  let n = 0;
  const g = await generateKoubo({ wf: 'x.yaml', inputs, runFn: async () => { n++; return { success: false, steps: [{ id: 'script', status: 'failed', error: '无 key' }] }; } });
  assert.equal(g.ok, false); assert.equal(g.kind, 'run'); assert.equal(n, 1, '失败通常是 key/网络，重试只会再报一遍');
});
