import {buildStoryboard} from '../../shared/storyboard.mjs';

export const listPlanners = (env = process.env) => [
  {id: 'rules', name: '本地规则规划器', configured: true, description: '无需联网，可重复生成'},
  {id: 'openai-compatible', name: 'OpenAI 兼容规划器', configured: Boolean(env.OPENSHORTS_PLANNER_URL), description: '接入支持 Chat Completions JSON 输出的模型服务'},
];

// 分镜规则（源自对高播放短视频的拆解，三条硬规则）：
// 第一镜即主体、每 2-3 秒推进、结尾定格不总结——这三条直接写进提示词，规划出的分镜天然合规。
const planningPrompt = (input) => `请把以下中文口播文案规划为 1-12 个纸片分层动画镜头。只输出 JSON：{"scenes":[{"narration":"原文片段","shotType":"wide|medium|close","purpose":"镜头叙事目的"}]}。不得遗漏或改写事实。
分镜硬性规则：①第 1 镜直接进入核心画面/核心论点，禁止片头、问候或背景铺垫；②每个镜头承载的口播不超过 3 秒（约 25 字），长句拆多镜保持视觉推进；③最后一镜用画面/数字定格收尾，不做总结陈词。
标题：${input.title ?? ''}\n文案：${input.text ?? ''}\n角色：${input.characterBible ?? ''}`;

export const contentOf = (data) => data?.choices?.[0]?.message?.content ?? data?.output_text ?? data?.content;
export const parseModelJson = (content) => {
  if (typeof content === 'object' && content) return content;
  const text = String(content ?? '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(text);
};

export const planStoryboard = async (input, {env = process.env, fetchImpl = fetch} = {}) => {
  const planner = input.planner ?? 'rules';
  if (planner === 'rules') return buildStoryboard(input);
  if (planner !== 'openai-compatible') throw new Error(`未知分镜规划器：${planner}`);
  if (!env.OPENSHORTS_PLANNER_URL) throw new Error('未设置 OPENSHORTS_PLANNER_URL');
  const response = await fetchImpl(env.OPENSHORTS_PLANNER_URL, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...(env.OPENSHORTS_PLANNER_API_KEY ? {authorization: `Bearer ${env.OPENSHORTS_PLANNER_API_KEY}`} : {})},
    body: JSON.stringify({model: env.OPENSHORTS_PLANNER_MODEL ?? 'default', response_format: {type: 'json_object'}, messages: [{role: 'system', content: '你是视频分镜导演，只输出有效 JSON。'}, {role: 'user', content: planningPrompt(input)}]}),
  });
  if (!response.ok) throw new Error(`规划器请求失败：HTTP ${response.status}`);
  const planned = parseModelJson(contentOf(await response.json()));
  if (!Array.isArray(planned.scenes) || !planned.scenes.length) throw new Error('规划器未返回有效 scenes');
  return buildStoryboard({...input, scenePlan: planned.scenes, planner});
};
