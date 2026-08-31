/**
 * 口播线项目 JSON（架构 §2）：由 AO 跑完「口播科普」模板的结果（segments_json / meta_json）构建。
 * 镜头 = 钩子 + 各段 + 收尾；每镜先只带文案与画面意图，画面/配音/字幕由 run 阶段填。纯函数。
 */
export function parseJsonLoose(text) {
  if (!text) throw new Error('空输出');
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('输出里没有 JSON 对象');
  return JSON.parse(m[0]);
}

export function buildKouboProject(aoResult, { id, topic, inputs = {}, output = { w: 1080, h: 1920, fps: 30, platform: 'douyin' }, defaults = {} } = {}) {
  const step = (sid) => aoResult.steps?.find((s) => s.id === sid);
  const script = parseJsonLoose(step('script')?.output);
  let meta = {}; try { meta = parseJsonLoose(step('meta')?.output); } catch { meta = {}; }
  const segs = Array.isArray(script.segments) ? script.segments : [];
  if (!segs.length) throw new Error('脚本没有 segments');
  const shots = [];
  const src = defaults.visualSource === 'solid' ? 'solid' : null;   // 用户选"只用纯色底"时镜头直接标 solid，run 阶段不去找素材
  if (script.hook) shots.push(shot('hook', script.hook, segs[0]?.visualIntent ?? '', segs[0]?.query ?? '', segs[0]?.emphasis ?? [], src, segs[0]?.imagePrompt));
  for (const s of segs) shots.push(shot(safeId(s.id, shots.length + 1), s.text, s.visualIntent, s.query, s.emphasis ?? [], src, s.imagePrompt));
  if (script.outro) shots.push(shot('outro', script.outro, segs[segs.length - 1]?.visualIntent ?? '', segs[segs.length - 1]?.query ?? '', [], src, segs[segs.length - 1]?.imagePrompt));
  return {
    schemaVersion: 2,
    id: id ?? slug(topic ?? aoResult.name ?? 'koubo'),
    template: 'koubo-kepu', line: 'koubo',
    title: (meta.titles ?? [])[0] ?? topic ?? '',
    topic: topic ?? inputs.topic ?? '',
    inputs,
    output,
    voice: { provider: 'edge-tts', voice: defaults.voice ?? 'zh-CN-XiaoxiaoNeural', rate: 1.0 },
    captions: { preset: defaults.captionPreset ?? 'douyin', maxChars: 16 },
    defaults: { visualSource: defaults.visualSource ?? 'stock', cutEverySec: defaults.cutEverySec ?? 4, localDirs: defaults.localDirs ?? [] },
    bgm: defaults.bgm ? { file: defaults.bgm, volume: 0.2 } : null,
    shots,
    publish: { titles: meta.titles ?? [], tags: meta.tags ?? [], note: meta.publishNote ?? '', aiLabel: true, aiLabelText: meta.aiLabel ?? '本视频含 AI 生成内容' },
    provenance: [],
    ao: { file: aoResult.file ?? null, success: !!aoResult.success, totalTokens: aoResult.totalTokens ?? null },
  };
}
/** 镜头 id 会直接拼成文件名（work/<id>.mp3 等），而它来自模型输出——不能原样信 */
const safeId = (id, i) => String(id ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || `s${i}`;
// imagePrompt 单独存一份：query 是给素材库按关键词检索用的（越短越好），
// 而落到本机文生图的恰恰是那些 query 太弱、检索不到的镜头——拿检索词去画画，画出来的就是关键词堆
const shot = (id, text, visualIntent, query, emphasis, source = null, imagePrompt = '') => ({ id, text: String(text ?? '').trim(), visualIntent: visualIntent ?? '', query: query ?? '', imagePrompt: String(imagePrompt ?? '').trim(), emphasis: Array.isArray(emphasis) ? emphasis : [], visual: { source, provider: null, file: null, candidateId: null, cost: { kind: 'free' } }, audio: null, durationSec: null, status: 'planned' });
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'koubo';
