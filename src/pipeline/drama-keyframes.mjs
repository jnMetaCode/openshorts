/**
 * 逐镜首帧：三镜各用一张"人在景里、正在做这一镜的事"的首帧出片。
 *
 * 为什么要：短剧工作流三镜都拿同一张定妆图当首帧（`image: "{{character_img}}"`）。本机草稿档每镜 2 秒、4 步，
 * 只能在首帧附近小幅动一动——9-24 真机：三镜几乎一模一样，人不怎么动，收音机都没出现。
 *
 * 不改引擎，分两段跑：
 * ① 只跑文字：种子目录里把定妆图、三镜出片、合成、交付页都标成已完成，引擎只写剧本和三镜提示词；
 * ② 按剧本每镜的描述，云端"保脸 + 放进场景"各合成一张首帧（角色卡的 editPortraitCloud 同一套）；
 * ③ 派生一份工作流：镜 N 的首帧改读 `{{shotN_keyframe}}`，并加三个已完成的 shotN_keyframe 步骤；
 *    第二段种子 = 第一段的文字产物 + 三张首帧，引擎只跑三镜出片、合成、交付页。
 * 这是能进 AO 的通用能力（工作流里给每镜单独的首帧变量）：先在这里验证，再上提。
 */
import fs from 'node:fs';
import path from 'node:path';
import { OPENSHORTS_HOME } from '../config.mjs';
import { writeJsonAtomic } from '../core/fs-atomic.mjs';
import { tt } from '../project/lang.mjs';

export const SHOTS = ['shot1', 'shot2', 'shot3'];
const FAKE_DONE = [...SHOTS, 'film', 'pack'];

/** 第一段的种子：在角色卡种子（定妆图两步已完成）上，再把出片 / 合成 / 交付页标成已完成——引擎就只写文字 */
export function textsOnlySeed(seedDir) {
  const f = path.join(seedDir, 'metadata.json');
  const m = JSON.parse(fs.readFileSync(f, 'utf-8'));
  m.steps = [...m.steps.filter((s) => !FAKE_DONE.includes(s.id)), ...FAKE_DONE.map((id) => ({ id, status: 'completed', fake: true }))];
  writeJsonAtomic(f, m);
  return seedDir;
}

/** 剧本里每镜的描述（"## 镜头 N（…）" 到下一个 "##" 之间） */
export function shotDescriptions(script) {
  const out = {};
  const re = /^##\s*镜头\s*(\d)[^\n]*\n([\s\S]*?)(?=^##\s|\s*$(?![\s\S]))/gm;
  for (const m of String(script ?? '').matchAll(re)) out[`shot${m[1]}`] = m[2].trim();
  return out;
}

/** 首帧的改图要求：保脸（逐项点名）+ 这一镜开头的样子；有场景图就放进场景 */
export function keyframeInstruction(card, desc, { withScene, lang = card.lang } = {}) {
  const T = tt(lang);
  const must = [card.face, ...(card.marks ?? [])].filter(Boolean).join(T('；', '; '));
  const keep = must ? T(`保持同一个人，这些一样都不能变：${must}；服装：${card.outfit || '同图'}。`, `Keep exactly the same person. Must not change: ${must}; outfit: ${card.outfit || 'as in the image'}.`)
    : T('保持同一个人，脸、发型、服装都不变。', 'Keep exactly the same person: face, hair and outfit unchanged.');
  const place = withScene ? T('把这个人放进第二张图的场景里，光线、透视、色调与场景一致。', ' Place this person into the scene of the second image, matching its light, perspective and colour.') : '';
  return `${keep}${place}${T('画出这一镜开头的那一刻（电影剧照，只有这一个人，不要字幕）：', ' Show the opening moment of this shot (film still, only this one person, no captions): ')}${desc}`;
}

/**
 * 派生工作流：镜 N 的首帧读 shotN_keyframe；补三个 shotN_keyframe 步骤（永远由种子标成已完成，不会真跑）。
 * 按文本改而不是 YAML 往返：openshorts 没有 yaml 依赖，而且只动三行 + 末尾追加，改动一眼能看清。
 * agents_dir 写成绝对路径：派生文件放在缓存目录，相对路径会找不到角色库。
 */
export function deriveKeyframeWorkflow(src, { resolveAgents, outDir = path.join(OPENSHORTS_HOME, 'cache', 'workflows') } = {}) {
  const text = fs.readFileSync(src, 'utf-8');
  const lines = text.split('\n'); let cur = null; let swapped = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {2}- id: (\S+)\s*$/); if (m) cur = m[1];
    if (SHOTS.includes(cur) && lines[i].trim() === 'image: "{{character_img}}"') { lines[i] = lines[i].replace('{{character_img}}', `{{${cur}_keyframe}}`); swapped++; }
    if (SHOTS.includes(cur) && /^ {4}depends_on: \[character, shot\d_prompt\]\s*$/.test(lines[i])) lines[i] = lines[i].replace(']', `, ${cur}_keyframe]`);
    const ad = lines[i].match(/^agents_dir:\s*"?([^"\s]+)"?\s*$/);
    if (ad && resolveAgents) { const abs = resolveAgents(ad[1]); if (abs) lines[i] = `agents_dir: ${JSON.stringify(abs)}`; }
  }
  // 工作流改版（换了变量名 / 缩进）时宁可报错，也不能悄悄派生出一份三镜仍用同一张图的工作流
  if (swapped !== SHOTS.length) throw new Error(`keyframe workflow: expected ${SHOTS.length} shot image lines, found ${swapped} (engine workflow changed?)`);
  const extra = SHOTS.map((id) => `  - id: ${id}_keyframe
    type: image
    name: "${id} keyframe"
    task: "{{${id}_prompt}}"
    image:
      provider: "{{image_provider}}"
      model: "{{image_model}}"
    output: ${id}_keyframe
    depends_on: [character, ${id}_prompt]`).join('\n');
  fs.mkdirSync(outDir, { recursive: true });
  // 每次首跑 / 重出都派生一份（重出时现场重派，不靠旧文件还在），超过 3 天的清掉
  for (const f of fs.readdirSync(outDir)) { const p = path.join(outDir, f); try { if (f.startsWith('drama-keyframes-') && Date.now() - fs.statSync(p).mtimeMs > 3 * 24 * 3600e3) fs.rmSync(p); } catch { /* 并发删了 */ } }
  const out = path.join(outDir, `drama-keyframes-${Date.now().toString(36)}.yaml`);
  fs.writeFileSync(out, `${lines.join('\n').replace(/\s*$/, '')}\n${extra}\n`);
  return out;
}

/**
 * 第二段的种子：第一段运行目录的文字产物 + 三张首帧。第一段里"假完成"的出片 / 合成 / 交付页去掉，让引擎真跑。
 * @param keyframes { shot1: Buffer, ... }
 */
export function keyframesSeed(runA, keyframes, { meta = null, seedsDir = path.join(OPENSHORTS_HOME, 'cache', 'character-seeds') } = {}) {
  const dir = path.join(seedsDir, `keyframes-${Date.now().toString(36)}`);
  fs.cpSync(runA, dir, { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
  m.steps = m.steps.filter((s) => !FAKE_DONE.includes(s.id));
  for (const f of fs.readdirSync(path.join(dir, 'steps'))) if (FAKE_DONE.some((id) => f.endsWith(`-${id}.md`))) fs.rmSync(path.join(dir, 'steps', f));
  for (const id of SHOTS) {
    if (!keyframes[id]) throw new Error(`missing keyframe for ${id}`);
    fs.writeFileSync(path.join(dir, 'assets', `${id}_keyframe.png`), keyframes[id]);
    fs.writeFileSync(path.join(dir, 'steps', `90-${id}_keyframe.md`), `> 🖼 **${id} keyframe**\n\n---\n\n![${id}_keyframe](../assets/${id}_keyframe.png)\n`);
    m.steps.push({ id: `${id}_keyframe`, status: 'completed', output_var: `${id}_keyframe`, imageAsset: { filename: `${id}_keyframe.png` } });
  }
  if (meta) m.keyframes = meta;   // 供应商 / 模型 / 要求 / 尺寸：按张计费的东西要能追溯
  writeJsonAtomic(path.join(dir, 'metadata.json'), m);
  return dir;
}

/** 读第一段运行目录里的剧本正文（去掉步骤文件头） */
export function readScript(runDir) {
  const f = fs.readdirSync(path.join(runDir, 'steps')).find((x) => x.endsWith('-script.md'));
  if (!f) throw new Error(`no script step in ${runDir}`);
  const t = fs.readFileSync(path.join(runDir, 'steps', f), 'utf-8');
  const i = t.indexOf('\n---\n');
  return (i >= 0 ? t.slice(i + 5) : t).trim();
}

/**
 * 三镜各合成一张首帧（云端，按张计费）。一镜失败就整体失败并说清是哪一镜——
 * 用两张新图配一张旧图出片，比直接报错更难察觉。
 * @returns {Promise<{ frames: Record<string, Buffer>, meta: object[] }>}
 */
export async function composeKeyframes({ card, portrait, sceneImage = null, script, edit, provider, model, ratio = '16:9', lang = card.lang, onLog = () => {} }) {
  const T = tt(lang);
  const desc = shotDescriptions(script);
  const size = ratio === '9:16' ? '768x1344' : '1344x768';
  const frames = {}; const meta = [];
  for (const id of SHOTS) {
    if (!desc[id]) throw new Error(T(`剧本里找不到「${id}」这一镜的描述，没法按镜合成首帧`, `The script has no description for ${id}; cannot compose its keyframe`));
    const prompt = keyframeInstruction(card, desc[id], { withScene: !!sceneImage, lang });
    onLog(T(`🖼 ${id} 首帧：云端合成（${provider} / ${model}，按张计费）…`, `🖼 ${id} keyframe: composing in the cloud (${provider} / ${model}, billed per image)…`));
    try { frames[id] = await edit({ provider, model, images: [portrait, ...(sceneImage ? [sceneImage] : [])], prompt, size, lang }); }
    catch (e) { throw new Error(T(`${id} 首帧合成失败：${e.message}`, `${id} keyframe failed: ${e.message}`)); }
    meta.push({ shot: id, provider, model, prompt, size, cost: { kind: 'paid' } });
  }
  return { frames, meta };
}
