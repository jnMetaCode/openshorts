import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCues, toSRT, estimateWords, alignPunctuation } from '../src/captions/build.mjs';
import { buildKouboProject, lengthWarning, lengthRange, scriptLength, scriptWarnings } from '../src/project/koubo.mjs';
import { generateKoubo } from '../src/pipeline/koubo-script.mjs';
import { LANG_SPEC, langSpec, localizeInputs, textLength } from '../src/project/lang.mjs';
import { voicesFor } from '../src/voice/edge-tts.mjs';
import { spawnSync } from 'node:child_process';
import * as spawnSyncMod from 'node:child_process';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/**
 * 英文成片线。界面早就双语，但片子本身一直只会说中文——这组测试盯的是四个
 * "中文假设写死在代码里"的地方：字幕拼接、长度尺子、默认音色、模板选择。
 * 其中字幕那条最要命：原来的实现无条件删掉所有空白再 join('')，英文会被拼成一坨。
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Edge TTS 真实回来的形状：词边界不带标点（本机跑 en-US-Ava 核实过），标点靠 alignPunctuation 贴回
const enText = 'A box is a hiding spot. It is a wall against everything that could sneak up from behind, and cats know it.';
const enWords = enText.replace(/[.,]/g, '').split(' ').map((w, i) => ({ text: w, startMs: i * 400, endMs: i * 400 + 380 }));

test('英文字幕：词之间保留空格，不会拼成一坨', () => {
  const cues = buildCues(alignPunctuation(enWords, enText), { maxChars: 34, lang: 'en' });
  // 把所有字幕条接回去应当**逐字**还原原文；粘成一坨或漏词都会在这里现形
  assert.equal(cues.map((c) => c.text).join(' '), enText);
  assert.ok(cues[0].text.includes(' '), `没有空格：${cues[0].text}`);
  // 每条 ≤ 2 行 × maxChars
  for (const c of cues) assert.ok(c.text.length <= 34 * 2, `${c.text.length}: ${c.text}`);
});

test('英文字幕在句号处断条（. ! ? 都算句末）', () => {
  const cues = buildCues(alignPunctuation(enWords, enText), { maxChars: 34, lang: 'en' });
  assert.ok(cues.some((c) => c.text.endsWith('spot.')), cues.map((c) => c.text).join(' | '));
});

test('英文折行只在词边界，不切断单词', () => {
  const cues = buildCues(alignPunctuation(enWords, enText), { maxChars: 34, lang: 'en' });
  const srt = toSRT(cues, { maxChars: 34 });
  for (const line of srt.split('\n')) {
    if (!line || /^\d+$/.test(line) || line.includes('-->')) continue;
    assert.ok(line.length <= 34, `行超长：${line}`);
  }
  // 原文的每个词都必须完整出现在 SRT 里——切断单词的话这里会漏
  for (const w of enText.replace(/[.,]/g, '').split(' ')) assert.ok(srt.includes(w), `SRT 里少了 ${w}`);
});

test('中文字幕行为一字未变（英文分支不能碰中文）', () => {
  const zh = [['你',0,200],['有没有',210,600],['发现，',610,1100],['猫',1200,1400],['为什么',1410,1900],['爱钻',1910,2200],['纸箱？',2210,2700]].map(([text, startMs, endMs]) => ({ text, startMs, endMs }));
  const cues = buildCues(zh, { maxChars: 16 });
  assert.equal(cues.map((c) => c.text).join(''), '你有没有发现，猫为什么爱钻纸箱？');
  assert.ok(cues.every((c) => !c.text.includes(' ')));
});

test('无词级时间戳时英文按词摊时长（按字符摊会出 "C a t s"）', () => {
  const ws = estimateWords('a box is a wall', 5000, { lang: 'en' });
  assert.equal(ws.length, 5);
  assert.equal(ws[0].text, 'a');
  assert.equal(ws[4].endMs, 5000);
  assert.equal(estimateWords('猫爱纸箱', 4000).length, 4, '中文仍按字');
});

test('长度尺子按语言换单位：中文数字、英文数词', () => {
  assert.equal(textLength('a box is a wall', 'en'), 5);
  assert.equal(textLength('猫为什么爱钻纸箱', 'zh'), 8);
  // 60 秒 × 2.9 词/秒 = 174 词，±10% → 157–191
  assert.deepEqual(lengthRange('60 seconds', 'en'), { target: 60, lo: 157, hi: 191 });
  const shots = (n) => Array.from({ length: n }, () => ({ text: 'word' }));
  assert.equal(lengthWarning(shots(174), '60 seconds', 'en'), null, '174 词正好达标');
  const short = lengthWarning(shots(100), '60 seconds', 'en');
  assert.match(String(short), /100 words/);
  assert.match(String(short), /short/);
  // 同样 174 个中文字放到 60 秒目标上是"短"——两把尺子不能串
  assert.match(String(lengthWarning(Array.from({ length: 174 }, () => ({ text: '字' })), '60秒', 'zh')), /短/);
  assert.equal(scriptLength(shots(3), 'en'), 3);
});

test('脚本告警按语言分：英文片不刷"夹了英文单词"，改为揪出漏进来的中文', () => {
  const en = scriptWarnings([{ id: 's1', text: 'A box is a hiding spot' }], '60 seconds', 'en');
  assert.deepEqual(en.filter((w) => /英文单词/.test(w)), [], '英文片不该报夹生外文');
  const mixed = scriptWarnings([{ id: 's1', text: 'A box is 一个纸箱 really' }], '60 seconds', 'en');
  assert.ok(mixed.some((w) => /Chinese text/.test(w)), mixed.join(' | '));
  // 中文片的原有告警一条不少
  const zh = scriptWarnings([{ id: 's1', text: '次磺酸又迅速 rearrange' }], '60秒', 'zh');
  assert.ok(zh.some((w) => /rearrange/.test(w)));
});

test('英文项目默认音色是英文的，字幕每行放得下英文', () => {
  const aoResult = { name: 'x', success: true, steps: [
    { id: 'script', status: 'completed', output: JSON.stringify({ hook: 'Why boxes?', segments: [{ id: 's1', text: 'A box is a hiding spot.', visualIntent: 'cat in box', query: 'cat inside cardboard box', emphasis: ['box'] }], outro: 'Follow for more.' }) },
    { id: 'meta', status: 'completed', output: '{"titles":["Why cats love boxes"],"tags":["cats"],"publishNote":"n","aiLabel":"AI"}' },
  ] };
  const p = buildKouboProject(aoResult, { topic: 'why cats love boxes', inputs: { duration: '60 seconds' }, lang: 'en' });
  assert.equal(p.lang, 'en');
  assert.equal(p.template, 'koubo-explainer.en', '模板名要跟着语言走，否则事后查不出这条片是哪个模板出的');
  assert.ok(p.voice.voice.startsWith('en-'), p.voice.voice);
  assert.equal(p.captions.maxChars, LANG_SPEC.en.captionMaxChars);
  // 中文项目一点没变
  const z = buildKouboProject(aoResult, { topic: 't', inputs: { duration: '60秒' } });
  assert.equal(z.lang, 'zh'); assert.equal(z.template, 'koubo-kepu'); assert.equal(z.voice.voice, 'zh-CN-XiaoxiaoNeural'); assert.equal(z.captions.maxChars, 16);
});

test('/voices 按语言分组，两边都非空且前缀正确', () => {
  assert.ok(voicesFor('en').length >= 3);
  assert.ok(voicesFor('en').every((v) => v.id.startsWith('en-')));
  assert.ok(voicesFor('zh').every((v) => v.id.startsWith('zh-')));
  assert.equal(voicesFor('en').some((v) => v.id === LANG_SPEC.en.voice), true, '默认音色必须在清单里，否则下拉里选不中');
});

test('界面传来的中文时长/语气会翻成英文再进模板', () => {
  const en = localizeInputs({ topic: 't', duration: '60秒', tone: '科普讲解' }, 'en');
  assert.equal(en.duration, '60 seconds');
  assert.equal(en.tone, 'explainer');
  assert.equal(localizeInputs({ duration: '90秒', tone: '轻松口播' }, 'en').tone, 'casual talk');
  // 认不出的语气原样透传（用户手填的也要能用）
  assert.equal(localizeInputs({ tone: 'deadpan' }, 'en').tone, 'deadpan');
  // 中文那侧不动
  assert.equal(localizeInputs({ duration: '60秒', tone: '科普讲解' }, 'zh').duration, '60秒');
});

test('退回重写的反馈跟片子同语言（中文提示塞进英文模板会带偏正文）', async () => {
  const mk = (words) => ({ name: 'x', success: true, steps: [
    { id: 'script', status: 'completed', output: JSON.stringify({ hook: 'Hook here.', segments: [{ id: 's1', text: 'word '.repeat(Math.max(words - 5, 1)).trim(), visualIntent: 'v', query: 'q', emphasis: [] }], outro: 'Outro line.' }) },
    { id: 'meta', status: 'completed', output: '{"titles":["T"],"tags":["t"],"publishNote":"n","aiLabel":"AI"}' },
  ] });
  const calls = [];
  const runFn = async (_wf, attemptInputs) => { calls.push(attemptInputs); return calls.length === 1 ? mk(60) : mk(174); };
  const g = await generateKoubo({ wf: 'x.yaml', lang: 'en', inputs: { topic: 'cats', duration: '60 seconds', tone: 'explainer' }, runFn });
  assert.equal(g.ok, true); assert.equal(g.attempts, 2);
  assert.match(calls[1].topic, /Previous draft rejected/);
  assert.match(calls[1].topic, /157/);
  assert.ok(!/上一稿/.test(calls[1].topic), '英文重写反馈里不该出现中文');
});

test('英文模板存在、角色能解析、里面手写的词数区间与常量对得上', () => {
  const file = path.join(root, 'templates', langSpec('en').template);
  const yaml = fs.readFileSync(file, 'utf-8');
  // 角色库：agents_dir 指的是 AO 包内置的英文角色库，role 必须真存在，否则 run 会被校验挡下
  const agentsDir = path.join(root, 'node_modules', 'agency-orchestrator', 'agency-agents');
  for (const m of yaml.matchAll(/role:\s*"([^"]+)"/g)) {
    assert.ok(fs.existsSync(path.join(agentsDir, `${m[1]}.md`)), `角色不存在：${m[1]}`);
  }
  assert.match(yaml, /agents_dir:\s*"agency-agents"/);
  // 防漂移：yaml 里的区间是手写的（模板导不了常量），改语速常量必须同步改模板
  for (const secs of [45, 60, 90]) {
    const { lo, hi } = lengthRange(`${secs} seconds`, 'en');
    assert.ok(yaml.includes(`${secs} seconds → ${lo}–${hi} words`), `模板里 ${secs} 秒的区间与常量不符，应为 ${lo}–${hi}`);
  }
  assert.ok(yaml.includes(`× ${LANG_SPEC.en.perSec} words`), '模板里的语速与 LANG_SPEC 不符');
});

test('英文片交出去的发布包也是英文的（文件名 + 措辞）', async () => {
  const { buildPublishText, makePublishPack } = await import('../src/publish/pack.mjs');
  const os = await import('node:os');
  const base = { title: 'Why cats love boxes', publish: { titles: ['Why cats love boxes'], tags: ['cats'], note: 'Post at 7pm', aiLabelText: 'This video contains AI-generated content' }, provenance: [], output: { w: 1080, h: 1920 } };
  const en = buildPublishText({ ...base, lang: 'en' }, 'shorts');
  assert.match(en, /Title options:/); assert.match(en, /Hashtags:/); assert.match(en, /AI label:/);
  assert.ok(!/标题候选|话题：|发布说明/.test(en), `英文发布文案里还有中文：\n${en}`);
  // 中文片一字未变
  const zh = buildPublishText({ ...base, lang: 'zh' }, 'douyin');
  assert.match(zh, /标题候选：/); assert.match(zh, /AI 标识：/);

  // 文件名：英文项目不该出现中文文件名（Windows/Mac 上都能建，但交给海外运营看着就是乱码风险）
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-pack-en-'));
  const mp4 = path.join(dir, 'a.mp4'); fs.writeFileSync(mp4, 'x');
  const r = makePublishPack({ ...base, lang: 'en', final: { file: mp4, cover: null, srt: null, durationSec: 30 } }, { platform: 'shorts' });
  assert.ok(r.files.some((f) => f.endsWith('-publish.txt')), r.files.join(','));
  assert.ok(!r.files.some((f) => /[一-鿿]/.test(f)), r.files.join(','));
  assert.ok(!/[一-鿿]/.test(path.basename(r.dir)), r.dir);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('烧进画面的 AI 角标：文字来自参数，且对 drawtext 的元字符做兜底清洗', async () => {
  const { drawtextLabel } = await import('../src/compose/koubo.mjs');
  assert.equal(drawtextLabel('AI generated'), 'AI generated');
  assert.equal(drawtextLabel('AI 生成'), 'AI 生成');
  // 单引号/冒号/反斜杠会把 drawtext 的滤镜串截断，整条合成失败
  assert.equal(drawtextLabel("A'I: b\\c"), 'AI bc');
  assert.equal(drawtextLabel('   '), 'AI', "清洗后空了要有兜底，不能生成 text=''");
  const compose = fs.readFileSync(path.join(root, 'src', 'compose', 'koubo.mjs'), 'utf-8');
  assert.match(compose, /drawtext=text='\$\{label\}'/, '角标文字必须来自参数，不能再写死');
  // 接线：出片时角标与软字幕轨的语言都跟着 T 走
  const src = fs.readFileSync(path.join(root, 'src', 'pipeline', 'koubo-run.mjs'), 'utf-8');
  assert.match(src, /aiLabelText: T\('AI 生成', 'AI generated'\)/);
  assert.match(src, /subLang: T\('chi', 'eng'\)/);
});

test('英文发布包里不留中文：平台规则、质检原话、本地出图署名', async () => {
  const { buildPublishText, PLATFORMS } = await import('../src/publish/pack.mjs');
  // 平台规则原来只有中文——英文用户拿到的「YouTube Shorts 规则」那一行是中文（真机打包才看见）
  for (const k of Object.keys(PLATFORMS)) {
    assert.ok(PLATFORMS[k].noteEn, `${k} 缺 noteEn`);
    assert.ok(!/[一-鿿]/.test(PLATFORMS[k].noteEn), `${k} 的 noteEn 里有中文`);
  }
  const txt = buildPublishText({
    lang: 'en', title: 'T', publish: { titles: ['T'], tags: ['cats'], note: 'n', aiLabelText: 'AI' },
    provenance: [{ shot: 's1', source: 'local-flux', license: 'Apache-2.0 (generated locally with FLUX.1-schnell)', page: 'x' }],
    output: { w: 1080, h: 1920 },
    final: { durationSec: 30, quality: { pass: true, warnings: 1, items: [{ id: 'solid', status: 'warn', msg: '1/7 shots fell back to a solid color' }] } },
  }, 'shorts');
  assert.ok(!/[一-鿿]/.test(txt), `英文发布文案里还有中文：\n${txt}`);
  // 半角冒号后面必须留空格，否则挤成 "Hashtags:#cats"（真机第一版就是这样）
  assert.match(txt, /Hashtags: #cats/);
  assert.match(txt, /Publishing note: n/);
});

test('质检原话按语言给（界面质检面板和发布包读的是同一份）', async () => {
  const { checkKoubo } = await import('../src/quality/check.mjs');
  const proj = { output: { w: 1080, h: 1920 }, shots: [], final: {} };
  const zh = await checkKoubo({ ...proj, lang: 'zh' }, { file: '/nope/missing.mp4' });
  assert.match(zh.items[0].msg, /成片文件不存在/);
  const en = await checkKoubo({ ...proj, lang: 'en' }, { file: '/nope/missing.mp4' });
  assert.match(en.items[0].msg, /does not exist/);
  assert.ok(!/[一-鿿]/.test(en.items[0].msg));
});

test('标题超长截断后不能留尾随空格（英文标题动辄 40+ 字符，Windows 上是非法文件名）', async () => {
  const { makePublishPack } = await import('../src/publish/pack.mjs');
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-pack-trim-'));
  const mp4 = path.join(dir, 'a.mp4'); fs.writeFileSync(mp4, 'x');
  // 40 个字符处正好落在空格上的标题
  const title = 'Why Cats Love Cardboard Boxes Will Blow Your Mind';
  const r = makePublishPack({ lang: 'en', title, publish: { titles: [title], tags: [] }, provenance: [], output: { w: 1080, h: 1920 }, final: { file: mp4, cover: null, srt: null, durationSec: 30 } }, { platform: 'shorts' });
  // 扩展名可能带数字（.mp4）——只写 [a-z] 的话这条断言永远不会红（变异检查逮到的）
  for (const f of r.files) assert.ok(!/\s\.[a-z0-9]+$/i.test(f), `文件名扩展名前有空格：${f}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('关键词高亮：英文按整词 + 不分大小写，中文照旧按子串', async () => {
  const { toASS } = await import('../src/captions/build.mjs');
  const hl = (text, emphasis) => {
    const ass = toASS([{ startMs: 0, endMs: 2000, text, words: [] }], { preset: 'douyin', w: 1080, h: 1920, maxChars: 40, emphasis });
    const line = ass.split('\n').find((l) => l.startsWith('Dialogue'));
    return line.slice(line.lastIndexOf(',,') + 2);
  };
  // 子串匹配会把 "box" 高亮进 "boxes"：画面上是橙色 box + 黄色 es（真机验证过）
  assert.ok(!/\{\\c[^}]+\}box\{/.test(hl('Cats love cardboard boxes', ['box'])), '整词才高亮，不能撕开 boxes');
  // 模型给的关键词常是小写，句首却是大写——大小写敏感就静默不高亮
  assert.match(hl('Cats love cardboard boxes', ['cats']), /\{\\c[^}]+\}Cats\{/);
  assert.match(hl('Cats love cardboard boxes', ['boxes']), /\{\\c[^}]+\}boxes\{/);
  assert.match(hl('The box becomes their safe zone', ['safe zone']), /\{\\c[^}]+\}safe zone\{/, '多词短语要能高亮');
  // 中文没有词边界，行为必须和以前一模一样
  assert.match(hl('猫为什么总爱钻纸箱', ['纸箱']), /\{\\c[^}]+\}纸箱\{/);
});

test('出片链路上的中文都包在 T() 里（界面把日志/报错原样显示，字典翻不了）', async () => {
  const { cjkLiterals } = await import('./helpers-cjk-scan.mjs');
  // 白名单：这些中文**本来就该是中文**，或者外层已经按 lang 选过分支
  const OK = [
    "'AI 生成'",                                    // finalize 的缺省角标（调用方按语言传）
    'Apache-2.0（FLUX.1-schnell 本地生成）',          // 署名，外层 lang === 'en' ? … : … 已选
    "'-发布文案'", '-发布文案.txt',                    // 文件名，外层同上
    '标题候选：', '话题：', '发布说明：', 'AI 标识：', '素材署名：',   // PL 表，外层 lang === 'en' ? … : …
    "T('素材', 'footage')",                          // 内层已经是 T()
    "T('失败：', ' failed: ')",
    '你是短视频剪辑师', '画面意图：', '候选 ', '只输出 JSON 数组', '只输出一行 JSON 数组',   // 看图打分的中文提示词分支（按 intent 选）
  ];
  const bare = [];
  for (const f of ['src/pipeline/koubo-run.mjs', 'src/compose/koubo.mjs', 'src/sources/rank.mjs']) {
    for (const x of cjkLiterals(fs.readFileSync(path.join(root, f), 'utf-8'))) {
      if (x.wrapped || OK.some((k) => x.lit.includes(k))) continue;
      bare.push(`${f}:${x.line} ${x.lit}`);
    }
  }
  assert.deepEqual(bare, [], `这些中文会原样出现在英文用户眼前：\n${bare.join('\n')}`);
});

test('服务端报错按语言给：项目语言优先于请求参数', async () => {
  const src = fs.readFileSync(path.join(root, 'server', 'kaipian.mjs'), 'utf-8');
  const bare = [...src.matchAll(/error: '[^']*[一-鿿][^']*'/g)].map((m) => m[0]);
  assert.deepEqual(bare, [], `还有裸中文报错：\n${bare.join('\n')}`);
  assert.match(src, /const projLang = /, '项目语言优先：报错常常是事后翻日志看的，跟界面此刻切到哪儿无关');
});

test('抓正文：报错与截断提示跟着语言走（截断那句会随正文进提示词）', async () => {
  const { fetchArticle } = await import('../src/input/url-text.mjs');
  await assert.rejects(() => fetchArticle('ftp://x/y', { lang: 'en' }), /Enter an http\(s\) link/);
  await assert.rejects(() => fetchArticle('ftp://x/y', { lang: 'zh' }), /请输入 http\(s\) 链接/);
});

test('批量版本目录名认识英文音色前缀', async () => {
  const { planVariants } = await import('../src/pipeline/batch.mjs');
  const [v] = planVariants({ voices: ['en-US-AvaNeural'], captions: ['douyin'] }, { voice: { rate: 1 } });
  assert.equal(v.id, 'Ava-douyin');
  const [z] = planVariants({ voices: ['zh-CN-YunxiNeural'], captions: ['douyin'] }, { voice: { rate: 1 } });
  assert.equal(z.id, 'Yunxi-douyin');
});

test('退纯色底时 kind 要跟着改成 video（上轮是图片的话，mp4 会被加上 -loop 1 而整条出片失败）', { skip: !hasFfmpeg && '无 ffmpeg' }, async () => {
  const { runKoubo } = await import('../src/pipeline/koubo-run.mjs');
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-solid-'));
  const project = {
    id: 'solid-kind', line: 'koubo', lang: 'en',
    output: { w: 320, h: 568, fps: 12 },
    voice: { provider: 'edge-tts', voice: 'en-US-AvaNeural', rate: 1 },
    captions: { preset: 'douyin', maxChars: 34, style: {} },
    defaults: { visualSource: 'stock', cutEverySec: 0, localDirs: [] },
    publish: { titles: [], tags: [], note: '', aiLabel: false, aiLabelText: 'AI' },
    provenance: [],
    // 上一轮这一镜用的是图片——退纯色底（一个 .mp4）后 kind 若不改，
    // 渲染就会对 mp4 加 `-loop 1`，ffmpeg 报 Option loop not found，整条出片失败
    shots: [{ id: 's1', text: 'A box is a hiding spot.', query: 'zzz-no-such-footage-zzz', visualIntent: 'x', emphasis: [],
      visual: { source: 'stock', kind: 'image', file: null, candidateId: 'old:1', cost: { kind: 'free' } }, audio: null, durationSec: null, status: 'planned' }],
  };
  // 真配音要联网，这里造一段真的静音 mp3（probeDuration 读得出时长才走得到选画面那步）
  const synth = async (_text, { outFile }) => {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '2', outFile]);
    return { buffer: fs.readFileSync(outFile), durationMs: 2000, words: [] };
  };
  await runKoubo(project, { outDir: dir, synthesizeImpl: synth, localImage: false,
    fetchImpl: async () => { throw new Error('no network in test'); } }).catch(() => {});
  assert.equal(project.shots[0].visual.source, 'solid');
  assert.equal(project.shots[0].visual.kind, 'video', '纯色底是 mp4，kind 留着 image 会让 ffmpeg 报 Option loop not found');
  assert.equal(project.shots[0].visual.candidateId, null, '换成纯色底后不该还挂着上一条候选的 id');
  assert.equal(project.shots[0].visual.author, undefined, '一块纯色底不能署着上一条素材的作者（界面镜头卡片会显示 source · author）');
  assert.equal(project.shots[0].visual.license, undefined);
  assert.equal(project.shots[0].visual.fallback, true, '这是降级来的纯色底，要标 fallback，下一轮才会再去找素材');
  // 真的渲出了这一段——kind 错的话这里就是 "Option loop not found"
  assert.ok(fs.existsSync(path.join(dir, 'work', 's1.mp4')), '分段没渲出来');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('用户主动选「只用纯色底」时不标 fallback（否则下一轮会静默改去搜素材）', { skip: !hasFfmpeg && '无 ffmpeg' }, async () => {
  const { runKoubo } = await import('../src/pipeline/koubo-run.mjs');
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-solid2-'));
  const mk = () => ({
    id: 'solid-on-purpose', line: 'koubo', lang: 'zh',
    output: { w: 320, h: 568, fps: 12 },
    voice: { provider: 'edge-tts', voice: 'zh-CN-XiaoxiaoNeural', rate: 1 },
    captions: { preset: 'douyin', maxChars: 16, style: {} },
    defaults: { visualSource: 'solid', cutEverySec: 0, localDirs: [] },
    publish: { titles: [], tags: [], note: '', aiLabel: false, aiLabelText: 'AI' },
    provenance: [],
    // buildKouboProject 在 visualSource==='solid' 时就是这么标的：source 定死 solid、没有 fallback
    shots: [{ id: 's1', text: '一句口播。', query: 'q', visualIntent: 'x', emphasis: [],
      visual: { source: 'solid', provider: null, file: null, candidateId: null, cost: { kind: 'free' } }, audio: null, durationSec: null, status: 'planned' }],
  });
  const synth = async (_t, { outFile }) => {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '2', outFile]);
    return { buffer: fs.readFileSync(outFile), durationMs: 2000, words: [] };
  };
  // 一次跑不能联网找素材：fetchImpl 直接抛，证明它压根没去搜
  let searched = false;
  const project = mk();
  await runKoubo(project, { outDir: dir, synthesizeImpl: synth, localImage: false,
    fetchImpl: async () => { searched = true; throw new Error('不该来搜素材'); } }).catch(() => {});
  assert.equal(searched, false, '用户选了只用纯色底，就不该去搜素材');
  assert.equal(project.shots[0].visual.source, 'solid');
  assert.equal(project.shots[0].visual.fallback, undefined, '主动选的纯色底不是降级，标了 fallback 下一轮就会被清掉去搜素材');
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * 重出一镜之后，项目里留下的"上一轮的东西"。真机上这条片重出 3 次后：
 * credits 里挂着 4 条已经不在片中的素材，而每个镜头切好的多段全没了。
 *
 * 主画面必须是**图片**：视频主画面在复用时还能靠"同一条素材的不同时间点"把段补回来，
 * 正好把这个 bug 盖住（我第一版测试就是这么漏的，变异检查逮到的）。真机上丢段的
 * s4/s2 主画面都是图片——图片补不回来，段就真没了。
 */
test('重出一镜：旧署名要清掉，其余镜头切好的段要留住', { skip: !hasFfmpeg && '无 ffmpeg' }, async () => {
  const { runKoubo } = await import('../src/pipeline/koubo-run.mjs');
  const os = await import('node:os');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'os-redo-'));
  const img = (name, color) => {
    const f = path.join(d, name);
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:size=180x320`, '-frames:v', '1', f]);
    return f;
  };
  const a = img('a.png', 'navy'), b = img('b.png', 'maroon');
  const synth = async (_t, { outFile }) => {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '8', outFile]);
    return { buffer: fs.readFileSync(outFile), durationMs: 8000, words: [] };
  };
  const project = {
    id: 'redo-keep', line: 'koubo', lang: 'zh',
    output: { w: 180, h: 320, fps: 10 },
    voice: { provider: 'edge-tts', voice: 'zh-CN-XiaoxiaoNeural', rate: 1 },
    captions: { preset: 'douyin', maxChars: 16, style: {} },
    defaults: { visualSource: 'stock', cutEverySec: 2, localDirs: [] },
    publish: { titles: [], tags: [], note: '', aiLabel: false, aiLabelText: 'AI' },
    // 上一轮记下的：s1 的两条图片素材各一条署名，s2 一条——重出 s2 后 s2 那条必须消失
    provenance: [
      { shot: 's1', source: 'test', id: 'test:a', kind: 'image', license: 'CC0', author: null, page: null },
      { shot: 's1', source: 'test', id: 'test:b', kind: 'image', license: 'CC BY 2.0', author: '另一位', page: null },
      { shot: 's2', source: 'test', id: 'test:stale', kind: 'image', license: 'CC BY-SA 4.0', author: '某摄影师', page: null },
    ],
    shots: [
      // s1：上一轮切成了两段（两张不同的图）——这一轮不重定画面，就得原样留着
      { id: 's1', text: '第一镜的口播，够长，上一轮被切成了两段。', query: 'q1', visualIntent: 'x', emphasis: [],
        visual: { source: 'stock', provider: 'test', kind: 'image', file: a, candidateId: 'test:a', cost: { kind: 'free' },
          parts: [{ file: a, kind: 'image', id: 'test:a' }, { file: b, kind: 'image', id: 'test:b' }] }, audio: null, durationSec: null, status: 'planned' },
      { id: 's2', text: '第二镜的口播。', query: 'q2', visualIntent: 'y', emphasis: [],
        visual: { source: 'stock', provider: 'test', kind: 'image', file: a, candidateId: 'test:stale', cost: { kind: 'free' } }, audio: null, durationSec: null, status: 'planned' },
    ],
  };
  // 只重出 s2：它会重新找素材（这里断网 → 退纯色底），s1 原样复用
  await runKoubo(project, { outDir: d, synthesizeImpl: synth, localImage: false, only: ['s2'],
    fetchImpl: async () => { throw new Error('no network'); } }).catch(() => {});

  assert.equal(project.provenance.filter((x) => x.shot === 's2').length, 0,
    '重出这一镜后，上一轮的署名必须清掉——否则发布包会给根本没用到的作品署名（真机上累积了 4 条）');
  assert.equal(project.provenance.filter((x) => x.shot === 's1').length, 2, '没动的镜头，署名一条都不能少');
  assert.equal((project.shots[0].visual.parts ?? []).length, 2,
    's1 这一轮没重新定画面，上次切好的两段必须原样留着——重算时 extras 是空的，图片又补不了段，多段会被悄悄丢成一段');
  fs.rmSync(d, { recursive: true, force: true });
});

test('老项目自愈：出片结束时把已不在片中的署名清掉，并如实说清清了几条', { skip: !hasFfmpeg && '无 ffmpeg' }, async () => {
  const { runKoubo } = await import('../src/pipeline/koubo-run.mjs');
  const os = await import('node:os');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'os-prune-'));
  const a = path.join(d, 'a.png');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=navy:size=180x320', '-frames:v', '1', a]);
  const synth = async (_t, { outFile }) => {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '3', outFile]);
    return { buffer: fs.readFileSync(outFile), durationMs: 3000, words: [] };
  };
  const project = {
    id: 'prune', line: 'koubo', lang: 'zh',
    output: { w: 180, h: 320, fps: 10 },
    voice: { provider: 'edge-tts', voice: 'zh-CN-XiaoxiaoNeural', rate: 1 },
    captions: { preset: 'douyin', maxChars: 16, style: {} },
    defaults: { visualSource: 'stock', cutEverySec: 0, localDirs: [] },
    publish: { titles: [], tags: [], note: '', aiLabel: false, aiLabelText: 'AI' },
    // 2026-09 之前重出留下的：test:gone 早就不在片中了
    provenance: [
      { shot: 's1', source: 'test', id: 'test:live', kind: 'image', license: 'CC0', author: null, page: null },
      { shot: 's1', source: 'test', id: 'test:gone', kind: 'image', license: 'CC BY-SA 4.0', author: '某摄影师', page: null },
      // 本机出图的署名 id 是模型名，永远不在"用到的素材 id"里——按 id 一刀切会把它误删，
      // 那是**漏署**，比多署更严重（AI 生成内容的标识与许可要求）
      { shot: 's2', source: 'local-flux', id: 'flux-schnell-q2', kind: 'image', license: 'Apache-2.0', author: null, page: 'https://x' },
    ],
    shots: [
      { id: 's1', text: '一句口播。', query: 'q', visualIntent: 'x', emphasis: [],
        visual: { source: 'stock', provider: 'test', kind: 'image', file: a, candidateId: 'test:live', cost: { kind: 'free' } }, audio: null, durationSec: null, status: 'planned' },
      { id: 's2', text: '第二句口播。', query: 'q2', visualIntent: 'y', emphasis: [],
        visual: { source: 'local-image', provider: 'local-flux', kind: 'image', file: a, cost: { kind: 'free' } }, audio: null, durationSec: null, status: 'planned' },
    ],
  };
  const r = await runKoubo(project, { outDir: d, synthesizeImpl: synth, localImage: false });
  assert.deepEqual(r.provenance.map((x) => x.id).sort(), ['flux-schnell-q2', 'test:live'],
    '片中没用到的素材不能留在版权说明里，但本机出图的署名不能被误删（漏署比多署更严重）');
  assert.ok((r.final.notes ?? []).some((n) => /清掉 1 条/.test(n)), `清理要说出来，实际 notes：${JSON.stringify(r.final.notes)}`);
  fs.rmSync(d, { recursive: true, force: true });
});

/**
 * CLI 的语言。界面早就双语、片子也双语了,但命令行一直只说中文——
 * 英文用户装完敲第一条命令看到一屏中文,这是"能装"和"能用"之间最后一道墙。
 */
test('CLI 语言判定：显式 > 系统 locale > 中文兜底，且不认 --lang（那是片子的语言）', () => {
  const { execFileSync } = spawnSyncMod;
  const bin = path.join(root, 'bin', 'openshorts.mjs');
  const help = (env, args = ['--help']) => execFileSync(process.execPath, [bin, ...args],
    { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, encoding: 'utf8' });

  assert.match(help({ LANG: 'en_US.UTF-8' }), /^Usage: openshorts/, '系统 locale 是英文 → 英文');
  assert.match(help({ LANG: 'zh_CN.UTF-8' }), /^用法：openshorts/, '系统 locale 是中文 → 中文');
  assert.match(help({}), /^用法：openshorts/, 'locale 没设 → 中文（这个项目的主场，不能让老用户莫名变英文）');
  // C / POSIX 的字面意思是"不做本地化"，不是"用户说英语"——Docker / CI / cron 里普遍是这个值。
  // 把它当英语会让一堆中文用户的容器突然说英文。
  for (const loc of ['C', 'C.UTF-8', 'POSIX']) {
    assert.match(help({ LANG: loc }), /^用法：openshorts/, `LANG=${loc} 应视为"没设"→ 中文`);
  }
  assert.match(help({ LANG: 'en_US.UTF-8', OPENSHORTS_LANG: 'zh' }), /^用法：openshorts/, '显式指定压过 locale');
  assert.match(help({ LANG: 'zh_CN.UTF-8', OPENSHORTS_LANG: 'en' }), /^Usage: openshorts/);
  // --lang 在 new 里的含义是"片子说什么话",不该顺带切掉终端语言:
  // 中文用户出一条英文片,不该因此看到一屏英文提示。
  // (用真实用法测:`new --lang en` 缺 --topic 会报错,看那句报错是中文还是英文)
  let out = '';
  try { execFileSync(process.execPath, [bin, 'new', '--lang', 'en'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'zh_CN.UTF-8' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = String(e.stdout ?? '') + String(e.stderr ?? ''); }
  assert.match(out, /缺 --topic/, '--lang 是片子的语言，不是 CLI 的语言——中文用户出英文片，提示仍该是中文');
});

test('CLI 报错跟着语言走（英文用户撞到的第一批消息）', () => {
  const { execFileSync } = spawnSyncMod;
  const bin = path.join(root, 'bin', 'openshorts.mjs');
  const run = (env, args) => {
    try { return execFileSync(process.execPath, [bin, ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return String(e.stdout ?? '') + String(e.stderr ?? ''); }
  };
  const en = { OPENSHORTS_LANG: 'en' }, zh = { OPENSHORTS_LANG: 'zh' };
  assert.match(run(en, ['run']), /Usage: openshorts run/);
  assert.match(run(zh, ['run']), /用法：openshorts run/);
  assert.match(run(en, ['run', '/nope/x.json']), /Project file not found/);
  assert.match(run(en, ['new']), /Missing --topic/);
  assert.match(run(en, ['bacth']), /Unknown command/);
  // 英文下不该漏出中文（帮助屏会跟在未知命令后面一起打印）
  const unknown = run(en, ['bacth']);
  assert.ok(!/[一-鿿]/.test(unknown), `英文 CLI 输出里混着中文：\n${unknown.slice(0, 300)}`);
});

test('本机出图的档位标签与许可证说明也跟着语言走（sources / install-image 都会露出来）', async () => {
  const { sdImageStatus } = await import('../src/local/sd-image.mjs');
  const en = await sdImageStatus({ lang: 'en', memGB: 8 });
  const zh = await sdImageStatus({ lang: 'zh', memGB: 8 });
  assert.ok(!/[一-鿿]/.test(en.models[0].label), `英文档位标签里有中文：${en.models[0].label}`);
  assert.ok(!/[一-鿿]/.test(en.models[0].reason), `英文状态说明里有中文：${en.models[0].reason}`);
  assert.ok(!/[一-鿿]/.test(en.license), `英文许可证说明里有中文：${en.license}`);
  assert.match(en.models[0].reason, /needs ≥ 12 GB RAM/);
  assert.match(zh.models[0].reason, /需要 ≥ 12 GB 内存/, '中文侧一字未变');
  assert.match(zh.models[0].label, /轻档/);
});

/**
 * 防的是这次真栽的事：CLI 改成跟随系统 locale 之后,**本机全绿、CI 全红**——
 * CI runner 上 LANG=en_US.UTF-8,于是断言中文原话的老用例集体失败。
 * 这条把"跑测试的机器 locale 不同"这个变量本身钉死。
 */
test('断言中文原话的 CLI 用例必须钉住语言，不能被机器 locale 掀翻', () => {
  const src = fs.readFileSync(path.join(root, 'tests', 'cli-exit.test.mjs'), 'utf-8');
  assert.match(src, /OPENSHORTS_LANG: 'zh'/, 'cli-exit 的断言是中文原话，必须显式钉住语言');
  // 真跑一遍:把环境伪装成 CI runner(LANG=en_US.UTF-8),同时带上 cli-exit 用的那个钉子,
  // 输出必须仍是中文——这才证明钉子真的压得住机器 locale。
  // (不能从这里 spawn `node --test`:Node 会判为递归调用直接跳过,拿回一个空输出,
  //  断言反而"看起来失败"。第一版就是这么写的。)
  const { spawnSync: sp } = spawnSyncMod;
  const bin = path.join(root, 'bin', 'openshorts.mjs');
  const ci = { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };
  const pinned = sp(process.execPath, [bin, 'help'], { encoding: 'utf-8', env: { ...ci, OPENSHORTS_LANG: 'zh' } });
  assert.match(pinned.stdout, /^用法：openshorts/, 'CI 的 locale 下，钉住 zh 后必须仍是中文');
  const unpinned = sp(process.execPath, [bin, 'help'], { encoding: 'utf-8', env: ci });
  assert.match(unpinned.stdout, /^Usage: openshorts/, '不钉的话就会跟着 CI 的 locale 变英文——这正是当初 CI 全红的原因');
});
