/**
 * 场景卡：和角色卡同一个思路，把"戏在哪儿拍"沉淀成可复用的资产——地点、时间天气光线、道具细节、画面风格。
 *
 * 用法两种：
 * ① 场景描述拼进故事，编剧写三镜时照此落景（短剧工作流要求三镜不超过两个场景，定了景就不会各镜乱跑）；
 * ② 场景图 + 角色定妆图交给云端改图，"把这个人放进这个场景"——出来的图当定妆图用，
 *    出片第一帧就是人在景里（本机 FLUX 做不到这一步：它不收参考图）。
 *
 * 存 ~/.openshorts/scenes/<id>/scene.json，图在同一目录。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { OPENSHORTS_HOME } from '../config.mjs';
import { writeJsonAtomic } from '../core/fs-atomic.mjs';
import { normLang, tt } from '../project/lang.mjs';

export const SCENES_DIR = path.join(OPENSHORTS_HOME, 'scenes');
const FIELDS = ['name', 'place', 'time', 'details', 'style'];
const clean = (s, max = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const safeSceneId = (s) => String(s ?? '').replace(/[\\/:*?"<>|\s]/g, '').replace(/\.\./g, '').slice(0, 40);
const sceneDir = (id) => {
  const s = safeSceneId(id);
  if (!s) throw new Error(`bad scene id: ${JSON.stringify(id)}`);
  return path.join(SCENES_DIR, s);
};
const pickFields = (c) => Object.fromEntries(FIELDS.map((k) => [k, c[k]]));

export function listScenes() {
  if (!fs.existsSync(SCENES_DIR)) return [];
  return fs.readdirSync(SCENES_DIR).flatMap((d) => { try { return [readScene(d)]; } catch { return []; } })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
export function readScene(id) {
  const f = path.join(sceneDir(id), 'scene.json');
  if (!fs.existsSync(f)) throw Object.assign(new Error(`scene not found: ${id}`), { status: 404 });
  return JSON.parse(fs.readFileSync(f, 'utf-8'));
}

/** 新建 / 更新（更新时没传的字段保留，显式传空才清） */
export function saveScene(input = {}, { id } = {}) {
  const prev = id ? readScene(id) : null;
  const src = prev ? Object.fromEntries([...FIELDS, 'lang'].map((k) => [k, Object.hasOwn(input, k) ? input[k] : prev[k]])) : input;
  const n = { name: clean(src.name, 40), lang: normLang(src.lang), place: clean(src.place), time: clean(src.time, 200), details: clean(src.details), style: clean(src.style, 200) };
  const T = tt(n.lang);
  if (!n.name) throw Object.assign(new Error(T('场景要有名字', 'A scene needs a name')), { status: 400 });
  if (!n.place) throw Object.assign(new Error(T('至少写一下地点', 'Describe the place at least')), { status: 400 });
  const now = new Date().toISOString();
  if (prev) {
    const next = { ...n, id: prev.id, image: prev.image ?? null, history: prev.history ?? [], createdAt: prev.createdAt, updatedAt: now };
    writeJsonAtomic(path.join(sceneDir(prev.id), 'scene.json'), next);
    return next;
  }
  let sid = safeSceneId(n.name) || `s${Date.now().toString(36)}`;
  if (fs.existsSync(sceneDir(sid))) sid = `${sid}-${crypto.randomBytes(2).toString('hex')}`;
  const scene = { ...n, id: sid, image: null, history: [], createdAt: now, updatedAt: now };
  fs.mkdirSync(sceneDir(sid), { recursive: true });
  writeJsonAtomic(path.join(sceneDir(sid), 'scene.json'), scene);
  return scene;
}
export function deleteScene(id) {
  const d = sceneDir(id);
  if (!fs.existsSync(path.join(d, 'scene.json'))) throw Object.assign(new Error(`scene not found: ${id}`), { status: 404 });
  fs.rmSync(d, { recursive: true, force: true });
}
export const sceneImagePath = (s) => (s?.image?.file ? path.join(sceneDir(s.id), s.image.file) : null);
export const sceneStale = (s) => !!s?.image?.fields && FIELDS.some((k) => (s.image.fields[k] ?? '') !== (s[k] ?? ''));

/** 拼进故事的场景段（不写场景名：名字是给用户自己认的） */
export function sceneLockText(s, lang = s?.lang) {
  const T = tt(lang);
  const parts = [s.place, s.time, s.details, s.style && T(`画面风格：${s.style}`, `Look: ${s.style}`)].filter(Boolean);
  return T(`【场景已定，三镜都在这里或紧邻处，照此写】${parts.join('。')}`, `[The setting is fixed — all three shots happen here or right next to it] ${parts.join('. ')}`);
}
export function storyWithScene(story, s, lang) {
  const lock = sceneLockText(s, lang); const t = String(story ?? '').trim();
  return t.includes(lock) ? t : `${t}\n${lock}`;
}

export function sceneBrief(s) {
  const T = tt(s.lang);
  return [T('电影剧照式的空镜，画面里没有人', 'Cinematic establishing still of an empty location, no people in frame'), s.place, s.time, s.details, s.style].filter(Boolean).join(T('。', '. '));
}

/** 本机出场景图（默认横版）。中文描述先翻英文，没有文本模型就原样用并标出来 */
export async function renderScene(id, { gen, chat, ratio = '16:9', onLog = () => {} } = {}) {
  if (!gen) throw new Error('renderScene needs a generator');
  const s = readScene(id);
  let prompt = sceneBrief(s); let translated = false;
  if (chat && s.lang !== 'en') {
    const out = clean(await chat('You write prompts for the FLUX text-to-image model. Translate this location description into one English paragraph of comma-separated visual phrases. Keep every detail of place, time, weather, light and props. It must contain no people. Output the prompt only.', prompt), 1200);
    if (out) { prompt = `${out}, no people, photographic, cinematic lighting`; translated = true; }
  }
  const [width, height] = ratio === '9:16' ? [640, 1152] : [1152, 640];
  const seed = crypto.randomInt(1, 2 ** 31 - 1);
  const file = `scene-${Date.now().toString(36)}.png`;
  const r = await gen(prompt, { out: path.join(sceneDir(s.id), file), seed, width, height, onLog });
  const next = readScene(s.id);
  const at = new Date().toISOString();
  next.history = [...(next.history ?? []), ...(next.image ? [next.image] : [])].slice(-12);
  next.image = { file, source: 'local-flux', model: r?.model ?? null, seed, prompt, translated, width, height, cost: { kind: 'free' }, license: 'Apache-2.0 (FLUX.1-schnell)', at, fields: pickFields(next) };
  next.updatedAt = at;
  writeJsonAtomic(path.join(sceneDir(s.id), 'scene.json'), next);
  return next;
}

export function setUploadedScene(id, bytes) {
  const s = readScene(id);
  const ext = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg' : bytes.length > 11 && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  const T = tt(s.lang);
  if (!ext) throw Object.assign(new Error(T('只收 PNG / JPEG / WebP 图片', 'Only PNG / JPEG / WebP images are accepted')), { status: 400 });
  const file = `scene-${Date.now().toString(36)}.${ext}`;
  fs.writeFileSync(path.join(sceneDir(s.id), file), bytes);
  const at = new Date().toISOString();
  s.history = [...(s.history ?? []), ...(s.image ? [s.image] : [])].slice(-12);
  s.image = { file, source: 'upload', model: null, seed: null, prompt: null, at, fields: pickFields(s) };
  s.updatedAt = at;
  writeJsonAtomic(path.join(sceneDir(s.id), 'scene.json'), s);
  return s;
}
