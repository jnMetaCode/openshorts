/**
 * 发布包（M3）：把成片、封面、SRT、标题/标签/发布说明、AI 标识、素材署名按平台规格打成一个目录 + zip。
 * 不做自动发布（草稿优先是 PRD 铁律）；给运营一个"拖进后台就能发"的文件夹。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const PLATFORMS = {
  douyin:   { name: '抖音',   ratio: '9:16', maxTitle: 55, maxTags: 5, note: '标题 ≤ 55 字；话题最多 5 个；AI 生成内容需勾选"AI 生成"标识' },
  shipinhao:{ name: '视频号', ratio: '9:16', maxTitle: 60, maxTags: 5, note: '建议 1080×1920；描述 ≤ 60 字；勾选 AI 生成声明' },
  bilibili: { name: 'B 站',   ratio: '9:16', maxTitle: 80, maxTags: 10, note: '竖屏投稿；标题 ≤ 80 字；标签 ≤ 10 个；AI 内容需在简介声明' },
  shorts:   { name: 'YouTube Shorts', ratio: '9:16', maxTitle: 100, maxTags: 15, note: '≤ 60 s 才算 Shorts；标题 ≤ 100 字；#Shorts 标签' },
};

export function buildPublishText(project, platform = 'douyin') {
  const pf = PLATFORMS[platform] ?? PLATFORMS.douyin;
  const titles = (project.publish?.titles ?? []).map((t) => [...t].slice(0, pf.maxTitle).join(''));
  const tags = (project.publish?.tags ?? []).slice(0, pf.maxTags);
  const lines = [`【${pf.name} 发布包】${project.title || project.topic || ''}`, '', '标题候选：', ...titles.map((t, i) => `  ${i + 1}. ${t}`), '', `话题：${tags.map((t) => `#${t}`).join(' ')}${platform === 'shorts' ? ' #Shorts' : ''}`, '', `发布说明：${project.publish?.note ?? ''}`, `AI 标识：${project.publish?.aiLabelText ?? '含 AI 生成内容'}（${pf.note}）`, ''];
  if (project.provenance?.length) { lines.push('素材署名：'); for (const p of project.provenance) lines.push(`  ${p.shot}: ${p.source}${p.author ? ` · ${p.author}` : ''}${p.page ? ` ${p.page}` : ''}${p.license ? `（${p.license}）` : ''}`); }
  if (project.final?.quality) lines.push('', `质检：${project.final.quality.pass ? '通过' : '有问题'}，${project.final.quality.warnings ?? 0} 条提醒`, ...(project.final.quality.items ?? []).filter((i) => i.status !== 'pass').map((i) => `  - ${i.msg}`));
  return lines.join('\n') + '\n';
}

export function makePublishPack(project, { platform = 'douyin', outDir } = {}) {
  if (!project.final?.file || !fs.existsSync(project.final.file)) throw new Error('还没有成片');
  const pf = PLATFORMS[platform] ?? PLATFORMS.douyin;
  const dir = outDir ?? path.join(path.dirname(project.final.file), `发布包-${pf.name}`);
  fs.mkdirSync(dir, { recursive: true });
  const base = (project.title || project.id).replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
  fs.copyFileSync(project.final.file, path.join(dir, `${base}.mp4`));
  if (project.final.cover && fs.existsSync(project.final.cover)) fs.copyFileSync(project.final.cover, path.join(dir, `${base}-封面.jpg`));
  if (project.final.srt && fs.existsSync(project.final.srt)) fs.copyFileSync(project.final.srt, path.join(dir, `${base}.srt`));
  fs.writeFileSync(path.join(dir, `${base}-发布文案.txt`), buildPublishText(project, platform));
  let zip = null;
  try { zip = dir + '.zip'; fs.rmSync(zip, { force: true }); execFileSync(process.platform === 'win32' ? 'tar' : 'zip', process.platform === 'win32' ? ['-a', '-cf', zip, '-C', path.dirname(dir), path.basename(dir)] : ['-qrj', zip, dir]); } catch { zip = null; }
  return { dir, zip, files: fs.readdirSync(dir) };
}
