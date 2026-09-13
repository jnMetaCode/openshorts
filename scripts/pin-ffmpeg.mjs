#!/usr/bin/env node
/**
 * 升级钉死的 ffmpeg 版本：把 eugeneware/ffmpeg-static 某个 Release 的官方 sha256（GitHub 资产的
 * digest 字段）打成 src/media/ffmpeg.mjs 里 FFMPEG_PIN 那张表的样子，贴过去即可。
 *
 *   node scripts/pin-ffmpeg.mjs           # latest
 *   node scripts/pin-ffmpeg.mjs b6.1.1    # 指定 tag
 *
 * 贴完记得真装一次（`openshorts install-ffmpeg --force`）并跑 doctor：钉的是版本，libass 在不在还得看。
 */
import { installProxy } from '../src/net/proxy.mjs';
import { FFMPEG_PIN, ffmpegAssetName } from '../src/media/ffmpeg.mjs';

await installProxy();
const tag = process.argv[2];
const url = `https://api.github.com/repos/eugeneware/ffmpeg-static/releases/${tag ? `tags/${tag}` : 'latest'}`;
const r = await fetch(url, { headers: { 'User-Agent': 'OpenShorts/2.0', Accept: 'application/vnd.github+json' } });
if (!r.ok) { console.error(`GitHub API ${r.status}：${url}`); process.exit(1); }
const rel = await r.json();
const wanted = new Set();
for (const kind of ['ffmpeg', 'ffprobe']) for (const [os, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'arm64'], ['linux', 'x64'], ['win32', 'x64']]) wanted.add(ffmpegAssetName(kind, os, arch));
const rows = []; const missing = [];
for (const name of [...wanted].sort()) {
  const a = rel.assets.find((x) => x.name === name);
  const sha = a?.digest?.match(/^sha256:([0-9a-f]{64})$/)?.[1];
  if (!sha) { missing.push(name); continue; }
  rows.push(`    '${name}': '${sha}',${FFMPEG_PIN.sha256[name] === sha ? '' : '   // 变了'}`);
}
console.log(`// ${rel.tag_name} · 发布于 ${rel.published_at.slice(0, 10)}${rel.tag_name === FFMPEG_PIN.tag ? '（与当前钉的版本相同）' : `（当前钉的是 ${FFMPEG_PIN.tag}）`}`);
console.log(`export const FFMPEG_PIN = {\n  tag: '${rel.tag_name}',\n  sha256: {\n${rows.join('\n')}\n  },\n};`);
if (missing.length) { console.error(`\n⚠️ 这些资产在该 Release 里没有 sha256 digest（或不存在）：${missing.join(', ')}——不能钉`); process.exit(2); }
