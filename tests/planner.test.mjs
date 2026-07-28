import test from 'node:test';
import assert from 'node:assert/strict';
import {listPlanners, planStoryboard} from '../server/lib/planner.mjs';

test('规则规划器始终可用', async () => {
  assert.equal(listPlanners({})[0].configured, true);
  const board = await planStoryboard({text:'晨雾散开。宫门开启。'});
  assert.equal(board.planner, 'rules');
});

test('OpenAI 兼容规划器使用结构化镜头结果', async () => {
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body); assert.equal(request.response_format.type, 'json_object');
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({scenes:[{narration:'宫门开启。',shotType:'close',purpose:'突出开启瞬间'}]})}}]}), {status:200,headers:{'content-type':'application/json'}});
  };
  const board = await planStoryboard({planner:'openai-compatible',text:'宫门开启。'}, {env:{PAPERCUT_PLANNER_URL:'http://planner.test'},fetchImpl});
  assert.equal(board.scenes[0].shotType, 'close');
  assert.equal(board.scenes[0].purpose, '突出开启瞬间');
});
