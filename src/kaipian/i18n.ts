// 极简 i18n：以中文原文为 key，英文为值；缺翻译时回退中文。切换存 localStorage（仅本机偏好）。
const EN: Record<string, string> = {
  '文案进，成片出 · 本地优先 · 花多少钱运行前看见': 'Script in, video out · local-first · see the cost before you run',
  '最近项目…': 'Recent projects…', '图层动画编辑器（v1）': 'Layer-animation editor (v1)',
  '输入': 'Input', '来源与花费': 'Sources & cost', '预览与调整': 'Preview & adjust', '出片与发布': 'Render & publish',
  '口播短视频': 'Talking-head short', '科普 / 观点 / 带货 · 默认零成本': 'Explainer / opinion / product · free by default',
  'AI 短剧': 'AI mini-drama', '一段故事 → 三镜成片 · 本地草稿 / 云端成片': 'One story → 3-shot film · local draft / cloud final',
  '话题或文案': 'Topic or script', '目标时长': 'Target length', '语气': 'Tone', '下一步：选来源': 'Next: choose sources', '下一步：选档位': 'Next: choose tier',
  '画面来源': 'Visual sources', '素材库': 'Stock', 'AI 配图': 'AI images', '本地生成': 'Local AI', '云端出片': 'Cloud AI',
  '本次画面': 'Visuals for this run', '本地素材夹（可选）': 'Local footage folder (optional)', '配音与字幕': 'Voice & captions', '音色': 'Voice', '字幕样式': 'Caption style',
  '本次花费：0 元': 'Cost this run: ¥0', '上一步': 'Back', '生成脚本 →': 'Write script →', '▶ 试听': '▶ Preview', '保存 key': 'Save keys',
  '保存修改': 'Save', '出片 →': 'Render →', '改文案重出': 'Edit & re-render', '再做一条': 'Make another', '下载 mp4': 'Download mp4', '封面': 'Cover',
  '标题（点复制）': 'Titles (click to copy)', '话题': 'Hashtags', '发布说明': 'Publish note', '素材署名': 'Footage credits', '提示': 'Notes',
  '发布包': 'Publish pack', '打发布包（mp4 + 封面 + SRT + 文案）': 'Build pack (mp4 + cover + SRT + copy)', '批量出版本（同脚本换音色 / 字幕样式）': 'Batch versions (same script × voices / caption styles)',
  '音色（多选）': 'Voices (multi)', '字幕样式（多选）': 'Caption styles (multi)', '出片档位': 'Render tier', '本地草稿档 · 不花钱': 'Local draft · free', '云端成片档 · 按秒计费': 'Cloud final · billed per second',
  '看花费': 'Estimate cost', '确认花费，出片 →': 'Confirm cost, render →', '正在出片': 'Rendering', '一段故事（一两句话即可，AI 编剧会拆成 3 镜）': 'A story (one or two sentences; the AI writer splits it into 3 shots)',
  '题材': 'Genre', '视觉风格': 'Visual style', '画幅': 'Aspect', '横版 16:9': 'Landscape 16:9', '竖版 9:16': 'Portrait 9:16', '抓正文': 'Fetch article',
  '按验收意见重出': 'Redo per review notes', '提意见 / 换来源': 'Give notes / switch source', '重出这一镜': 'Redo this shot', '同一来源': 'Same source', '下载成片': 'Download film', '换档位再出一版': 'Re-render on another tier',
  '验收通过': 'Review passed', '未验收': 'Not reviewed', '视频供应商': 'Video provider', '视频模型': 'Video model', '档位': 'Tier', '每镜秒数': 'Seconds per shot',
};
export type Lang = 'zh' | 'en';
export const getLang = (): Lang => { try { const q = new URLSearchParams(location.search).get('lang'); if (q === 'en' || q === 'zh') return q; return (localStorage.getItem('kp-lang') as Lang) || (navigator.language.startsWith('zh') ? 'zh' : 'en'); } catch { return 'zh'; } };
export const setLang = (l: Lang) => { try { localStorage.setItem('kp-lang', l); } catch { /* noop */ } };
export const makeT = (lang: Lang) => (s: string) => (lang === 'en' ? EN[s] ?? s : s);
