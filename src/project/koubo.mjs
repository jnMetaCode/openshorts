import fsSync from 'node:fs';
import pathSync from 'node:path';
/**
 * 口播线项目 JSON（架构 §2）：由 AO 跑完「口播科普」模板的结果（segments_json / meta_json）构建。
 * 镜头 = 钩子 + 各段 + 收尾；每镜先只带文案与画面意图，画面/配音/字幕由 run 阶段填。纯函数。
 */
/**
 * 修模型常犯的一种 JSON 破损：**字符串值里夹了没转义的英文双引号**。
 * 真机原话：`"hook": "洋葱根本不是故意让你流泪的——它只是在"报警"。"` —— 整条 new 直接崩掉，
 * 脚本白写、token 白花。
 *
 * 判断办法：在字符串内部遇到 `"` 时往后看第一个非空白字符，是 `,` `:` `}` `]` 或结尾才算真正的收尾引号，
 * 否则就是句子里的引号，补一个反斜杠。只处理这一类，不做通用的"猜你想写什么"。
 */
export function repairJson(text) {
  const s = String(text);
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { out += c; esc = false; continue; }
    if (c === '\\') { out += c; esc = true; continue; }
    if (c !== '"') { out += c; continue; }
    if (!inStr) { inStr = true; out += c; continue; }
    let j = i + 1; while (j < s.length && /\s/.test(s[j])) j++;
    if (j >= s.length || ',:}]'.includes(s[j])) { inStr = false; out += c; }
    else out += '\\"';                       // 句子里的引号，转义掉
  }
  return out;
}

export function parseJsonLoose(text) {
  if (!text) throw new Error('空输出');
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('输出里没有 JSON 对象');
  try { return JSON.parse(m[0]); }
  catch (e) {
    try { return JSON.parse(repairJson(m[0])); }
    catch { throw new Error(`模型返回的 JSON 解析不了：${e.message}`); }
  }
}

export function buildKouboProject(aoResult, { id, topic, inputs = {}, output = { w: 1080, h: 1920, fps: 30, platform: 'douyin' }, defaults = {} } = {}) {
  const step = (sid) => aoResult.steps?.find((s) => s.id === sid);
  const script = parseJsonLoose(step('script')?.output);
  // meta 失败以前是默默吞掉的：用户拿到一条没有标题、没有话题、没有发布说明的片子，一句提示都没有。
  // 真机上就这么空过一次（推理模型把 token 预算全花在思考上，可见内容返回 0 字符）。
  let meta = {}; let metaError = null;
  try { meta = parseJsonLoose(step('meta')?.output); }
  catch (e) { metaError = step('meta')?.output ? `解析失败：${e.message}` : '模型没有返回内容（推理模型可能把 token 预算用在思考上了，可调大模板里的 max_tokens）'; }
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
    publish: { titles: meta.titles ?? [], tags: meta.tags ?? [], note: meta.publishNote ?? '', aiLabel: true, aiLabelText: meta.aiLabel ?? '本视频含 AI 生成内容',
      ...(metaError ? { error: `标题/话题/发布说明没生成（${metaError}）——片子照常能出，发布信息要自己填` } : {}) },
    provenance: [],
    ao: { file: aoResult.file ?? null, success: !!aoResult.success, totalTokens: aoResult.totalTokens ?? null },
  };
}
/** 镜头 id 会直接拼成文件名（work/<id>.mp3 等），而它来自模型输出——不能原样信 */
const safeId = (id, i) => String(id ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || `s${i}`;
// imagePrompt 单独存一份：query 是给素材库按关键词检索用的（越短越好），
// 而落到本机文生图的恰恰是那些 query 太弱、检索不到的镜头——拿检索词去画画，画出来的就是关键词堆
const shot = (id, text, visualIntent, query, emphasis, source = null, imagePrompt = '') => ({ id, text: String(text ?? '').trim(), visualIntent: visualIntent ?? '', query: query ?? '', imagePrompt: String(imagePrompt ?? '').trim(), emphasis: Array.isArray(emphasis) ? emphasis : [], visual: { source, provider: null, file: null, candidateId: null, cost: { kind: 'free' } }, audio: null, durationSec: null, status: 'planned' });
/**
 * 目录没被占就用干净的 id；被**别的**项目占了就加时间戳。
 * 不加这一层的话，同一个话题跑第二次会直接覆盖前一个项目——连出好的成片一起没了。
 * （短剧线的 id 本来就带时间戳，口播线一直漏着。）
 */
export function uniqueProjectId(outputDir, id, fsImpl) {
  const fsm = fsImpl ?? fsSync;
  // new 每次都是重新写的脚本，即使话题一样也是另一条片子——目录被占就换一个，不覆盖
  if (!fsm.existsSync(pathSync.join(outputDir, id, 'project.json'))) return id;
  const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '');
  return `${id}-${stamp}`;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'koubo';
