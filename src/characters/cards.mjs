/**
 * 角色卡：把"这个人长什么样"沉淀成可复用的资产（参考 LibTV 1.5 的「保存为新角色」）。
 *
 * 短剧线以前每跑一次都让模型从故事里重新捏一个主角：换一条片就换一张脸，
 * 想固定"眉心一颗痣、左脸一道疤"只能在故事里反复写、还不一定听。角色卡把这些拆成字段：
 * 基础人设、面容、标志特征、服装、定妆图背景、其它细节——改哪项就重出哪项，定妆图带着种子，
 * 同一个种子改一处细节，构图和脸型大体不跑（FLUX schnell 没有改图能力，做不到"只改那一处"，这点如实告诉用户）。
 *
 * 用到短剧里有两条路，都不改引擎：
 * ① 外形文字（lockText）拼进故事，编剧那步写【主角】时照抄——不管有没有定妆图都生效；
 * ② 有定妆图时，造一个"种子运行目录"交给引擎 --resume：定妆图两步标成已完成、图放进 assets，
 *    引擎跳过出图、直接拿卡里这张去出片。同一张脸跨片复用，也省掉一次出图的钱。
 *
 * 存在 ~/.openshorts/characters/<id>/card.json；图与卡放同一目录，换机器整个目录拷走就行。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { OPENSHORTS_HOME } from '../config.mjs';
import { writeJsonAtomic } from '../core/fs-atomic.mjs';
import { normLang, tt } from '../project/lang.mjs';

export const CHARACTERS_DIR = path.join(OPENSHORTS_HOME, 'characters');
const FIELDS = ['name', 'basics', 'face', 'marks', 'outfit', 'background', 'extra'];
const clean = (s, max = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const safeCardId = (s) => String(s ?? '').replace(/[\\/:*?"<>|\s]/g, '').replace(/\.\./g, '').slice(0, 40);
const cardDir = (id) => {
  const s = safeCardId(id);
  if (!s) throw new Error(`bad character id: ${JSON.stringify(id)}`);
  return path.join(CHARACTERS_DIR, s);
};

/** 只收认识的字段；marks 收数组或按行/顿号分隔的字符串 */
export function normalizeCard(input = {}) {
  const marks = Array.isArray(input.marks) ? input.marks : String(input.marks ?? '').split(/[\n；;、]+/);
  return {
    name: clean(input.name, 40),
    lang: normLang(input.lang),
    basics: clean(input.basics),
    face: clean(input.face),
    marks: marks.map((m) => clean(m, 80)).filter(Boolean).slice(0, 8),
    outfit: clean(input.outfit),
    background: clean(input.background, 200),
    extra: clean(input.extra),
  };
}

export function listCards() {
  if (!fs.existsSync(CHARACTERS_DIR)) return [];
  return fs.readdirSync(CHARACTERS_DIR).flatMap((d) => { try { return [readCard(d)]; } catch { return []; } })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function readCard(id) {
  const f = path.join(cardDir(id), 'card.json');
  if (!fs.existsSync(f)) throw Object.assign(new Error(`character not found: ${id}`), { status: 404 });
  return JSON.parse(fs.readFileSync(f, 'utf-8'));
}

/** 新建（无 id）或整卡更新（有 id）。名字必填；定妆图与历史由出图/上传单独维护，这里不动 */
export function saveCard(input = {}, { id } = {}) {
  // 更新时没传的字段保留原值（只改服装不该把标志特征清空）；显式传 '' / [] 才是清空
  const prevCard = id ? readCard(id) : null;
  const n = normalizeCard(prevCard ? Object.fromEntries([...FIELDS, 'lang'].map((k) => [k, Object.hasOwn(input, k) ? input[k] : prevCard[k]])) : input);
  const T = tt(n.lang);
  if (!n.name) throw Object.assign(new Error(T('角色要有名字', 'A character needs a name')), { status: 400 });
  if (!n.basics && !n.face) throw Object.assign(new Error(T('至少写一项：基础人设或面容', 'Describe at least the basics or the face')), { status: 400 });
  const now = new Date().toISOString();
  if (prevCard) {
    const prev = prevCard;
    const next = { ...n, id: prev.id, portrait: prev.portrait ?? null, history: prev.history ?? [], createdAt: prev.createdAt, updatedAt: now };
    writeJsonAtomic(path.join(cardDir(prev.id), 'card.json'), next);
    return next;
  }
  let cid = safeCardId(n.name) || `c${Date.now().toString(36)}`;
  if (fs.existsSync(cardDir(cid))) cid = `${cid}-${crypto.randomBytes(2).toString('hex')}`;
  const card = { ...n, id: cid, portrait: null, history: [], createdAt: now, updatedAt: now };
  fs.mkdirSync(cardDir(cid), { recursive: true });
  writeJsonAtomic(path.join(cardDir(cid), 'card.json'), card);
  return card;
}

export function deleteCard(id) {
  const d = cardDir(id);
  if (!fs.existsSync(path.join(d, 'card.json'))) throw Object.assign(new Error(`character not found: ${id}`), { status: 404 });
  fs.rmSync(d, { recursive: true, force: true });
}

export const portraitPath = (card) => (card?.portrait?.file ? path.join(cardDir(card.id), card.portrait.file) : null);

/**
 * 拼进故事的外形锁定段。**不带名字**：编剧那步的验收禁止出现"角色名"（防影视 IP），
 * 名字写进去会被当成 IP 名反复返工。外形才是要锁的东西。
 */
export function lockText(card, lang = card?.lang) {
  const T = tt(lang);
  const parts = [card.basics, card.face && T(`面容：${card.face}`, `Face: ${card.face}`),
    card.marks?.length && T(`标志特征（每一镜都要在）：${card.marks.join('；')}`, `Signature marks (visible in every shot): ${card.marks.join('; ')}`),
    card.outfit && T(`服装：${card.outfit}`, `Outfit: ${card.outfit}`), card.extra].filter(Boolean);
  return T(`【主角外形已定，剧本里的「主角」一段照此写、不要改】${parts.join('。')}`,
    `[The lead's look is fixed — write the "lead" section exactly from this, do not change it] ${parts.join('. ')}`);
}

/** 定妆图的描述（给翻译 / 直接出图用）：正面全身、背景按卡片，不写名字 */
export function portraitBrief(card) {
  const T = tt(card.lang);
  const bg = card.background || T('干净的浅灰色纯色棚拍背景，柔和棚光', 'clean plain light-grey studio backdrop, soft studio light');
  return [T('角色定妆照，正面，全身入镜（头顶到脚都在画面内），画面里只有这一个人', 'Character reference photo, facing camera, full body head to toe, only this one person in frame'),
    card.basics, card.face, card.marks?.length && card.marks.join(T('；', '; ')), card.outfit, card.extra, T(`背景：${bg}`, `Background: ${bg}`)].filter(Boolean).join(T('。', '. '));
}

/** 中文描述 → FLUX 吃得好的英文提示词。没有文本模型就原样用（效果差一些，结果里标出来） */
export async function portraitPrompt(card, { chat } = {}) {
  const brief = portraitBrief(card);
  if (!chat || card.lang === 'en') return { prompt: brief, translated: false };
  const sys = 'You write prompts for the FLUX text-to-image model. Translate the character description into one English paragraph of comma-separated visual phrases. Keep every physical detail, mark, scar, mole and clothing texture exactly; keep "full body, facing camera, only one person" and the background. No names, no story, no quotes. Output the prompt only.';
  const out = clean(await chat(sys, brief), 1200);
  return out ? { prompt: `${out}, photographic, sharp focus, natural skin texture`, translated: true } : { prompt: brief, translated: false };
}

/**
 * 出（或重出）定妆图。keepSeed=true 用上一张的种子：改一处细节后构图、脸型大体不跑。
 * 旧图进 history（整条换掉 portrait，不做 {...旧, 新字段} 展开——来源从 upload 变成 local-flux 时旧字段会留下来骗人）。
 */
/**
 * 定妆图画幅。图生视频的首帧**跟着图的比例裁**：竖版定妆图拿去出 16:9 的片，第一帧从中间裁，
 * 人只剩胸口以下（9-24 真机：三镜全没头）。所以出图时按片子的画幅出。
 */
export const PORTRAIT_DIMS = { '2:3': [768, 1152], '16:9': [1152, 640], '9:16': [640, 1152] };
const ratioOf = (w, h) => (!w || !h ? null : w > h * 1.3 ? '16:9' : h > w * 1.6 ? '9:16' : '2:3');
/** 这张定妆图拿去出 ratio 的片会不会被裁坏：横版片配竖图、竖版片配横图都算 */
export function ratioMismatch(card, videoRatio) {
  const p = card?.portrait; if (!p) return false;
  const r = p.ratio ?? ratioOf(p.width, p.height);
  if (!r) return false;   // 上传的图不知道尺寸，不瞎报
  return videoRatio === '16:9' ? r !== '16:9' : videoRatio === '9:16' ? r === '16:9' : false;
}

export async function renderPortrait(id, { gen, chat, keepSeed = false, seed, ratio = '2:3', onLog = () => {} } = {}) {
  const [width, height] = PORTRAIT_DIMS[ratio] ?? PORTRAIT_DIMS['2:3'];
  if (!gen) throw new Error('renderPortrait needs a generator');
  const card = readCard(id);
  const s = Number.isInteger(seed) ? seed : keepSeed && Number.isInteger(card.portrait?.seed) ? card.portrait.seed : crypto.randomInt(1, 2 ** 31 - 1);
  const pp = await portraitPrompt(card, { chat });
  const translated = pp.translated;
  // 横版要把整个人放进画框：不写的话模型按半身近景构图，头脚都出框
  const prompt = ratio === '16:9' ? `${pp.prompt}, medium-wide shot, whole figure centered with space above the head and below the feet` : pp.prompt;
  const file = `portrait-${Date.now().toString(36)}.png`;
  const r = await gen(prompt, { out: path.join(cardDir(card.id), file), seed: s, width, height, onLog });
  const next = readCard(card.id);   // 出图要一两分钟，期间卡片可能被改过——以磁盘上的为准
  const portrait = { file, source: 'local-flux', model: r?.model ?? null, seed: s, prompt, translated, width, height, ratio: PORTRAIT_DIMS[ratio] ? ratio : '2:3', cost: { kind: 'free' },
    license: 'Apache-2.0 (FLUX.1-schnell)', at: new Date().toISOString(), fields: pickFields(next) };
  next.history = [...(next.history ?? []), ...(next.portrait ? [next.portrait] : [])].slice(-12);
  next.portrait = portrait; next.updatedAt = portrait.at;
  writeJsonAtomic(path.join(cardDir(card.id), 'card.json'), next);
  return next;
}

/** 用户自己的面容图 / 定妆图（真人照、别处出好的图）。只收 png / jpeg / webp */
export function setUploadedPortrait(id, bytes, { note = '' } = {}) {
  const card = readCard(id);
  const ext = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg' : bytes.length > 11 && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  const T = tt(card.lang);
  if (!ext) throw Object.assign(new Error(T('只收 PNG / JPEG / WebP 图片', 'Only PNG / JPEG / WebP images are accepted')), { status: 400 });
  const file = `portrait-${Date.now().toString(36)}.${ext}`;
  fs.writeFileSync(path.join(cardDir(card.id), file), bytes);
  const at = new Date().toISOString();
  card.history = [...(card.history ?? []), ...(card.portrait ? [card.portrait] : [])].slice(-12);
  const [w, h] = imageSize(bytes);
  card.portrait = { file, source: 'upload', model: null, seed: null, prompt: null, note: clean(note, 200), width: w, height: h, ratio: ratioOf(w, h), at, fields: pickFields(card) };
  card.updatedAt = at;
  writeJsonAtomic(path.join(cardDir(card.id), 'card.json'), card);
  return card;
}

/** 回到历史里的某一张 */
export function restorePortrait(id, file) {
  const card = readCard(id);
  const i = (card.history ?? []).findIndex((h) => h.file === file);
  if (i < 0) throw Object.assign(new Error(`no such portrait: ${file}`), { status: 404 });
  const [back] = card.history.splice(i, 1);
  if (card.portrait) card.history.push(card.portrait);
  card.portrait = back; card.updatedAt = new Date().toISOString();
  writeJsonAtomic(path.join(cardDir(card.id), 'card.json'), card);
  return card;
}

/** PNG / JPEG 的宽高（只读头，不引依赖）；认不出返回 [null, null] */
function imageSize(b) {
  if (b[0] === 0x89 && b.length >= 24) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  return [null, null];
}

const pickFields = (c) => Object.fromEntries(FIELDS.map((k) => [k, c[k]]));

/**
 * 定妆图是不是跟卡片当前字段对得上：改了服装没重出图，短剧里就会出现"文字说红袍、图里是夹克"。
 * 界面据此提示"卡片改过，定妆图还是旧的"。
 */
export function portraitStale(card) {
  if (!card?.portrait?.fields) return false;
  return FIELDS.some((k) => JSON.stringify(card.portrait.fields[k] ?? '') !== JSON.stringify(card[k] ?? ''));
}

/** 把卡片的外形段拼进故事（已经拼过就不重复拼） */
export function storyWithCard(story, card, lang) {
  const lock = lockText(card, lang);
  const s = String(story ?? '').trim();
  return s.includes(lock) ? s : `${s}\n${lock}`;
}

/**
 * 种子运行目录：让引擎 --resume 时把「定妆图提示词」「定妆图」两步当作已完成，直接用卡里的图。
 * 格式照真实运行目录（metadata.json + steps/<n>-<id>.md + assets/character.png）。
 * inputs 要带全：resume 时引擎用它补齐没在命令行给的必填项（image_model 等）。
 */
export const SEEDS_DIR = path.join(OPENSHORTS_HOME, 'cache', 'character-seeds');
// 不放进引擎的 .ao-runs：服务端靠"跑完后新出现的目录"认本次运行，种子目录混进去会被当成成片目录
export function writeSeedRun(card, { inputs, seedsDir = SEEDS_DIR }) {
  const src = portraitPath(card);
  const T = tt(card.lang);
  if (!src || !fs.existsSync(src)) throw new Error(T(`角色「${card.name}」还没有定妆图`, `Character "${card.name}" has no portrait yet`));
  const dir = path.join(seedsDir, `${safeCardId(card.id)}-${Date.now().toString(36)}`);
  fs.mkdirSync(path.join(dir, 'steps'), { recursive: true }); fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  // 引擎按扩展名认媒体；上传的 jpg 也按 character.png 放会让下游按 png 解——这里统一转成对的扩展名不值当，
  // 视频供应商都按字节头判类型（video.js 里有 mime 嗅探），文件名只是个键
  fs.copyFileSync(src, path.join(dir, 'assets', 'character.png'));
  const body = (title, text) => `> ${title}\n\n---\n\n${text}\n`;
  fs.writeFileSync(path.join(dir, 'steps', '2-character_prompt.md'), body(T('🧍 **定妆图提示词**（来自角色卡）', '🧍 **Character prompt** (from character card)'), card.portrait.prompt || portraitBrief(card)));
  fs.writeFileSync(path.join(dir, 'steps', '9-character.md'), body(T('🎨 **主角定妆图**（来自角色卡）', '🎨 **Character portrait** (from character card)'), '![character](../assets/character.png)'));
  writeJsonAtomic(path.join(dir, 'metadata.json'), {
    name: 'character-card-seed', seededFrom: { character: card.id, portrait: card.portrait.file }, success: true,
    inputs: { ...inputs, image_provider: inputs.image_provider || 'character-card', image_model: inputs.image_model || 'character-card' },
    steps: [
      { id: 'character_prompt', status: 'completed', output_var: 'character_prompt' },
      { id: 'character', status: 'completed', output_var: 'character_img', imageAsset: { filename: 'character.png' } },
    ],
  });
  return dir;
}
