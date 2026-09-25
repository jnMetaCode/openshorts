import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'os-edit-'));
process.env.OPENSHORTS_HOME = HOME;
process.env.AO_DATA_DIR = path.join(HOME, '.ao');
process.env.FAKEP_API_KEY = 'k-123';
const { editImage } = await import('../src/characters/cloud-edit.mjs');
const cards = await import('../src/characters/cards.mjs');
const sc = await import('../src/scenes/scenes.mjs');
const providers = [{ id: 'fakep', envKey: 'FAKEP_API_KEY', defaultBaseUrl: 'https://img.example/v1/' }, { id: 'nokey', envKey: 'NOKEY_API_KEY', defaultBaseUrl: 'https://x/v1' }, { id: 'agnes', envKey: 'FAKEP_API_KEY', defaultBaseUrl: 'https://ag.example/v1' }];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0, 0, 0, 2, 0x40]);   // 1024×576
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0]);

// 假接口：记下收到的 multipart，按场景回 b64 / url / 错误
function fakeFetch(mode) {
  const seen = [];
  const f = async (url, init) => {
    seen.push({ url, init });
    if (url === 'https://cdn.example/out.png') return new Response(PNG);
    if (mode === 'b64') return Response.json({ data: [{ b64_json: JPG.toString('base64') }] });
    if (mode === 'url') return Response.json({ data: [{ url: 'https://cdn.example/out.png' }] });
    if (mode === '503') return new Response(JSON.stringify({ error: { message: 'no available server' } }), { status: 503 });
    if (mode === 'empty') return Response.json({ data: [] });
    throw new Error('ECONNRESET');
  };
  return Object.assign(f, { seen });
}

test('改图请求：打到 {base}/images/edits、带 key、一张图用 image、两张用 image[]', async () => {
  const f = fakeFetch('b64');
  const out = await editImage({ provider: 'fakep', model: 'm1', images: [PNG], prompt: '保脸换背景', fetchImpl: f, providers });
  assert.deepEqual(out, JPG);
  const { url, init } = f.seen[0];
  assert.equal(url, 'https://img.example/v1/images/edits', '末尾的 / 要去掉，不能拼成 //images');
  assert.equal(init.headers.Authorization, 'Bearer k-123');
  assert.equal(init.body.get('model'), 'm1'); assert.equal(init.body.get('prompt'), '保脸换背景');
  assert.ok(init.body.get('image')); assert.equal(init.body.getAll('image[]').length, 0);
  const f2 = fakeFetch('b64');
  await editImage({ provider: 'fakep', model: 'm1', images: [PNG, JPG], prompt: 'x', fetchImpl: f2, providers });
  assert.equal(f2.seen[0].init.body.getAll('image[]').length, 2);
  assert.equal(f2.seen[0].init.body.getAll('image[]')[1].type, 'image/jpeg', '第二张按字节头标类型');
});

test('返回链接就去取；失败原因原样透出（供应商原话、HTTP 码、没配 key、没返回图）', async () => {
  assert.deepEqual(await editImage({ provider: 'fakep', model: 'm', images: [PNG], prompt: 'x', fetchImpl: fakeFetch('url'), providers }), PNG);
  await assert.rejects(editImage({ provider: 'fakep', model: 'm', images: [PNG], prompt: 'x', fetchImpl: fakeFetch('503'), providers }), /edits HTTP 503: no available server.*generations HTTP 503/);
  await assert.rejects(editImage({ provider: 'fakep', model: 'm', images: [PNG], prompt: 'x', fetchImpl: fakeFetch('empty'), providers }), /no image in response/);
  await assert.rejects(editImage({ provider: 'fakep', model: 'm', images: [PNG], prompt: 'x', fetchImpl: fakeFetch('throw'), providers }), /fakep 改图失败.*ECONNRESET/);
  await assert.rejects(editImage({ provider: 'nokey', model: 'm', images: [PNG], prompt: 'x', fetchImpl: fakeFetch('b64'), providers, lang: 'en' }), /has no API key/);
});

test('保脸改图：要求按卡片改动自动生成；没改又没写要求就说清楚；新图带来源与计费', async () => {
  cards.saveCard({ name: '老周', basics: '55 岁男人', face: '圆脸，花白寸头，金丝眼镜', marks: ['右脸颊一颗黑痣'], outfit: '灰夹克', background: '' });
  cards.setUploadedPortrait('老周', PNG);
  assert.throws(() => cards.editInstruction(cards.readCard('老周')), /没改过/);
  cards.saveCard({ outfit: '白衬衫，袖子挽起' }, { id: '老周' });
  const ins = cards.editInstruction(cards.readCard('老周'));
  assert.match(ins, /保持同一个人/); assert.match(ins, /服装改成白衬衫，袖子挽起/);
  // 真机教训：要保的特征必须逐项点名，泛泛一句"同一个人"会把眼镜胡子改没
  assert.ok(ins.includes('金丝眼镜') && ins.includes('右脸颊一颗黑痣'), ins);
  assert.ok(cards.editInstruction(cards.readCard('老周'), { withScene: true }).includes('金丝眼镜'), '放进场景时也要点名');
  assert.ok(!/背景改成/.test(ins), '没改的字段不该出现在"只改"里');
  let got;
  const edit = async (a) => { got = a; return JPG; };
  const c = await cards.editPortraitCloud('老周', { edit, provider: 'fakep', model: 'm1' });
  assert.equal(got.images.length, 1); assert.deepEqual(got.images[0], PNG);
  assert.equal(got.size, '1344x768', '原定妆图 1024×576 是横版，改图也要按横版要尺寸（不给的话 Agnes 回方图）');
  assert.equal(c.portrait.source, 'cloud-edit'); assert.equal(c.portrait.provider, 'fakep'); assert.equal(c.portrait.cost.kind, 'paid');
  assert.match(c.portrait.file, /\.jpg$/);
  assert.equal(c.portrait.basedOn, c.history.at(-1).file);
  assert.equal(cards.portraitStale(c), false, '改完的图对应卡片当前字段');
  assert.equal(cards.portraitDrift(c), false, '按卡片改动自动写的要求：文字和图一致，不该报');
  // 自由描述改图：图变了、文字没变——要提醒；用户改了设定之后交给 stale
  const f = await cards.editPortraitCloud('老周', { edit, provider: 'fakep', model: 'm1', instruction: '外面套一件雨衣' });
  assert.equal(f.portrait.freeform, '外面套一件雨衣'); assert.equal(cards.portraitDrift(f), true);
  cards.saveCard({ outfit: '白衬衫外套深灰雨衣' }, { id: '老周' });
  // 照提示改完文字：两条提醒都该消失（不能刚改完又报"图是旧的"）
  const synced = cards.readCard('老周');
  assert.equal(cards.portraitDrift(synced), false); assert.equal(cards.portraitStale(synced), false); assert.equal(synced.portrait.freeform, undefined);
  // 再改一次文字：这回是真的改了设定，图该算旧的
  cards.saveCard({ outfit: '黑西装' }, { id: '老周' });
  assert.equal(cards.portraitStale(cards.readCard('老周')), true);
  // 没有定妆图不能改
  cards.saveCard({ name: '空白', basics: 'x' });
  await assert.rejects(cards.editPortraitCloud('空白', { edit }), /先出或上传/);
});

test('场景卡：必填、锁定段不带名字、本机出场景图不要人且是横版、放进场景时两张图都送', async () => {
  assert.throws(() => sc.saveScene({ name: '天台' }), /地点/);
  const s = sc.saveScene({ name: '旧天台', place: '老居民楼天台，晾衣绳，水箱', time: '傍晚，雨后，天边橙红' });
  const lock = sc.sceneLockText(s, 'zh');
  assert.ok(!lock.includes('旧天台')); assert.ok(lock.includes('水箱'));
  assert.equal(sc.storyWithScene(sc.storyWithScene('告别', s, 'zh'), s, 'zh').split('【场景已定').length, 2, '拼一次不再重复拼');
  const calls = [];
  const gen = async (prompt, o) => { calls.push({ prompt, ...o }); fs.writeFileSync(o.out, PNG); return { model: 'flux-schnell-q2' }; };
  const r = await sc.renderScene(s.id, { gen, chat: async () => 'rooftop, water tank, dusk' });
  assert.deepEqual([calls[0].width, calls[0].height], [1152, 640]);
  assert.match(calls[0].prompt, /no people/);
  assert.equal(r.image.translated, true);
  sc.saveScene({ details: '一把旧藤椅' }, { id: s.id });
  assert.equal(sc.sceneStale(sc.readScene(s.id)), true);
  assert.equal(sc.readScene(s.id).place, s.place, '只改细节不能把地点清空');
  // 人放进场景：两张图都送，要求里说明
  let got;
  const c = await cards.editPortraitCloud('老周', { edit: async (a) => { got = a; return PNG; }, provider: 'fakep', model: 'm1', sceneImage: fs.readFileSync(sc.sceneImagePath(sc.readScene(s.id))), sceneRef: { id: s.id, file: r.image.file } });
  assert.equal(got.images.length, 2);
  assert.match(got.prompt, /放进第二张图的场景/);
  assert.deepEqual(c.portrait.scene, { id: s.id, file: r.image.file });
  assert.equal(c.portrait.ratio, '16:9', '从 PNG 头读出 1024×576');
});

test('Agnes 这类先走 generations + image（data URL 数组、宽x高尺寸）；挂了换 edits；401 不再白打第二次', async () => {
  const seen = [];
  const f = async (url, init) => {
    seen.push({ url, init });
    if (url.endsWith('/images/generations')) return new Response(JSON.stringify({ error: { message: 'upstream busy' } }), { status: 500 });
    return Response.json({ data: [{ b64_json: '', url: 'https://cdn.example/out.png' }] });   // 真机 Agnes：b64_json 是空串、给 url
  };
  const g = async (u, i) => (u === 'https://cdn.example/out.png' ? new Response(PNG) : f(u, i));
  const out = await editImage({ provider: 'agnes', model: 'agnes-image-2.5-flash', images: [PNG, JPG], prompt: '放进场景', size: '1344x768', fetchImpl: g, providers });
  assert.deepEqual(out, PNG);
  assert.equal(seen[0].url, 'https://ag.example/v1/images/generations');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.size, '1344x768');
  assert.equal(body.image.length, 2); assert.match(body.image[0], /^data:image\/png;base64,/); assert.match(body.image[1], /^data:image\/jpeg;base64,/);
  assert.equal(seen[1].url, 'https://ag.example/v1/images/edits', 'generations 挂了要换 edits');
  // key 不对：换接口也没用
  const n = []; const deny = async (u) => { n.push(u); return new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 }); };
  await assert.rejects(editImage({ provider: 'agnes', model: 'm', images: [PNG], prompt: 'x', fetchImpl: deny, providers }), /401: invalid api key/);
  assert.equal(n.length, 1);
});
