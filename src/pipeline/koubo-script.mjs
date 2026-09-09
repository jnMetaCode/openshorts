/**
 * 写脚本这一步的编排：跑 AO → 解析成项目 → 长度不对就带着量化反馈自动重写一次。
 *
 * 模板里把字数区间写得再清楚，模型也是时灵时不灵（真机同一话题两次分别 278 / 183 字）。
 * 以前只在项目里塞一条警告，等用户看到时 token 已经花了、片子已经短 30%。
 * CLI 和 Web 各自复制过一份「run + buildKouboProject」，长度门槛必须放在这个共用层，
 * 两边才都生效——改任何一边都等于只修了一半。
 *
 * 解析失败同样自动重跑一次：模型偶发写坏 JSON，「直接重跑通常就好」这句话以前是
 * 打印出来让用户自己照做的，现在先替他做一遍，还是坏才把原始输出交出去。
 */
import { buildKouboProject, lengthWarning, lengthRange, scriptLength } from '../project/koubo.mjs';
import { normLang } from '../project/lang.mjs';

/**
 * @returns {Promise<{ok:true, project:object, res:object, attempts:number}
 *   | {ok:false, kind:'run', res:object}
 *   | {ok:false, kind:'parse', error:Error, res:object}>}
 * runFn 只为测试注入；不传时用 AO 的 run。
 */
export async function generateKoubo({ wf, inputs, buildDefaults, aoOpts = {}, log = () => {}, maxAttempts = 2, runFn, lang = 'zh' }) {
  const run = runFn ?? (await import('agency-orchestrator')).run;
  const L = normLang(lang);
  let lengthNote = null;
  let res;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
      project = buildKouboProject(res, { topic: inputs.topic, inputs, defaults: buildDefaults, lang: L });
    } catch (e) {
      if (attempt < maxAttempts) { log(`脚本解析不了（${String(e.message).split('\n')[0]}），自动重写一次…`); lengthNote = null; continue; }
      return { ok: false, kind: 'parse', error: e, res };
    }
    const warn = lengthWarning(project.shots, inputs.duration, L);
    if (!warn || attempt >= maxAttempts) return { ok: true, project, res, attempts: attempt };
    // 反馈里给的是**要求区间**（±10%，与模板一致）；放行门槛在 lengthWarning 里松 2 个点
    const { lo, hi } = lengthRange(inputs.duration, L) ?? lengthRange('60秒', L);
    const n = scriptLength(project.shots, L);
    lengthNote = L === 'en'
      ? `The narration is ${n} words, which does not match the target length ${inputs.duration}. This time the hook + every segment text + outro must total between ${lo} and ${hi} words. Everything else stays the same.`
      : `口播总字数 ${n} 字，不符合目标时长 ${inputs.duration}。这次 hook + 各段 text + outro 的总字数必须落在 ${lo}–${hi} 字之间，其余要求不变。`;
    log(L === 'en' ? `Script is ${n} words, off target (needs ${lo}–${hi}) — rewriting once…` : `脚本 ${n} 字，偏离目标时长（要求 ${lo}–${hi} 字）——自动重写一次…`);
  }
}
