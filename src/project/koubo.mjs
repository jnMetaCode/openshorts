import fsSync from 'node:fs';
import pathSync from 'node:path';
import { langSpec, normLang, textLength } from './lang.mjs';
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

export function buildKouboProject(aoResult, { id, topic, inputs = {}, output = { w: 1080, h: 1920, fps: 30, platform: 'douyin' }, defaults = {}, lang = 'zh' } = {}) {
  const L = normLang(lang); const spec = langSpec(L);
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
    // 模板名跟着语言走：英文项目标成 koubo-kepu 的话，事后查"这条片是哪个模板出的"会查错
    template: spec.template.replace(/\.yaml$/, ''), line: 'koubo', lang: L,
    title: (meta.titles ?? [])[0] ?? topic ?? '',
    topic: topic ?? inputs.topic ?? '',
    inputs,
    output,
    voice: { provider: 'edge-tts', voice: defaults.voice ?? spec.voice, rate: 1.0 },
    captions: { preset: defaults.captionPreset ?? 'douyin', maxChars: defaults.captionMaxChars ?? spec.captionMaxChars, style: defaults.captionStyle ?? {} },
    defaults: { visualSource: defaults.visualSource ?? 'stock', cutEverySec: defaults.cutEverySec ?? 4, localDirs: defaults.localDirs ?? [] },
    bgm: defaults.bgm ? { file: defaults.bgm, volume: 0.2 } : null,
    shots,
    publish: { titles: meta.titles ?? [], tags: meta.tags ?? [], note: meta.publishNote ?? '', aiLabel: true, aiLabelText: meta.aiLabel ?? (L === 'en' ? 'This video contains AI-generated content' : '本视频含 AI 生成内容'),
      ...(metaError ? { error: `标题/话题/发布说明没生成（${metaError}）——片子照常能出，发布信息要自己填` } : {}) },
    provenance: [],
    scriptWarnings: scriptWarnings(shots, inputs.duration, L),
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

/**
 * 口播文本的可朗读检查。模型偶尔会把英文单词当中文词用（真机：「次磺酸又迅速 rearrange」、
 * 「学名叫 petrichor」），Edge TTS 会照着念出一个英文词，字幕上也是一串拉丁字母——
 * 中文科普片里很出戏。缩写除外：AI / DNA / CT 这类本来就念字母，中文里也这么说。
 */
/**
 * 脚本长度对不对得上目标时长。模板里写了字数区间，但模型**时灵时不灵**——
 * 真机同一个话题两次生成分别是 278 字（落在 60 秒的 243–297 区间内）和 183 字（短 32%）。
 * 提示词管不住的事，至少不能让它悄悄过去：写少了成片就是比你要的短一大截。
 */
// Edge TTS 实测语速。三处按它算：这里的门槛、koubo-script 的重写反馈、
// 模板 yaml 里手写的字数/词数区间（yaml 是文本导不了常量，改这里要同步模板文案）。
// 语速本身在 lang.mjs 的 LANG_SPEC 里（中文 4.5 字/秒、英文 2.9 词/秒，都是本机实测）。
export const CHARS_PER_SEC = 4.5;
export const LENGTH_TARGET_TOL = 0.10;   // 对模型**要求**的目标区间（模板与重写反馈用它）
export const LENGTH_GATE_TOL = 0.12;     // 实际**放行**门槛：比要求松 2 个点，模型压线也算过
/** 目标时长对应的长度区间（中文=字，英文=词）。模板、重写反馈、放行门槛共用一把尺子。 */
export function lengthRange(duration, lang = 'zh', tol = LENGTH_TARGET_TOL) {
  const target = Number(String(duration ?? '').match(/\d+/)?.[0]);
  if (!target) return null;
  const per = langSpec(lang).perSec;
  return { target, lo: Math.round(target * per * (1 - tol)), hi: Math.round(target * per * (1 + tol)) };
}
export function scriptLength(shots, lang = 'zh') {
  return shots.reduce((n, s) => n + textLength(s.text, lang), 0);
}
export function lengthWarning(shots, duration, lang = 'zh') {
  const target = Number(String(duration ?? '').match(/\d+/)?.[0]);
  if (!target) return null;
  const L = normLang(lang);
  const n = scriptLength(shots, L);
  const secs = n / langSpec(L).perSec;
  const off = (secs - target) / target;
  if (Math.abs(off) <= LENGTH_GATE_TOL) return null;
  if (L === 'en') return `Script is ${n} words ≈ ${secs.toFixed(0)} s, but the target is ${target} s (${off > 0 ? 'long' : 'short'} by ${Math.abs(off * 100).toFixed(0)}%) — regenerating usually fixes it`;
  return `脚本 ${n} 字 ≈ ${secs.toFixed(0)} 秒，而目标是 ${target} 秒（${off > 0 ? '长' : '短'} ${Math.abs(off * 100).toFixed(0)}%）——重新生成一次通常就对了`;
}

export function scriptWarnings(shots, duration, lang = 'zh') {
  const L = normLang(lang);
  const out = [];
  const len = lengthWarning(shots, duration, L);
  if (len) out.push(len);
  // 夹生外文检查只对中文片有意义——英文片整篇都是拉丁字母，逐镜报一遍等于把警告区刷屏
  if (L === 'zh') for (const s of shots) {
    const latin = [...new Set((String(s.text).match(/[A-Za-z]{2,}/g) ?? []).filter((w) => w !== w.toUpperCase()))];
    if (latin.length) out.push(`镜头 ${s.id} 的口播里夹了英文单词「${latin.join('、')}」——配音会念出英文，字幕上也是拉丁字母`);
  }
  // 英文片反过来要防中文漏进去：模型偶尔会把中文提示词里的词直接抄进正文，
  // 英文音色遇到汉字会整段跳过不念（真机上中文片夹英文就是这么出戏的，反向同理）
  if (L === 'en') for (const s of shots) {
    const cjk = [...new Set((String(s.text).match(/[一-鿿]+/g) ?? []))];
    if (cjk.length) out.push(`Shot ${s.id} contains Chinese text “${cjk.join(' / ')}” — an English voice will mangle or skip it`);
  }
  return out;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'koubo';
