/**
 * 发布包（M3）：把成片、封面、SRT、标题/标签/发布说明、AI 标识、素材署名按平台规格打成一个目录 + zip。
 * 不做自动发布（草稿优先是 PRD 铁律）；给运营一个"拖进后台就能发"的文件夹。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// nameEn/noteEn 给英文成片用。原来只有中文——英文用户拿到的发布包里，
// 恰恰是「YouTube Shorts 规则」那一行是中文（真机打包出来才看见）。
export const PLATFORMS = {
  douyin:   { name: '抖音',   nameEn: 'Douyin', ratio: '9:16', maxTitle: 55, maxTags: 5, note: '标题 ≤ 55 字；话题最多 5 个；AI 生成内容需勾选"AI 生成"标识', noteEn: 'Title ≤ 55 chars; up to 5 hashtags; AI content must be flagged with the platform\'s "AI-generated" toggle' },
  shipinhao:{ name: '视频号', nameEn: 'WeChat Channels', ratio: '9:16', maxTitle: 60, maxTags: 5, note: '建议 1080×1920；描述 ≤ 60 字；勾选 AI 生成声明', noteEn: '1080×1920 recommended; description ≤ 60 chars; tick the AI-generated declaration' },
  bilibili: { name: 'B 站',   nameEn: 'Bilibili', ratio: '9:16', maxTitle: 80, maxTags: 10, note: '竖屏投稿；标题 ≤ 80 字；标签 ≤ 10 个；AI 内容需在简介声明', noteEn: 'Vertical upload; title ≤ 80 chars; ≤ 10 tags; declare AI content in the description' },
  shorts:   { name: 'YouTube Shorts', nameEn: 'YouTube Shorts', ratio: '9:16', maxTitle: 100, maxTags: 15, note: '≤ 60 s 才算 Shorts；标题 ≤ 100 字；#Shorts 标签', noteEn: 'Must be ≤ 60 s to count as a Short; title ≤ 100 chars; #Shorts tag' },
};

/**
 * 打包前按平台规格核一遍。以前这些规则只写在 PLATFORMS 的 note 里给人看，代码一条都不查：
 * 90 秒的片子照样能打成 Shorts 包（传上去就不算 Shorts 了），标题超长直接默默截断。
 * 这里只报事实、不拦着打包——和质检一个路子。
 */
export function checkPlatform(project, platform = 'douyin') {
  const pf = PLATFORMS[platform] ?? PLATFORMS.douyin;
  const out = [];
  const dur = project.final?.durationSec;
  // 保留一位小数：60.4 被 round 成 60 之后，"成片 60 秒，超过 60 秒"读起来是自相矛盾的
  if (platform === 'shorts' && dur > 60) out.push(`成片 ${dur.toFixed(1)} 秒，超过 60 秒就不算 Shorts 了（会当普通视频分发）`);
  const { w, h } = project.output ?? {};
  if (w && h && pf.ratio === '9:16' && w >= h) out.push(`成片是 ${w}×${h}（横屏），而 ${pf.name} 这个包是按竖屏 9:16 准备的`);
  const long = (project.publish?.titles ?? []).filter((t) => [...t].length > pf.maxTitle);
  if (long.length) out.push(`${long.length} 个标题超过 ${pf.maxTitle} 字，打包时按字数截断了`);
  const tags = project.publish?.tags ?? [];
  if (tags.length > pf.maxTags) out.push(`话题 ${tags.length} 个，${pf.name} 最多 ${pf.maxTags} 个，只留了前 ${pf.maxTags} 个`);
  if (!project.publish?.titles?.length) out.push('没有标题候选，发布文案里的标题是空的');
  return out;
}

/**
 * 发布文案的措辞按成片语言走。英文片交给运营的是一份中文说明、外加中文文件名，
 * 等于把"界面双语"的活干了一半——用户真正要交出去的那个文件夹还是中文的。
 * 平台规则原文（pf.note）保持中文：那是各平台的中文后台规则，翻译反而对不上。
 */
const PUB_LABELS = {
  zh: { pack: (n) => `【${n} 发布包】`, titles: '标题候选：', tags: '话题：', note: '发布说明：', ai: 'AI 标识：', aiDefault: '含 AI 生成内容', rules: (n) => `${n} 规则：`, credits: '素材署名：', checked: (n) => `⚠️ 按 ${n} 规格核对：`, qc: (p, w) => `质检：${p ? '通过' : '有问题'}，${w} 条提醒` },
  en: { pack: (n) => `[${n} publish pack] `, titles: 'Title options:', tags: 'Hashtags: ', note: 'Publishing note: ', ai: 'AI label: ', aiDefault: 'Contains AI-generated content', rules: (n) => `${n} rules: `, credits: 'Footage credits:', checked: (n) => `⚠️ Checked against ${n} specs:`, qc: (p, w) => `Quality check: ${p ? 'passed' : 'issues found'}, ${w} note(s)` },
};
export function buildPublishText(project, platform = 'douyin') {
  const pf = PLATFORMS[platform] ?? PLATFORMS.douyin;
  const en = project.lang === 'en';
  const L = en ? PUB_LABELS.en : PUB_LABELS.zh;
  const pfName = en ? (pf.nameEn ?? pf.name) : pf.name;
  const pfNote = en ? (pf.noteEn ?? pf.note) : pf.note;
  const titles = (project.publish?.titles ?? []).map((t) => [...t].slice(0, pf.maxTitle).join(''));
  const tags = (project.publish?.tags ?? []).slice(0, pf.maxTags);
  const lines = [`${L.pack(pfName)}${project.title || project.topic || ''}`, '', L.titles, ...titles.map((t, i) => `  ${i + 1}. ${t}`), '', `${L.tags}${tags.map((t) => `#${t}`).join(' ')}${platform === 'shorts' ? ' #Shorts' : ''}`, '', `${L.note}${project.publish?.note ?? ''}`, `${L.ai}${project.publish?.aiLabelText ?? L.aiDefault}`, '', `${L.rules(pfName)}${pfNote}`, ''];
  if (project.provenance?.length) { lines.push(L.credits); for (const p of project.provenance) {
      // license 里本来就可能带括号（"Apache-2.0（FLUX.1-schnell 本地生成）"），再套一层就成了双重括号
      const lic = String(p.license ?? '').trim();
      lines.push(`  ${p.shot}: ${p.source}${p.author ? ` · ${p.author}` : ''}${lic ? ` · ${lic}` : ''}${p.page ? `\n      ${p.page}` : ''}`);
    } }
  const warns = checkPlatform(project, platform);
  if (warns.length) lines.push('', L.checked(pfName), ...warns.map((x) => `  - ${x}`));
  if (project.final?.quality) lines.push('', L.qc(project.final.quality.pass, project.final.quality.warnings ?? 0), ...(project.final.quality.items ?? []).filter((i) => i.status !== 'pass').map((i) => `  - ${i.msg}`));
  return lines.join('\n') + '\n';
}

export function makePublishPack(project, { platform = 'douyin', outDir } = {}) {
  if (!project.final?.file || !fs.existsSync(project.final.file)) throw new Error('还没有成片');
  const pf = PLATFORMS[platform] ?? PLATFORMS.douyin;
  const en = project.lang === 'en';
  const dir = outDir ?? path.join(path.dirname(project.final.file), en ? `publish-pack-${platform}` : `发布包-${pf.name}`);
  fs.mkdirSync(dir, { recursive: true });
  // slice 可能正好切在词中间留下尾随空格 —— "…Will Blow .mp4" 这种文件名在 Windows 上是非法的
  // （英文标题动辄超过 40 字符，中文标题短，所以这个洞一直没露头）
  const base = (project.title || project.id).replace(/[\\/:*?"<>|]/g, '').slice(0, 40).trim();
  fs.copyFileSync(project.final.file, path.join(dir, `${base}.mp4`));
  if (project.final.cover && fs.existsSync(project.final.cover)) fs.copyFileSync(project.final.cover, path.join(dir, `${base}${en ? '-cover' : '-封面'}.jpg`));
  if (project.final.srt && fs.existsSync(project.final.srt)) fs.copyFileSync(project.final.srt, path.join(dir, `${base}.srt`));
  fs.writeFileSync(path.join(dir, `${base}${en ? '-publish' : '-发布文案'}.txt`), buildPublishText(project, platform));
  let zip = null;
  try { zip = dir + '.zip'; fs.rmSync(zip, { force: true }); execFileSync(process.platform === 'win32' ? 'tar' : 'zip', process.platform === 'win32' ? ['-a', '-cf', zip, '-C', path.dirname(dir), path.basename(dir)] : ['-qrj', zip, dir]); } catch { zip = null; }
  return { dir, zip, files: fs.readdirSync(dir), warnings: checkPlatform(project, platform) };
}
