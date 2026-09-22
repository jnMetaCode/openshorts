/**
 * 写脚本这一步的编排：跑 AO → 解析成项目 → 长度不对就带着量化反馈自动重写一次 → 还不对就"扩写 / 精简"现有稿。
 *
 * 模板里把字数区间写得再清楚，模型也是时灵时不灵（真机同一话题两次分别 278 / 183 字）。
 * 以前只在项目里塞一条警告，等用户看到时 token 已经花了、片子已经短 30%。
 * CLI 和 Web 各自复制过一份「run + buildKouboProject」，长度门槛必须放在这个共用层，
 * 两边才都生效——改任何一边都等于只修了一半。
 *
 * 9-22 加的两条（本机 7B 模型四次真跑三次偏短、重写也救不回来之后）：
 * ① **留最好的一稿，不是最后的一稿**——洋葱那条重写后 114 → 110 字反而更差，以前照样用后者。
 * ② 从零重写救不回来时改成**扩写 / 精简现有稿**：小模型不会"从零写够 130 字"，但会"把每段再多说一句"。
 *    同一个 7B 从零写只有 55 字，扩写三次得到 159 / 202 / 109。只改 hook / 各段 text / outro 的文字，
 *    id、画面意图、检索词一律原样保留；明说"不要编造数字和数据"——让它"加个数字"它真会编（磁偏角 23.5 度）。
 *
 * 解析失败同样自动重跑一次：模型偶发写坏 JSON，「直接重跑通常就好」这句话以前是
 * 打印出来让用户自己照做的，现在先替他做一遍，还是坏才把原始输出交出去。
 */
import fs from 'node:fs';
import { buildKouboProject, lengthWarning, lengthRange, scriptLength, parseJsonLoose } from '../project/koubo.mjs';
import { normLang } from '../project/lang.mjs';

/** 到合格区间的距离（在区间里 = 0）；挑候选稿用 */
const distToRange = (n, { lo, hi }) => (n < lo ? lo - n : n > hi ? n - hi : 0);

/** 模板 YAML 里的默认 llm（没传 llmOverride 时扩写要用同一家模型） */
async function templateLlm(wf) {
  try { const { parse } = await import('yaml'); const y = parse(fs.readFileSync(wf, 'utf-8')); return y?.llm?.provider ? { provider: y.llm.provider, model: y.llm.model } : null; } catch { return null; }
}

/** 默认的"问一次模型"：走 AO 的连接器，供应商 / 模型 / key 与写脚本那步一致 */
async function defaultChat({ wf, aoOpts }) {
  const cfg = aoOpts.llmOverride ?? (await templateLlm(wf));
  if (!cfg?.provider) return null;
  const { createConnector } = await import('agency-orchestrator');
  const c = { ...cfg, timeout: 120000, retry: 1 };
  return async (system, user) => String((await createConnector(c).chat(system, user, { ...c, max_tokens: 4000, temperature: 0.7 })).content ?? '');
}

function adjustPrompt(script, n, { lo, hi }, L) {
  const dir = n < lo ? 'expand' : 'trim';
  // 只说区间时，差几个字模型就只微调（真机：115 → 115 → 115）。把要加 / 减多少字算好给它，目标定在区间中点
  const delta = Math.abs(Math.round((lo + hi) / 2 - n));
  const slim = { hook: script.hook, segments: (script.segments ?? []).map((s) => ({ id: s.id, text: s.text })), outro: script.outro };
  if (L === 'en') return [`Below is the narration of a short video as JSON. It is ${n} words; it must total ${lo}–${hi} words (hook + every segment text + outro). ${dir === 'expand' ? `Add about ${delta} words in total, spread across the parts: give each part one more concrete detail, action or example — do NOT invent numbers, statistics, names or studies.` : `Remove about ${delta} words in total: cut filler and repetition, keep every fact.`} Keep the tone, the order, every id, and the number of segments. Change nothing but the text. Output only the JSON.`, JSON.stringify(slim)].join('\n\n');
  return [`下面是一条口播短视频的脚本 JSON。现在 ${n} 个字，要求 hook + 各段 text + outro 合计 ${lo}–${hi} 个字。${dir === 'expand' ? `请总共增加约 ${delta} 个字，分摊到各部分：每一部分多给一个具体的画面、动作或例子——**不要编造数字、数据、人名或研究**。` : `请总共删去约 ${delta} 个字：去掉废话和重复，事实一个都不能丢。`}语气不变、顺序不变、id 不变、段数不变，只改文字。只输出 JSON，不要解释。`, JSON.stringify(slim)].join('\n\n');
}

/** 只把文字合回去：id 对得上的段才改，别的字段（画面意图、检索词、强调词）原样保留 */
function mergeTexts(script, adjusted) {
  const out = { ...script, segments: (script.segments ?? []).map((s) => ({ ...s })) };
  if (typeof adjusted.hook === 'string' && adjusted.hook.trim()) out.hook = adjusted.hook.trim();
  if (typeof adjusted.outro === 'string' && adjusted.outro.trim()) out.outro = adjusted.outro.trim();
  const byId = new Map((adjusted.segments ?? []).filter((s) => s && typeof s.text === 'string').map((s) => [String(s.id), s.text.trim()]));
  for (const s of out.segments) if (byId.get(String(s.id))) s.text = byId.get(String(s.id));
  return out;
}

/**
 * @returns {Promise<{ok:true, project:object, res:object, attempts:number}
 *   | {ok:false, kind:'run', res:object}
 *   | {ok:false, kind:'parse', error:Error, res:object}>}
 * runFn / chatFn 只为测试注入；不传时用 AO 的 run 和连接器。
 */
export async function generateKoubo({ wf, inputs, buildDefaults, aoOpts = {}, log = () => {}, maxAttempts = 2, maxAdjust = 2, runFn, chatFn, lang = 'zh' }) {
  const run = runFn ?? (await import('agency-orchestrator')).run;
  const L = normLang(lang);
  const range = lengthRange(inputs.duration, L) ?? lengthRange('60秒', L);
  const build = (r) => buildKouboProject(r, { topic: inputs.topic, inputs, defaults: buildDefaults, lang: L });
  const candidates = [];   // { project, res, n }
  const remember = (project, res) => { const n = scriptLength(project.shots, L); candidates.push({ project, res, n }); return n; };
  let lengthNote = null;
  let res;
  let attempts = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    const attemptInputs = { ...inputs };
    // 反馈走 topic 注入：AO 的 run() 没有逐步反馈参数，而模板的 {{topic}} 在提示词最前面。
    // project.topic 用的是原始 topic（buildKouboProject 单独传），不会被这段话污染。
    // 退回原因要跟片子同语言——中文提示塞进英文模板，模型多半会跟着改用中文写正文。
    if (lengthNote) attemptInputs.topic = L === 'en'
      ? `${inputs.topic}\n\n[Previous draft rejected] ${lengthNote}`
      : `${inputs.topic}\n\n【上一稿被退回，原因】${lengthNote}`;
    res = await run(wf, attemptInputs, aoOpts);
    if (!res.success) return { ok: false, kind: 'run', res };
    let project;
    try {
      project = build(res);
    } catch (e) {
      if (attempt < maxAttempts) { log(L === 'en' ? `The script could not be parsed (${String(e.message).split('\n')[0]}) — rewriting once…` : `脚本解析不了（${String(e.message).split('\n')[0]}），自动重写一次…`); lengthNote = null; continue; }
      return { ok: false, kind: 'parse', error: e, res };
    }
    const n = remember(project, res);
    if (!lengthWarning(project.shots, inputs.duration, L)) return { ok: true, project, res, attempts };
    if (attempt >= maxAttempts) break;
    // 反馈里给的是**要求区间**（±10%，与模板一致）；放行门槛在 lengthWarning 里松 2 个点
    const { lo, hi } = range;
    lengthNote = L === 'en'
      ? `The narration is ${n} words, which does not match the target length ${inputs.duration}. This time the hook + every segment text + outro must total between ${lo} and ${hi} words. Everything else stays the same.`
      : `口播总字数 ${n} 字，不符合目标时长 ${inputs.duration}。这次 hook + 各段 text + outro 的总字数必须落在 ${lo}–${hi} 字之间，其余要求不变。`;
    log(L === 'en' ? `Script is ${n} words, off target (needs ${lo}–${hi}) — rewriting once…` : `脚本 ${n} 字，偏离目标时长（要求 ${lo}–${hi} 字）——自动重写一次…`);
  }

  // 从零重写也没写对：拿目前最接近的那稿做扩写 / 精简（只动文字）
  const chat = chatFn === undefined ? await defaultChat({ wf, aoOpts }) : chatFn;
  if (chat) {
    for (let i = 0; i < maxAdjust; i++) {
      const best = candidates.reduce((a, b) => (distToRange(b.n, range) < distToRange(a.n, range) ? b : a));
      const script = parseJsonLoose(best.res.steps.find((s) => s.id === 'script')?.output);
      log(L === 'en' ? `Still ${best.n} words — ${best.n < range.lo ? 'expanding' : 'trimming'} the current draft (${i + 1}/${maxAdjust})…` : `仍是 ${best.n} 字——改为${best.n < range.lo ? '扩写' : '精简'}现有稿（${i + 1}/${maxAdjust}）…`);
      let merged;
      try { merged = mergeTexts(script, parseJsonLoose(await chat(L === 'en' ? 'You edit short-video narration. Output JSON only.' : '你是短视频文案编辑。只输出 JSON。', adjustPrompt(script, best.n, range, L)))); }
      catch (e) { log(L === 'en' ? `Adjust pass failed (${String(e.message).split('\n')[0]}), keeping the draft.` : `扩写失败（${String(e.message).split('\n')[0]}），保留原稿。`); break; }
      const patched = { ...best.res, steps: best.res.steps.map((s) => (s.id === 'script' ? { ...s, output: JSON.stringify(merged) } : s)) };
      let project; try { project = build(patched); } catch { break; }
      attempts++;
      const n = remember(project, patched);
      if (!lengthWarning(project.shots, inputs.duration, L)) return { ok: true, project, res: patched, attempts };
    }
  }

  // 都没落进区间：留最接近的那稿，并把警告改成真话（"重新生成一次通常就对了"对本机小模型不成立）
  const best = candidates.reduce((a, b) => (distToRange(b.n, range) < distToRange(a.n, range) ? b : a));
  const warn = lengthWarning(best.project.shots, inputs.duration, L);
  const truthful = L === 'en'
    ? `${warn?.split(' — ')[0]} — already retried ${attempts} times (rewrite + expand). Small local models often do this; try a larger model (14B+) or edit the script in the next step.`
    : `${warn?.split('——')[0]}——已自动重写 ${attempts} 次（含扩写）仍偏离。本机小模型常这样，换 14B 以上的模型更稳，或在下一步手动补几句。`;
  best.project.scriptWarnings = (best.project.scriptWarnings ?? []).map((w) => (w === warn ? truthful : w));
  return { ok: true, project: best.project, res: best.res, attempts };
}
