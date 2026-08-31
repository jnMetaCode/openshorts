import React, {useEffect, useRef, useState} from 'react';
import './kaipian.css';
import {getLang, setLang, makeT, type Lang} from './i18n';

type Src = {ok: boolean; reason: string; tier?: string};
type Sources = {stock: Src; image: Src; local: Src; cloud: Src; layered: Src; tools: {ffmpeg: boolean; whisper: boolean; magick: boolean}};
type Voice = {id: string; label: string};
type Shot = {id: string; text: string; visualIntent: string; query: string; emphasis: string[]; durationSec: number | null; status: string; visual: {source: string | null; file: string | null; author?: string | null; license?: string}};
type DramaShot = {id: string; kind: 'video' | 'image'; order: number; durationSec: number | null; visual: {source: string; provider: string | null; model: string | null; file: string}; verification: {pass: boolean; failed: string[]; reworked: boolean} | null; status: string; stepName: string};
type Project = {id: string; title: string; topic: string; line?: string; tier?: string; inputs?: Record<string, string>; shots: Shot[]; voice: {voice: string; rate: number}; captions: {preset: string}; defaults: {visualSource: string; localDirs: string[]}; publish: {titles: string[]; tags: string[]; note: string; aiLabelText: string}; final?: {file: string; srt: string; cover: string | null; publish: string; durationSec: number; notes: string[]; quality?: {pass: boolean; warnings: number; items: Array<{id: string; status: string; msg: string}>}} | null; provenance: Array<{shot: string; source: string; author?: string | null; license?: string; page?: string | null}>};

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => { const r = await fetch(url, {headers: {'Content-Type': 'application/json'}, ...init}); const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const fileUrl = (p: Project, abs: string) => `/api/kaipian/projects/${encodeURIComponent(p.id)}/file/${encodeURIComponent(abs.split('/').pop() || '')}`;

export const Kaipian = () => {
  const [lang, setLangState] = useState<Lang>(getLang());
  const t = makeT(lang);
  const [step, setStep] = useState(1);
  const [line, setLine] = useState<'koubo' | 'drama'>('koubo');
  const [story, setStory] = useState('');
  const [genre, setGenre] = useState('剧情短剧');
  const [style, setStyle] = useState('美式复古好莱坞');
  const [ratio, setRatio] = useState('16:9');
  const [tier, setTier] = useState<'local' | 'cloud'>('cloud');
  const [dramaOpts, setDramaOpts] = useState<{localReady: boolean; cloudProviders: string[]; doctor: string[]} | null>(null);
  const [cloud, setCloud] = useState({video_provider: 'apimart', video_model: 'veo3.1-fast', video_resolution: '720p', video_duration: '8', image_provider: '', image_model: ''});
  const [preflight, setPreflight] = useState<string[]>([]);
  const [localSt, setLocalSt] = useState<{ok: boolean; cliFound: boolean; memGB: number; modelsDir: string; cli: string; license: string; models: Array<{id: string; label: string; usable: boolean; present: boolean; missing: string[]; reason?: string}>} | null>(null);
  const [agree, setAgree] = useState(false);
  const [dl, setDl] = useState<{file?: string; bytes?: number; total?: number; log: string[]} | null>(null);
  const [batchVoices, setBatchVoices] = useState<string[]>([]);
  const [batchCaptions, setBatchCaptions] = useState<string[]>(['douyin']);
  const [batchResults, setBatchResults] = useState<Array<{id: string; ok: boolean; file?: string; durationSec?: number; error?: string}>>([]);
  const [platform, setPlatform] = useState('douyin');
  const [pack, setPack] = useState<{dir: string; zipName: string | null; files: string[]} | null>(null);
  const [providers, setProviders] = useState<{video: Array<{id: string; shape: string; hasKey: boolean; models: Array<{id: string; resolutions: string[]; durations: number[]; ratios: string[]}>}>; image: Array<{id: string; models: string[]}>} | null>(null);
  const [redo, setRedo] = useState<{shot: string; feedback: string; tier: 'same' | 'local' | 'cloud'} | null>(null);
  const [topic, setTopic] = useState('');
  const [articleUrl, setArticleUrl] = useState('');
  const [duration, setDuration] = useState('60秒');
  const [tone, setTone] = useState('科普讲解');
  const [sources, setSources] = useState<Sources | null>(null);
  const [ff, setFf] = useState<{found: boolean; version: string; subtitles: boolean; drawtext: boolean; managed: boolean} | null>(null);
  const [textProv, setTextProv] = useState<{providers: Array<{id: string; hasKey: boolean; fromEnv: boolean; envKey: string | null; models: string[]; vision: boolean}>; vision: {provider: string; model: string}} | null>(null);
  const [mdl, setMdl] = useState({provider: '', model: '', apiKey: ''});   // 写脚本的模型（供应商 + 模型 id + key）
  const [vis, setVis] = useState({provider: '', model: ''});
  const [testRes, setTestRes] = useState<{ok: boolean; msg: string} | null>(null);
  const [gen, setGen] = useState<{ok: boolean; cliFound: boolean; memGB: number; license: string; ready: string | null; models: Array<{id: string; label: string; sizeGB: number; present: boolean; usable: boolean; reason: string}>} | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState('zh-CN-XiaoxiaoNeural');
  const [captions, setCaptions] = useState('douyin');
  const [source, setSource] = useState<'stock' | 'solid'>('stock');
  const [localDir, setLocalDir] = useState('');
  const [aoStatus, setAoStatus] = useState<{hasTextKey: boolean; saved: string[]; envs: string[]; aoHome: string} | null>(null);
  const [cfg, setCfg] = useState<{stock: {hasPexels: boolean; hasPixabay: boolean; pexelsKey: string; pixabayKey: string}; outputDir: string} | null>(null);
  const [keyDraft, setKeyDraft] = useState({pexelsKey: '', pixabayKey: ''});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [project, setProject] = useState<Project | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [projects, setProjects] = useState<Array<{id: string; title: string; final: boolean; updatedAt: string}>>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const runningEs = useRef<EventSource | null>(null);

  const refresh = async () => {
    const [s, v, a, c, ps] = await Promise.all([api<Sources>('/api/kaipian/sources'), api<Voice[]>('/api/kaipian/voices'), api<any>('/api/kaipian/ao-status'), api<any>('/api/kaipian/config'), api<any>('/api/kaipian/projects')]);
    setSources(s); setVoices(v); setAoStatus(a); setCfg(c); setProjects(ps); if (c?.tts?.voice) setVoice(c.tts.voice);
    api<any>('/api/kaipian/drama/options').then(setDramaOpts).catch(() => {});
    api<any>('/api/kaipian/drama/providers').then(setProviders).catch(() => {});
    api<any>('/api/kaipian/local/status').then(setLocalSt).catch(() => {});
    api<any>('/api/kaipian/ffmpeg').then(setFf).catch(() => {});
    api<any>('/api/kaipian/local-image').then(setGen).catch(() => {});
    api<any>('/api/kaipian/providers/text').then((r) => { setTextProv(r); setVis({provider: r.vision?.provider ?? '', model: r.vision?.model ?? ''}); if (r.text?.provider) setMdl((m) => (m.provider ? m : {provider: r.text.provider, model: r.text.model ?? '', apiKey: ''})); }).catch(() => {});
  };
  useEffect(() => {
    refresh().catch((e) => setError(String(e.message)));
    // ?project=<id> 深链：直接打开某个项目（做完的落在第 4 步，没做完的落在第 3 步）
    const id = new URLSearchParams(location.search).get('project');
    if (id) openProject(id).catch((e) => setError(String(e.message)));
  }, []);

  const grabUrl = async () => { setBusy('抓取文章…'); setError(''); try { const a = await api<{title: string; text: string; chars: number}>('/api/kaipian/fetch-url', {method: 'POST', body: JSON.stringify({url: articleUrl})}); setTopic(`${a.title ? a.title + '\n\n' : ''}${a.text}`); } catch (e: any) { setError(e.message); } finally { setBusy(''); } };
  const preview = async () => { setBusy('试听中…'); try { const r = await api<{dataUrl: string}>('/api/kaipian/tts/preview', {method: 'POST', body: JSON.stringify({voice, text: topic.slice(0, 40) || '你有没有发现，猫为什么总爱钻纸箱？'})}); if (audioRef.current) { audioRef.current.src = r.dataUrl; await audioRef.current.play(); } } catch (e: any) { setError(e.message); } finally { setBusy(''); } };
  const saveKeys = async () => { await api('/api/kaipian/config', {method: 'PUT', body: JSON.stringify({...keyDraft, tts: {voice}})}); setKeyDraft({pexelsKey: '', pixabayKey: ''}); await refresh(); };
  const createProject = async () => {
    setError(''); setBusy('AI 正在写脚本（20–60 秒）…');
    try { const p = await api<Project>('/api/kaipian/new', {method: 'POST', body: JSON.stringify({topic, duration, tone, voice, captions, source, localDir})}); setProject(p); setStep(3); await refresh(); }
    catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };
  const saveShots = async () => { if (!project) return; const p = await api<Project>(`/api/kaipian/projects/${encodeURIComponent(project.id)}`, {method: 'PUT', body: JSON.stringify({shots: project.shots.map((s) => ({id: s.id, text: s.text, query: s.query, visualIntent: s.visualIntent})), voice: {voice}, captions: {preset: captions}})}); setProject(p); };
  // only 传镜头 id 就是「只重出这几镜」：其余镜头的配音与分段按指纹复用，不重配音也不重花时间
  const runProject = async (only?: string[]) => {
    if (!project) return; await saveShots(); setLog([]); setBusy(only ? `重出 ${only.join('、')}…` : '出片中…'); setError('');
    const q = only?.length ? `?only=${encodeURIComponent(only.join(','))}` : '';
    const es = new EventSource(`/api/kaipian/projects/${encodeURIComponent(project.id)}/run${q}`);
    runningEs.current = es;
    es.addEventListener('log', (e: any) => setLog((l) => [...l, JSON.parse(e.data).m]));
    es.addEventListener('done', async () => { es.close(); runningEs.current = null; const p = await api<Project>(`/api/kaipian/projects/${encodeURIComponent(project.id)}`); setProject(p); setBusy(''); setStep(4); await refresh(); });
    es.addEventListener('error', (e: any) => { try { setError(JSON.parse(e.data).m); } catch { setError('出片中断'); } es.close(); runningEs.current = null; setBusy(''); });
  };
  const cancelRun = async () => {
    if (!project) return;
    runningEs.current?.close(); runningEs.current = null;   // 关掉 SSE，服务端据此中止 ffmpeg
    try { await api(`/api/kaipian/projects/${encodeURIComponent(project.id)}/cancel`, {method: 'POST'}); } catch { /* 已经停了 */ }
    setBusy(''); setLog((l) => [...l, '已取消（进度已存盘，再点出片会接着来）']);
  };
  const dramaBody = () => ({story, genre, style, tier, video_ratio: ratio, ...(tier === 'cloud' ? cloud : {image_provider: cloud.image_provider, image_model: cloud.image_model})});
  const dramaPreflight = async () => { setError(''); setBusy('估算花费…'); try { const r = await api<{lines: string[]; ok: boolean; raw?: string}>('/api/kaipian/drama/preflight', {method: 'POST', body: JSON.stringify(dramaBody())}); setPreflight(r.ok ? r.lines : [r.raw || '预览失败']); setStep(2); } catch (e: any) { setError(e.message); } finally { setBusy(''); } };
  const dramaRun = () => {
    setLog([]); setBusy(tier === 'local' ? '本地出片中（每镜约 3–4 分钟，共 3 镜 + 定妆图）…' : '云端出片中（通常 3–8 分钟）…'); setError(''); setStep(3);
    const qs = new URLSearchParams(Object.entries(dramaBody()).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)]));
    const es = new EventSource(`/api/kaipian/drama/run?${qs}`);
    es.addEventListener('log', (e: any) => setLog((l) => [...l, JSON.parse(e.data).m]));
    es.addEventListener('done', async (e: any) => { es.close(); const {id} = JSON.parse(e.data); const p = await api<Project>(`/api/kaipian/projects/${encodeURIComponent(id)}`); setProject(p); setBusy(''); setStep(4); await refresh(); });
    es.addEventListener('error', (e: any) => { try { setError(JSON.parse(e.data).m); } catch { setError('出片中断'); } es.close(); setBusy(''); });
  };
  const dramaRedo = (shot: string, feedback: string, tierSel: 'same' | 'local' | 'cloud') => {
    if (!project) return; setLog([]); setError(''); setBusy(`重出 ${shot} 中…`); setRedo(null);
    const qs = new URLSearchParams({shot, feedback, ...(tierSel !== 'same' ? {tier: tierSel} : {}), ...(tierSel === 'cloud' ? {video_provider: cloud.video_provider, video_model: cloud.video_model, video_resolution: cloud.video_resolution, video_duration: cloud.video_duration} : {})});
    const es = new EventSource(`/api/kaipian/projects/${encodeURIComponent(project.id)}/drama/redo?${qs}`);
    es.addEventListener('log', (e: any) => setLog((l) => [...l, JSON.parse(e.data).m]));
    es.addEventListener('done', async () => { es.close(); const p = await api<Project>(`/api/kaipian/projects/${encodeURIComponent(project.id)}`); setProject(p); setBusy(''); });
    es.addEventListener('error', (e: any) => { try { setError(JSON.parse(e.data).m); } catch { setError('重出中断'); } es.close(); setBusy(''); });
  };
  const installLocal = (what: 'sdcli' | 'model' | 'all', model = 'minimax-h3-q2') => {
    setDl({log: []}); setError('');
    const es = new EventSource(`/api/kaipian/local/install?what=${what}&model=${model}&agree=1`);
    es.addEventListener('log', (e: any) => setDl((d) => ({...(d ?? {log: []}), log: [...(d?.log ?? []), JSON.parse(e.data).m]})));
    es.addEventListener('progress', (e: any) => { const p = JSON.parse(e.data); setDl((d) => ({...(d ?? {log: []}), file: p.file, bytes: p.bytes, total: p.total})); });
    es.addEventListener('done', async (e: any) => { es.close(); setLocalSt((s) => ({...(s as any), ...JSON.parse(e.data)})); setDl((d) => ({...(d ?? {log: []}), log: [...(d?.log ?? []), '完成'], bytes: undefined})); await refresh(); });
    es.addEventListener('error', (e: any) => { try { setError(JSON.parse(e.data).m); } catch { setError('下载中断（可重试，支持断点续传）'); } es.close(); });
  };
  // Homebrew 的 ffmpeg 已不含 libass ⇒ 字幕烧不进画面，成片在抖音上没有字。一键装一份带 libass 的到 ~/.openshorts/bin。
  const installFfmpeg = () => {
    setDl({log: []}); setError('');
    const es = new EventSource('/api/kaipian/ffmpeg/install');
    es.addEventListener('log', (e: any) => setDl((d) => ({...(d ?? {log: []}), log: [...(d?.log ?? []), JSON.parse(e.data).m]})));
    es.addEventListener('progress', (e: any) => { const p = JSON.parse(e.data); setDl((d) => ({...(d ?? {log: []}), file: p.file, bytes: p.bytes, total: p.total})); });
    es.addEventListener('done', async (e: any) => { es.close(); setFf(JSON.parse(e.data)); setDl(null); await refresh(); });
    es.addEventListener('error', (e: any) => { try { setError(JSON.parse(e.data).m); } catch { setError('ffmpeg 下载中断，可重试'); } es.close(); });
  };
  // 本地文生图模型（6.4 / 10 GB）：装了之后素材库没命中的镜头会本机现画一张，而不是退纯色底
  const installLocalImage = (model: string) => {
    setDl({log: []}); setError('');
    const es = new EventSource(`/api/kaipian/local-image/install?model=${encodeURIComponent(model)}`);
    es.addEventListener('log', (e: any) => setDl((d) => ({...(d ?? {log: []}), log: [...(d?.log ?? []), JSON.parse(e.data).m]})));
    es.addEventListener('progress', (e: any) => { const p = JSON.parse(e.data); setDl((d) => ({...(d ?? {log: []}), file: p.file, bytes: p.bytes, total: p.total})); });
    es.addEventListener('done', async (e: any) => { es.close(); setGen(JSON.parse(e.data)); setDl(null); await refresh(); });
    es.addEventListener('error', (e: any) => { try { setError(JSON.parse(e.data).m); } catch { setError('模型下载中断（支持断点续传，可重试）'); } es.close(); });
  };
  // 存 key 之前先拿它真发一次请求：key 打错、余额没了、模型 id 不对，都在这里说清楚，别等出片时才炸
  const testModel = async (provider: string, model: string, apiKey?: string) => {
    if (!provider || !model) { setTestRes({ok: false, msg: '要先选供应商和模型'}); return false; }
    setTestRes(null); setBusy('验证模型…');
    try {
      const r = await api<{ok: boolean; reply?: string; error?: string}>('/api/kaipian/ao-keys/test', {method: 'POST', body: JSON.stringify({provider, model, apiKey})});
      setTestRes({ok: r.ok, msg: r.ok ? `通了，模型回了「${r.reply}」` : (r.error ?? '失败')});
      return r.ok;
    } catch (e: any) { setTestRes({ok: false, msg: e.message}); return false; } finally { setBusy(''); }
  };
  const saveTextModel = async () => {
    if (!(await testModel(mdl.provider, mdl.model, mdl.apiKey))) return;
    if (mdl.apiKey.trim()) await api('/api/kaipian/ao-keys', {method: 'POST', body: JSON.stringify({provider: mdl.provider, apiKey: mdl.apiKey.trim()})});
    // 存下来并真的用它写脚本——只存 key 不记模型的话，AO 还是会跑它自己的默认供应商
    await api('/api/kaipian/config', {method: 'PUT', body: JSON.stringify({text: {provider: mdl.provider, model: mdl.model}})});
    setMdl({...mdl, apiKey: ''}); await refresh();
  };
  const saveVision = async () => {
    if (vis.provider && !(await testModel(vis.provider, vis.model))) return;
    await api('/api/kaipian/config', {method: 'PUT', body: JSON.stringify({vision: vis})});
    await refresh();
  };
  const runBatch = () => {
    if (!project) return; setBatchResults([]); setLog([]); setBusy('批量出片中…'); setError('');
    const es = new EventSource(`/api/kaipian/projects/${encodeURIComponent(project.id)}/batch?voices=${encodeURIComponent(batchVoices.join(','))}&captions=${encodeURIComponent(batchCaptions.join(','))}`);
    es.addEventListener('log', (e: any) => setLog((l) => [...l, JSON.parse(e.data).m]));
    es.addEventListener('variant', (e: any) => setBatchResults((r) => [...r, JSON.parse(e.data)]));
    es.addEventListener('done', () => { es.close(); setBusy(''); });
    es.addEventListener('error', (e: any) => { try { setError(JSON.parse(e.data).m); } catch { setError('批量中断'); } es.close(); setBusy(''); });
  };
  const makePack = async () => { if (!project) return; setBusy('打发布包…'); try { setPack(await api(`/api/kaipian/projects/${encodeURIComponent(project.id)}/publish-pack`, {method: 'POST', body: JSON.stringify({platform})})); } catch (e: any) { setError(e.message); } finally { setBusy(''); } };
  const openProject = async (id: string) => { const p = await api<Project>(`/api/kaipian/projects/${encodeURIComponent(id)}`); setProject(p); setStep(p.final ? 4 : 3); };
  const copy = (t: string) => navigator.clipboard?.writeText(t);

  const Steps = () => <ol className="kp-steps">{['输入', '来源与花费', '预览与调整', '出片与发布'].map((n0, i) => { const n = t(n0); return <li key={n0} className={step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}><span>{i + 1}</span>{n}</li>; })}</ol>;
  /**
   * 常驻侧栏。回答两个以前无处可看的问题：
   * ①「我这台机器现在能干什么」——ffmpeg 能不能烧字幕、本机能不能出图、画面有没有人把关；
   * ②「模型在哪儿配」——写脚本的文本模型以前只能去改 AO 密钥页或环境变量，
   *   看图把关的模型更是只能改 ~/.openshorts/config.json 或加命令行参数，界面里完全没有入口。
   *   而看图把关恰恰是决定"会不会把一口钟配进猫科普"的那个开关。
   */
  const Aside = () => {
    const visionOn = !!(textProv?.vision?.provider && textProv?.vision?.model);
    const row = (label: string, ok: boolean, text: string) =>
      <div className={`kp-stat ${ok ? 'ok' : 'bad'}`}><b>{label}</b><span>{ok ? '✅ ' : '⛔ '}{text}</span></div>;
    return <aside className="kp-aside">
      <h4>{t('这台机器')}</h4>
      {row('ffmpeg', !!ff?.subtitles, ff ? (ff.found ? (ff.subtitles ? `${ff.version} 可烧字幕` : '缺 libass，字幕烧不进画面') : '没找到') : '…')}
      {ff && ff.found && !ff.subtitles && <button onClick={installFfmpeg} disabled={!!dl}>{t('装一份带 libass 的（40 MB）')}</button>}
      {row(t('看图把关'), visionOn, visionOn ? `${textProv!.vision.provider} / ${textProv!.vision.model}` : '没开——画面只按检索词字面匹配')}
      {row(t('本机出图'), !!gen?.ok, gen?.ok ? `${gen.ready} 就绪` : '没装模型，找不到素材时退纯色底')}
      {row(t('文本模型'), !!aoStatus?.hasTextKey, aoStatus?.hasTextKey ? [...(aoStatus.saved ?? []), ...(aoStatus.envs ?? [])].join('、') : '没配，第 1 步写不了脚本')}
      {row(t('素材源'), !!sources?.stock?.ok, sources?.stock?.tier === 'keyed' ? 'Pexels/Pixabay + CC 兜底' : 'CC 免 key（配 Pexels 更好）')}

      <h4>{t('写脚本的模型')}</h4>
      <label>{t('供应商')}
        <select value={mdl.provider} onChange={(e) => setMdl({provider: e.target.value, model: (textProv?.providers.find((p) => p.id === e.target.value)?.models[0]) ?? '', apiKey: ''})}>
          <option value="">{t('选一个…')}</option>
          {(textProv?.providers ?? []).map((p) => <option key={p.id} value={p.id}>{p.id}{p.hasKey ? ' ✓' : ''}</option>)}
        </select></label>
      {mdl.provider && <>
        <label>{t('模型')}<input list="kp-tm" value={mdl.model} onChange={(e) => setMdl({...mdl, model: e.target.value})} placeholder={t('模型 id（可手填）')}/></label>
        <datalist id="kp-tm">{(textProv?.providers.find((p) => p.id === mdl.provider)?.models ?? []).map((m) => <option key={m} value={m}/>)}</datalist>
        <label>{t('key')}<input type="password" value={mdl.apiKey} onChange={(e) => setMdl({...mdl, apiKey: e.target.value})}
          placeholder={textProv?.providers.find((p) => p.id === mdl.provider)?.hasKey ? t('已存过，留空则沿用') : t('粘贴后保存')}/></label>
        <button className="primary" onClick={saveTextModel} disabled={!!busy}>{t('验证并保存')}</button>
      </>}

      <h4>{t('看图把关的模型')}</h4>
      <p className="kp-hint">{t('给每条候选素材抽一帧打分，不及格的退回本机出图。没开的话，画面只按检索词字面匹配——真机上"猫为什么钻纸箱"因此配过一口铜钟。只能选能看图的供应商。')}</p>
      <label>{t('供应商')}
        <select value={vis.provider} onChange={(e) => setVis({provider: e.target.value, model: (textProv?.providers.find((p) => p.id === e.target.value)?.models[0]) ?? ''})}>
          <option value="">{t('不开')}</option>
          {(textProv?.providers ?? []).filter((p) => p.vision).map((p) => <option key={p.id} value={p.id}>{p.id}{p.hasKey ? ' ✓' : ''}</option>)}
        </select></label>
      {vis.provider && <label>{t('模型')}<input list="kp-vm" value={vis.model} onChange={(e) => setVis({...vis, model: e.target.value})} placeholder={t('模型 id（可手填）')}/></label>}
      <datalist id="kp-vm">{(textProv?.providers.find((p) => p.id === vis.provider)?.models ?? []).map((m) => <option key={m} value={m}/>)}</datalist>
      <button className="primary" onClick={saveVision} disabled={!!busy}>{vis.provider ? t('验证并开启') : t('关闭看图把关')}</button>
      {testRes && <div className={`kp-testres ${testRes.ok ? 'ok' : 'bad'}`}>{testRes.ok ? '✅ ' : '⛔ '}{testRes.msg}</div>}

      {projects.length > 0 && <>
        <h4>{t('项目')}</h4>
        <ul className="kp-projs">{projects.slice(0, 8).map((p) => <li key={p.id} onClick={() => openProject(p.id).catch((e) => setError(e.message))}>{p.final ? '🎬' : '✍️'} {p.title || p.id}</li>)}</ul>
      </>}
    </aside>;
  };

  const SrcCard = ({k, label, hint}: {k: keyof Omit<Sources, 'tools'>; label: string; hint: string}) => { const s = sources?.[k]; return <div className={`kp-src ${s?.ok ? 'ok' : 'off'}`}><b>{s?.ok ? '✅' : '⛔'} {label}</b><small>{s?.reason ?? '…'}</small><em>{hint}</em></div>; };

  return <div className="kp">
    <header className="kp-top">
      <div className="kp-brand"><span className="kp-mark">开</span><div><strong>OpenShorts · 开片</strong><small>{t('文案进，成片出 · 本地优先 · 花多少钱运行前看见')}</small></div></div>
      <nav>
        {projects.length > 0 && <select onChange={(e) => e.target.value && openProject(e.target.value)} defaultValue=""><option value="">{t('最近项目…')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.final ? '🎬 ' : '✍️ '}{p.title || p.id}</option>)}</select>}
        <button className="kp-lang" onClick={() => { const l = lang === 'zh' ? 'en' : 'zh'; setLang(l); setLangState(l); }}>{lang === 'zh' ? 'EN' : '中'}</button>
        <a href="/editor">{t('图层动画编辑器（v1）')}</a>
      </nav>
    </header>
    <Steps/>
    {error && <div className="kp-error" onClick={() => setError('')}>{error} ×</div>}
    {busy && <div className="kp-busy">{busy}</div>}
    <div className="kp-shell"><div className="kp-main">

    {step === 1 && <section className="kp-card">
      <div className="kp-lines">
        <button className={line === 'koubo' ? 'active' : ''} onClick={() => setLine('koubo')}><b>{t('口播短视频')}</b><small>{t('科普 / 观点 / 带货 · 默认零成本')}</small></button>
        <button className={line === 'drama' ? 'active' : ''} onClick={() => setLine('drama')}><b>{t('AI 短剧')}</b><small>{t('一段故事 → 三镜成片 · 本地草稿 / 云端成片')}</small></button>
      </div>
      {line === 'koubo' ? <>
        <label>{t('话题或文案')}<textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={5} placeholder="例如：猫为什么总爱钻纸箱？也可以直接粘一整段文案，AI 会按它分段。"/></label>
        <div className="kp-inline" style={{marginTop: 6}}><input value={articleUrl} onChange={(e) => setArticleUrl(e.target.value)} placeholder="或粘一个文章链接（公众号 / 博客 / 新闻），抓正文当素材"/><button onClick={grabUrl} disabled={!articleUrl.trim() || !!busy}>{t('抓正文')}</button></div>
        <div className="kp-row">
          <label>{t('目标时长')}<select value={duration} onChange={(e) => setDuration(e.target.value)}>{['45秒', '60秒', '90秒'].map((d) => <option key={d}>{d}</option>)}</select></label>
          <label>{t('语气')}<select value={tone} onChange={(e) => setTone(e.target.value)}>{['科普讲解', '犀利观点', '轻松口播'].map((d) => <option key={d}>{d}</option>)}</select></label>
        </div>
        {aoStatus && !aoStatus.hasTextKey && <div className="kp-warn">还没有写脚本用的文本模型 key。用你自己的 key：在 AO 密钥页配置（<code>{aoStatus.aoHome}</code>）或设置环境变量 <code>DEEPSEEK_API_KEY</code> 等后重启。</div>}
        <div className="kp-actions"><button className="primary" disabled={!topic.trim() || !!busy} onClick={() => setStep(2)}>{t('下一步：选来源')}</button></div>
      </> : <>
        <label>{t('一段故事（一两句话即可，AI 编剧会拆成 3 镜）')}<textarea value={story} onChange={(e) => setStory(e.target.value)} rows={5} placeholder="例如：深夜便利店，值夜班的女孩把最后一份关东煮留给每天来但从不说话的流浪老人；今晚老人没来……"/></label>
        <div className="kp-row">
          <label>{t('题材')}<select value={genre} onChange={(e) => setGenre(e.target.value)}>{['剧情短剧', '产品广告片', '治愈日常', '悬疑惊悚', '搞笑段子'].map((d) => <option key={d}>{d}</option>)}</select></label>
          <label>{t('视觉风格')}<input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="美式复古好莱坞 / 霓虹赛博电影 / 日系清新…"/></label>
          <label>{t('画幅')}<select value={ratio} onChange={(e) => setRatio(e.target.value)}><option value="16:9">{t('横版 16:9')}</option><option value="9:16">{t('竖版 9:16')}</option></select></label>
        </div>
        {aoStatus && !aoStatus.hasTextKey && <div className="kp-warn">写剧本需要文本模型 key（AO 密钥页或环境变量）。</div>}
        <div className="kp-actions"><button className="primary" disabled={!story.trim() || !!busy} onClick={() => setStep(2)}>{t('下一步：选档位')}</button></div>
      </>}
    </section>}

    {step === 2 && line === 'drama' && <section className="kp-card">
      <h3>{t('出片档位')}</h3>
      <div className="kp-lines">
        <button className={tier === 'local' ? 'active' : ''} onClick={() => setTier('local')}><b>{t('本地草稿档 · 不花钱')}</b><small>{dramaOpts?.localReady ? '本机 sd.cpp 跑 MiniMax-H3 Q2：640×384、2 秒/镜、每镜约 3–4 分钟；画质草稿级，用来验证方向' : '未就绪：需要 sd-cli + 约 27 GB 模型（openshorts doctor 看怎么装）'}</small></button>
        <button className={tier === 'cloud' ? 'active' : ''} onClick={() => setTier('cloud')}><b>{t('云端成片档 · 按秒计费')}</b><small>{dramaOpts?.cloudProviders.length ? `已配 key：${dramaOpts.cloudProviders.join(' / ')}` : '还没配视频供应商 key（秘塔 / APIMart / Agnes / 火山）'}</small></button>
      </div>
      {tier !== 'cloud' && localSt && !localSt.ok && <div className="kp-keys" style={{marginTop: 0}}>
        <b>本地草稿档还差：</b>{!localSt.cliFound && <span> sd-cli</span>}{localSt.models.filter((m) => m.usable && !m.present).length > 0 && <span> 模型文件（约 27 GB，可断点续传）</span>}
        <p style={{fontSize: 11, color: '#a99b8e'}}>本机 {localSt.memGB} GB 内存，可用档位：{localSt.models.filter((m) => m.usable).map((m) => m.id).join(' / ') || '无（低于 24 GB）'}。装到 <code>{localSt.modelsDir}</code>。</p>
        <label className="kp-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)}/> 我已阅读并同意 {localSt.license.split('：')[0]}（<a href={localSt.license.split('：')[1]} target="_blank" rel="noreferrer">条款 ↗</a>）与 stable-diffusion.cpp 的 MIT 许可</label>
        <div className="kp-actions" style={{justifyContent: 'flex-start'}}>
          {!localSt.cliFound && <button disabled={!agree || !!dl?.bytes} onClick={() => installLocal('sdcli')}>安装 sd-cli（预编译包）</button>}
          {localSt.models.filter((m) => m.usable && !m.present).slice(0, 1).map((m) => <button key={m.id} disabled={!agree || !!dl?.bytes} onClick={() => installLocal('model', m.id)}>下载模型 {m.id}</button>)}
        </div>
        {dl && <div className="kp-log" style={{maxHeight: 120}}>{dl.log.join('\n')}{dl.bytes ? `\n${dl.file}：${(dl.bytes / 1048576).toFixed(0)} MB${dl.total ? ` / ${(dl.total / 1048576).toFixed(0)} MB（${Math.round(dl.bytes / dl.total * 100)}%）` : ''}` : ''}</div>}
      </div>}
      {tier === 'cloud' && (() => {
        const vps = (providers?.video ?? []).filter((v) => v.shape !== 'local');
        const vp = vps.find((v) => v.id === cloud.video_provider);
        const vm = vp?.models.find((m) => m.id === cloud.video_model);
        const pick = (patch: Partial<typeof cloud>) => setCloud({...cloud, ...patch});
        return <div className="kp-row">
          <label>{t('视频供应商')}<select value={cloud.video_provider} onChange={(e) => { const p = vps.find((v) => v.id === e.target.value); const m = p?.models[0]; pick({video_provider: e.target.value, video_model: m?.id ?? '', video_resolution: m?.resolutions[0] ?? '', video_duration: String(m?.durations[0] ?? '')}); }}>
            {vps.map((v) => <option key={v.id} value={v.id}>{v.id}{v.hasKey ? ' ✓' : '（未配 key）'}</option>)}
          </select></label>
          <label>视频模型{vp && vp.models.length ? <select value={cloud.video_model} onChange={(e) => { const m = vp.models.find((x) => x.id === e.target.value); pick({video_model: e.target.value, video_resolution: m?.resolutions[0] ?? '', video_duration: String(m?.durations[0] ?? '')}); }}>{vp.models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}</select> : <input value={cloud.video_model} onChange={(e) => pick({video_model: e.target.value})} placeholder="该供应商没有已核实的模型清单，手填"/>}</label>
          <label>档位{vm && vm.resolutions.length ? <select value={cloud.video_resolution} onChange={(e) => pick({video_resolution: e.target.value})}>{vm.resolutions.map((r) => <option key={r}>{r}</option>)}</select> : <input value={cloud.video_resolution} onChange={(e) => pick({video_resolution: e.target.value})}/>}</label>
          <label>每镜秒数{vm && vm.durations.length ? <select value={cloud.video_duration} onChange={(e) => pick({video_duration: e.target.value})}>{vm.durations.map((d) => <option key={d} value={String(d)}>{d}</option>)}</select> : <input value={cloud.video_duration} onChange={(e) => pick({video_duration: e.target.value})}/>}</label>
        </div>;
      })()}
      {(() => {
        const ips = providers?.image ?? []; const ip = ips.find((p) => p.id === cloud.image_provider);
        return <div className="kp-row">
          <label>定妆图供应商（出图，按张计费）<select value={cloud.image_provider} onChange={(e) => { const p = ips.find((x) => x.id === e.target.value); setCloud({...cloud, image_provider: e.target.value, image_model: p?.models[0] ?? ''}); }}><option value="">跟随文本供应商</option>{ips.map((p) => <option key={p.id} value={p.id}>{p.id} ✓</option>)}</select></label>
          <label>定妆图模型{ip && ip.models.length ? <select value={cloud.image_model} onChange={(e) => setCloud({...cloud, image_model: e.target.value})}>{ip.models.map((m) => <option key={m}>{m}</option>)}<option value="">（手填其他）</option></select> : <input value={cloud.image_model} onChange={(e) => setCloud({...cloud, image_model: e.target.value})} placeholder="该供应商未核实图片模型，手填"/>}</label>
        </div>;
      })()}
      <div className="kp-warn">下拉只列 AO 供应商表里真机核实过的模型与档位（各家 id 不通用，不猜）；没列出的可手填。本地草稿档的定妆图仍走云端出图。</div>
      {preflight.length > 0 && <div className="kp-cost"><b>本次花费预览</b>{preflight.map((l, i) => <small key={i} style={{display: 'block'}}>{l}</small>)}</div>}
      <div className="kp-actions"><button onClick={() => setStep(1)}>{t('上一步')}</button><button onClick={dramaPreflight} disabled={!!busy || !cloud.image_model}>{t('看花费')}</button><button className="primary" disabled={!!busy || !cloud.image_model || preflight.length === 0 || (tier === 'local' && !localSt?.ok)} onClick={dramaRun}>{t('确认花费，出片 →')}</button></div>
    </section>}

    {step === 2 && line === 'koubo' && <section className="kp-card">
      {ff && ff.found && !ff.subtitles && <div className="kp-warn" style={{borderColor: '#e0524b'}}>
        <b>⛔ 这台机器的 ffmpeg 烧不了字幕</b>（缺 libass）。出来的片传到抖音/视频号后<b>看不到字</b>；没找到素材而退成纯色底的镜头会是一块空屏。
        Homebrew 现在的 ffmpeg 已经不带 libass，重装它没用。
        <div style={{marginTop: 8}}><button className="primary" onClick={installFfmpeg} disabled={!!dl}>装一份带 libass 的（约 40 MB，只放进 ~/.openshorts/bin，不动系统 ffmpeg）</button></div>
        {dl && <pre className="kp-log" style={{maxHeight: 120, marginTop: 8}}>{[...dl.log, dl.total ? `${dl.file} ${(Number(dl.bytes ?? 0) / 1048576).toFixed(0)}/${(dl.total / 1048576).toFixed(0)} MB` : ''].filter(Boolean).join('\n')}</pre>}
      </div>}
      {ff && !ff.found && <div className="kp-warn" style={{borderColor: '#e0524b'}}><b>⛔ 没找到 ffmpeg</b>，出片一定失败。<button className="primary" onClick={installFfmpeg} disabled={!!dl} style={{marginLeft: 8}}>装一份</button></div>}
      <h3>{t('画面来源')}</h3>
      <div className="kp-srcs">
        <SrcCard k="stock" label="素材库" hint="Wikimedia CC 图片/视频（免 key）+ Pexels/Pixabay + 本地素材夹 · 不花钱"/>
        <SrcCard k="image" label="AI 配图" hint="云端文生图 · 按张计费（短剧线在用；口播线用本机出图，不花钱）"/>
        <SrcCard k="local" label="本地生成" hint={gen?.ok ? `本机文生图就绪 · 素材库没命中时顶上 · 不花钱` : 'sd.cpp 本机文生图 · 不花钱（未装模型时素材库没命中就退纯色底）'}/>
        <SrcCard k="cloud" label="云端出片" hint="秘塔 / 火山 / Agnes … · 按秒计费（M2）"/>
      </div>
      <div className="kp-row">
        <label>{t('本次画面')}<select value={source} onChange={(e) => setSource(e.target.value as any)}><option value="stock">素材库（找不到时用纯色底）</option><option value="solid">只用纯色底 + 大字幕（最快，测试用）</option></select></label>
        <label>{t('本地素材夹（可选）')}<input value={localDir} onChange={(e) => setLocalDir(e.target.value)} placeholder="/path/to/我的素材（文件名或同名 .txt 里的关键词会被匹配）"/></label>
      </div>
      {gen && gen.cliFound && !gen.ok && <details className="kp-keys">
        <summary>找不到素材的镜头，让本机画一张（可选，不花钱、不联网）</summary>
        <p style={{fontSize: 13, margin: '6px 0'}}>
          口播里"狭小空间让它感到安全"这类抽象句，素材库本来就没有对应画面，现在会退成纯色底。
          装一个本地文生图模型后，这些镜头会由本机现画一张（每张几十秒）。
          <br/><small>{gen.license}</small>
        </p>
        <div className="kp-inline">{gen.models.filter((m) => m.usable).map((m) => <button key={m.id} disabled={!!dl} onClick={() => installLocalImage(m.id)}>{m.label} · {m.sizeGB} GB</button>)}</div>
        {gen.models.every((m) => !m.usable) && <small>本机内存 {gen.memGB} GB，跑不动任何档位。</small>}
        {dl && <pre className="kp-log" style={{maxHeight: 120, marginTop: 8}}>{[...dl.log, dl.total ? `${dl.file} ${(Number(dl.bytes ?? 0) / 1073741824).toFixed(2)}/${(dl.total / 1073741824).toFixed(2)} GB` : ''].filter(Boolean).join('\n')}</pre>}
      </details>}
      {cfg && !(cfg.stock.hasPexels || cfg.stock.hasPixabay) && <details className="kp-keys" open><summary>素材库 key（免费，注册即得；只存本机 <code>~/.openshorts/config.json</code>）</summary>
        <div className="kp-row">
          <label>Pexels key <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer">去申请 ↗</a><input value={keyDraft.pexelsKey} onChange={(e) => setKeyDraft({...keyDraft, pexelsKey: e.target.value})} placeholder="粘贴后保存"/></label>
          <label>Pixabay key <a href="https://pixabay.com/api/docs/" target="_blank" rel="noreferrer">去申请 ↗</a><input value={keyDraft.pixabayKey} onChange={(e) => setKeyDraft({...keyDraft, pixabayKey: e.target.value})}/></label>
        </div><button onClick={saveKeys} disabled={!keyDraft.pexelsKey && !keyDraft.pixabayKey}>{t('保存 key')}</button>
      </details>}
      <h3>{t('配音与字幕')}</h3>
      <div className="kp-row">
        <label>{t('音色')}<div className="kp-inline"><select value={voice} onChange={(e) => setVoice(e.target.value)}>{voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select><button onClick={preview} disabled={!!busy}>{t('▶ 试听')}</button><audio ref={audioRef}/></div></label>
        <label>{t('字幕样式')}<select value={captions} onChange={(e) => setCaptions(e.target.value)}><option value="douyin">抖音黄字描边</option><option value="clean">简约白</option><option value="boxed">黑底白字</option></select></label>
      </div>
      <div className="kp-cost"><b>{t('本次花费：0 元')}</b><small>素材库 / 本地素材 / 纯色底不花钱 · Edge TTS 免费 · 合成用本机 ffmpeg{sources && !sources.tools.ffmpeg ? ' ⛔ 未检测到 ffmpeg，出片会失败' : ''}</small></div>
      <div className="kp-actions"><button onClick={() => setStep(1)}>{t('上一步')}</button><button className="primary" disabled={!!busy} onClick={createProject}>{t('生成脚本 →')}</button></div>
    </section>}

    {step === 3 && line === 'drama' && !project && <section className="kp-card">
      <h3>{t('正在出片')}<small> · {busy || '…'}</small></h3>
      <pre className="kp-log" style={{maxHeight: 420}}>{log.join('\n') || '等待引擎输出…'}</pre>
      <div className="kp-warn">云端任务一旦创建就会计费，中途关页面不会取消服务商那边的任务；本地出片关页面即停。</div>
    </section>}

    {step === 3 && project && <section className="kp-card">
      <h3>{project.title || project.topic}<small> · {project.shots.length} 个镜头 · 文案与检索词可改，画面在出片时按检索词找</small></h3>
      <ol className="kp-shots">{project.shots.map((s, i) => <li key={s.id}>
        <div className="kp-shot-head"><b>{i + 1}. {s.id === 'hook' ? '钩子' : s.id === 'outro' ? '收尾' : `第 ${i} 段`}</b>{s.durationSec ? <em>{s.durationSec.toFixed(1)}s</em> : null}{s.visual?.source ? <em>{s.visual.source}{s.visual.author ? ` · ${s.visual.author}` : ''}</em> : null}</div>
        <textarea value={s.text} rows={2} onChange={(e) => setProject({...project, shots: project.shots.map((x) => x.id === s.id ? {...x, text: e.target.value} : x)})}/>
        <div className="kp-row"><label>画面意图<input value={s.visualIntent} onChange={(e) => setProject({...project, shots: project.shots.map((x) => x.id === s.id ? {...x, visualIntent: e.target.value} : x)})}/></label><label>检索词（英文）<input value={s.query} onChange={(e) => setProject({...project, shots: project.shots.map((x) => x.id === s.id ? {...x, query: e.target.value} : x)})}/></label></div>
        {project.final && <div className="kp-shot-actions"><button disabled={!!busy} onClick={() => runProject([s.id])} title="丢掉这一镜已选的素材重新找；文案没改的话配音直接复用，不重配音">{t('只重出这一镜')}</button></div>}
      </li>)}</ol>
      {log.length > 0 && <pre className="kp-log">{log.join('\n')}</pre>}
      <div className="kp-actions">
        <button onClick={() => setStep(2)} disabled={!!busy}>{t('上一步')}</button>
        <button onClick={saveShots} disabled={!!busy}>{t('保存修改')}</button>
        {busy ? <button onClick={cancelRun}>{t('取消')}</button> : null}
        <button className="primary" disabled={!!busy} onClick={() => runProject()}>{busy ? busy : '出片 →'}</button>
      </div>
    </section>}

    {step === 4 && project?.line === 'drama' && <section className="kp-card kp-final">
      <h3>{project.title}<small> · {project.tier === 'local' ? '本地草稿档' : '云端成片档'} · {project.inputs?.video_provider} / {project.inputs?.video_model}</small></h3>
      {project.final?.file && <video controls className={`kp-drama-film ${project.inputs?.video_ratio === '9:16' ? 'portrait' : ''}`} src={fileUrl(project, project.final.file)} poster={project.shots[0]?.visual?.file ? fileUrl(project, project.shots[0].visual.file) : undefined}/>}
      <div className="kp-drama-shots">{(project.shots as unknown as DramaShot[]).map((s) => <div key={s.id} className="kp-drama-shot">
        {s.kind === 'image' ? <img src={fileUrl(project, s.visual.file)} alt={s.stepName}/> : <video controls muted src={fileUrl(project, s.visual.file)}/>}
        <b>{s.stepName}</b>
        {s.verification ? <em className={s.verification.pass ? 'ok' : 'warn'}>{s.verification.pass ? '✅ 验收通过' : `⚠️ 验收 ${s.verification.failed.length} 条未过`}{s.verification.reworked ? '（已重出 1 次）' : ''}</em> : <em>{t('未验收')}</em>}
        {s.verification && !s.verification.pass && <ul className="kp-prov">{s.verification.failed.map((f, i) => <li key={i}>{f}</li>)}</ul>}
        <small>{s.visual.source === 'local' ? '本地 · 不花钱' : `${s.visual.provider ?? ''} ${s.visual.model ?? ''}`}{s.durationSec ? ` · ${s.durationSec}s` : ''}</small>
        <div className="kp-shot-actions">
          {s.verification && !s.verification.pass && <button disabled={!!busy} onClick={() => dramaRedo(s.id, s.verification!.failed.join('\n'), 'same')}>{t('按验收意见重出')}</button>}
          <button disabled={!!busy} onClick={() => setRedo(redo?.shot === s.id ? null : {shot: s.id, feedback: '', tier: 'same'})}>{t('提意见 / 换来源')}</button>
        </div>
        {redo?.shot === s.id && <div className="kp-redo">
          <textarea rows={2} value={redo.feedback} onChange={(e) => setRedo({...redo, feedback: e.target.value})} placeholder="想怎么改（可空：只换来源重出）"/>
          {s.kind === 'video' && <select value={redo.tier} onChange={(e) => setRedo({...redo, tier: e.target.value as any})}><option value="same">{t('同一来源')}</option><option value="local" disabled={!dramaOpts?.localReady}>本地草稿档（不花钱）</option><option value="cloud">云端成片档（按秒计费，用第 2 步填的供应商）</option></select>}
          <button className="primary" disabled={!!busy} onClick={() => dramaRedo(s.id, redo.feedback, redo.tier)}>{t('重出这一镜')}</button>
          <small>上游剧本 / 定妆图 / 其他镜头原样复用；合成会自动重跑。</small>
        </div>}
      </div>)}</div>
      {busy && log.length > 0 && <pre className="kp-log">{log.join('\n')}</pre>}
      <div className="kp-actions"><a className="kp-btn" href={project.final?.file ? fileUrl(project, project.final.file) : '#'} download>{t('下载成片')}</a><button onClick={() => { setProject(null); setStep(2); }}>{t('换档位再出一版')}</button><button className="primary" onClick={() => { setProject(null); setStory(''); setStep(1); }}>{t('再做一条')}</button></div>
      <div className="kp-warn">草稿满意后切「云端成片档」用同一段故事重出；单镜重出用上面每镜的按钮（只重跑该镜及下游，上游剧本与定妆图不再花钱）。</div>
    </section>}

    {step === 4 && project?.line !== 'drama' && project?.final && <section className="kp-card kp-final">
      <div className="kp-final-grid">
        <video controls src={fileUrl(project, project.final.file)} poster={project.final.cover ? fileUrl(project, project.final.cover) : undefined}/>
        <div>
          <h3>{project.title}</h3>
          <p><b>{project.final.durationSec.toFixed(1)} 秒</b> · 1080×1920 · <a href={fileUrl(project, project.final.file)} download>{t('下载 mp4')}</a> · <a href={fileUrl(project, project.final.srt)} download>SRT</a>{project.final.cover && <> · <a href={fileUrl(project, project.final.cover)} download>{t('封面')}</a></>}</p>
          <h4>{t('标题（点复制）')}</h4><ul className="kp-copy">{project.publish.titles.map((t) => <li key={t} onClick={() => copy(t)}>{t}</li>)}</ul>
          <h4>{t('话题')}</h4><p className="kp-tags" onClick={() => copy(project.publish.tags.map((t) => `#${t}`).join(' '))}>{project.publish.tags.map((t) => `#${t}`).join(' ')}</p>
          <h4>{t('发布说明')}</h4><p>{project.publish.note}<br/><small>AI 标识：{project.publish.aiLabelText}</small></p>
          {project.provenance.length > 0 && <><h4>{t('素材署名')}</h4><ul className="kp-prov">{project.provenance.map((p) => <li key={p.shot}>{p.shot}: {p.source}{p.author ? ` · ${p.author}` : ''}{p.license ? `（${p.license}）` : ''}</li>)}</ul></>}
          {project.final.quality && <><h4>质检 {project.final.quality.pass ? '✅ 通过' : '⛔ 有问题'}{project.final.quality.warnings ? ` · ${project.final.quality.warnings} 条提醒` : ''}</h4><ul className="kp-prov">{project.final.quality.items.map((q) => <li key={q.id}>{q.status === 'pass' ? '✅' : q.status === 'warn' ? '⚠️' : '⛔'} {q.msg}</li>)}</ul></>}
          {project.final.notes.length > 0 && <div className="kp-warn"><b>{t('提示')}</b><ul>{project.final.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}
          <h4>{t('发布包')}</h4>
          <div className="kp-inline"><select value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="douyin">抖音</option><option value="shipinhao">视频号</option><option value="bilibili">B 站</option><option value="shorts">YouTube Shorts</option></select><button onClick={makePack} disabled={!!busy}>{t('打发布包（mp4 + 封面 + SRT + 文案）')}</button></div>
          {pack && <p style={{fontSize: 12}}>已生成：<code>{pack.dir}</code>{pack.zipName ? ` · ${pack.zipName}` : ''}<br/><small>不自动发布——拖进平台后台即可；AI 标识与素材署名都在文案里。</small></p>}
          <h4>{t('批量出版本（同脚本换音色 / 字幕样式）')}</h4>
          <div className="kp-row">
            <label>{t('音色（多选）')}<select multiple size={4} value={batchVoices} onChange={(e) => setBatchVoices([...e.target.selectedOptions].map((o) => o.value))}>{voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
            <label>{t('字幕样式（多选）')}<select multiple size={3} value={batchCaptions} onChange={(e) => setBatchCaptions([...e.target.selectedOptions].map((o) => o.value))}><option value="douyin">抖音黄字描边</option><option value="clean">简约白</option><option value="boxed">黑底白字</option></select></label>
          </div>
          <div className="kp-actions" style={{justifyContent: 'flex-start'}}><button onClick={runBatch} disabled={!!busy || (batchVoices.length || 1) * (batchCaptions.length || 1) > 12}>出 {(batchVoices.length || 1) * (batchCaptions.length || 1)} 版</button></div>
          {batchResults.length > 0 && <ul className="kp-copy">{batchResults.map((r) => <li key={r.id} style={{cursor: 'default'}}>{r.ok ? '✅' : '⛔'} {r.id}{r.ok ? <> · {r.durationSec?.toFixed(1)}s · <a href={`/api/kaipian/projects/${encodeURIComponent(project.id)}/variant/${encodeURIComponent(r.id)}`} download>下载</a></> : ` ${r.error}`}</li>)}</ul>}
          {busy && log.length > 0 && <pre className="kp-log">{log.slice(-12).join('\n')}</pre>}
          <div className="kp-actions"><button onClick={() => setStep(3)}>{t('改文案 / 重出单镜')}</button><button className="primary" onClick={() => { setProject(null); setTopic(''); setStep(1); }}>{t('再做一条')}</button></div>
        </div>
      </div>
    </section>}
    </div><Aside/></div>
    <footer className="kp-foot">产物在 <code>{cfg?.outputDir ?? '~/OpenShorts'}</code> · key 只存本机 · 成片默认带 AI 生成标识 · <a href="https://github.com/jnMetaCode/openshorts" target="_blank" rel="noreferrer">GitHub</a></footer>
  </div>;
};
