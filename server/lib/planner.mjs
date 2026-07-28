import {buildStoryboard} from '../../shared/storyboard.mjs';

export const listPlanners = (env = process.env) => [
  {id: 'rules', name: '本地规则规划器', configured: true, description: '无需联网，可重复生成'},
  {id: 'openai-compatible', name: 'OpenAI 兼容规划器', configured: Boolean(env.PAPERCUT_PLANNER_URL), description: '接入支持 Chat Completions JSON 输出的模型服务'},
];

const planningPrompt = (input) => `请把以下中文口播文案规划为 1-12 个纸片分层动画镜头。只输出 JSON：{"scenes":[{"narration":"原文片段","shotType":"wide|medium|close","purpose":"镜头叙事目的"}]}。不得遗漏或改写事实。\n标题：${input.title ?? ''}\n文案：${input.text ?? ''}\n角色：${input.characterBible ?? ''}`;

const contentOf = (data) => data?.choices?.[0]?.message?.content ?? data?.output_text ?? data?.content;
const parseModelJson = (content) => {
  if (typeof content === 'object' && content) return content;
  const text = String(content ?? '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(text);
};

export const planStoryboard = async (input, {env = process.env, fetchImpl = fetch} = {}) => {
  const planner = input.planner ?? 'rules';
  if (planner === 'rules') return buildStoryboard(input);
  if (planner !== 'openai-compatible') throw new Error(`未知分镜规划器：${planner}`);
  if (!env.PAPERCUT_PLANNER_URL) throw new Error('未设置 PAPERCUT_PLANNER_URL');
  const response = await fetchImpl(env.PAPERCUT_PLANNER_URL, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...(env.PAPERCUT_PLANNER_API_KEY ? {authorization: `Bearer ${env.PAPERCUT_PLANNER_API_KEY}`} : {})},
    body: JSON.stringify({model: env.PAPERCUT_PLANNER_MODEL ?? 'default', response_format: {type: 'json_object'}, messages: [{role: 'system', content: '你是视频分镜导演，只输出有效 JSON。'}, {role: 'user', content: planningPrompt(input)}]}),
  });
  if (!response.ok) throw new Error(`规划器请求失败：HTTP ${response.status}`);
  const planned = parseModelJson(contentOf(await response.json()));
  if (!Array.isArray(planned.scenes) || !planned.scenes.length) throw new Error('规划器未返回有效 scenes');
  return buildStoryboard({...input, scenePlan: planned.scenes, planner});
};
