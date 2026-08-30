import React, {useEffect, useRef, useState} from 'react';
import './kaipian.css';

type Src = {ok: boolean; reason: string; tier?: string};
type Sources = {stock: Src; image: Src; local: Src; cloud: Src; layered: Src; tools: {ffmpeg: boolean; whisper: boolean; magick: boolean}};
type Voice = {id: string; label: string};
type Shot = {id: string; text: string; visualIntent: string; query: string; emphasis: string[]; durationSec: number | null; status: string; visual: {source: string | null; file: string | null; author?: string | null; license?: string}};
type DramaShot = {id: string; kind: 'video' | 'image'; order: number; durationSec: number | null; visual: {source: string; provider: string | null; model: string | null; file: string}; verification: {pass: boolean; failed: string[]; reworked: boolean} | null; status: string; stepName: string};
type Project = {id: string; title: string; topic: string; line?: string; tier?: string; inputs?: Record<string, string>; shots: Shot[]; voice: {voice: string; rate: number}; captions: {preset: string}; defaults: {visualSource: string; localDirs: string[]}; publish: {titles: string[]; tags: string[]; note: string; aiLabelText: string}; final?: {file: string; srt: string; cover: string | null; publish: string; durationSec: number; notes: string[]; quality?: {pass: boolean; warnings: number; items: Array<{id: string; status: string; msg: string}>}} | null; provenance: Array<{shot: string; source: string; author?: string | null; license?: string; page?: string | null}>};

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => { const r = await fetch(url, {headers: {'Content-Type': 'application/json'}, ...init}); const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const fileUrl = (p: Project, abs: string) => `/api/kaipian/projects/${encodeURIComponent(p.id)}/file/${encodeURIComponent(abs.split('/').pop() || '')}`;

export const Kaipian = () => {
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

  const refresh = async () => {
    const [s, v, a, c, ps] = await Promise.all([api<Sources>('/api/kaipian/sources'), api<Voice[]>('/api/kaipian/voices'), api<any>('/api/kaipian/ao-status'), api<any>('/api/kaipian/config'), api<any>('/api/kaipian/projects')]);
    setSources(s); setVoices(v); setAoStatus(a); setCfg(c); setProjects(ps); if (c?.tts?.voice) setVoice(c.tts.voice);
    api<any>('/api/kaipian/drama/options').then(setDramaOpts).catch(() => {});
    api<any>('/api/kaipian/drama/providers').then(setProviders).catch(() => {});
    api<any>('/api/kaipian/local/status').then(setLocalSt).catch(() => {});
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
  const runProject = async () => {
    if (!project) return; await saveShots(); setLog([]); setBusy('出片中…'); setError('');
    const es = new EventSource(`/api/kaipian/projects/${encodeURIComponent(project.id)}/run`);
    es.addEventListener('log', (e: any) => setLog((l) => [...l, JSON.parse(e.data).m]));
    es.addEventListener('done', async () => { es.close(); const p = await api<Project>(`/api/kaipian/projects/${encodeURIComponent(project.id)}`); setProject(p); setBusy(''); setStep(4); await refresh(); });
    es.addEventListener('error', (e: any) => { try { setError(JSON.parse(e.data).m); } catch { setError('出片中断'); } es.close(); setBusy(''); });
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

  const Steps = () => <ol className="kp-steps">{['输入', '来源与花费', '预览与调整', '出片与发布'].map((n, i) => <li key={n} className={step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}><span>{i + 1}</span>{n}</li>)}</ol>;
  const SrcCard = ({k, label, hint}: {k: keyof Omit<Sources, 'tools'>; label: string; hint: string}) => { const s = sources?.[k]; return <div className={`kp-src ${s?.ok ? 'ok' : 'off'}`}><b>{s?.ok ? '✅' : '⛔'} {label}</b><small>{s?.reason ?? '…'}</small><em>{hint}</em></div>; };

  return <div className="kp">
    <header className="kp-top">
      <div className="kp-brand"><span className="kp-mark">开</span><div><strong>OpenShorts · 开片</strong><small>文案进，成片出 · 本地优先 · 花多少钱运行前看见</small></div></div>
      <nav>
        {projects.length > 0 && <select onChange={(e) => e.target.value && openProject(e.target.value)} defaultValue=""><option value="">最近项目…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.final ? '🎬 ' : '✍️ '}{p.title || p.id}</option>)}</select>}
        <a href="/editor">图层动画编辑器（v1）</a>
      </nav>
    </header>
    <Steps/>
    {error && <div className="kp-error" onClick={() => setError('')}>{error} ×</div>}
    {busy && <div className="kp-busy">{busy}</div>}

    {step === 1 && <section className="kp-card">
      <div className="kp-lines">
        <button className={line === 'koubo' ? 'active' : ''} onClick={() => setLine('koubo')}><b>口播短视频</b><small>科普 / 观点 / 带货 · 默认零成本</small></button>
        <button className={line === 'drama' ? 'active' : ''} onClick={() => setLine('drama')}><b>AI 短剧</b><small>一段故事 → 三镜成片 · 本地草稿 / 云端成片</small></button>
      </div>
      {line === 'koubo' ? <>
        <label>话题或文案<textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={5} placeholder="例如：猫为什么总爱钻纸箱？也可以直接粘一整段文案，AI 会按它分段。"/></label>
        <div className="kp-inline" style={{marginTop: 6}}><input value={articleUrl} onChange={(e) => setArticleUrl(e.target.value)} placeholder="或粘一个文章链接（公众号 / 博客 / 新闻），抓正文当素材"/><button onClick={grabUrl} disabled={!articleUrl.trim() || !!busy}>抓正文</button></div>
        <div className="kp-row">
          <label>目标时长<select value={duration} onChange={(e) => setDuration(e.target.value)}>{['45秒', '60秒', '90秒'].map((d) => <option key={d}>{d}</option>)}</select></label>
          <label>语气<select value={tone} onChange={(e) => setTone(e.target.value)}>{['科普讲解', '犀利观点', '轻松口播'].map((d) => <option key={d}>{d}</option>)}</select></label>
        </div>
        {aoStatus && !aoStatus.hasTextKey && <div className="kp-warn">还没有写脚本用的文本模型 key。用你自己的 key：在 AO 密钥页配置（<code>{aoStatus.aoHome}</code>）或设置环境变量 <code>DEEPSEEK_API_KEY</code> 等后重启。</div>}
        <div className="kp-actions"><button className="primary" disabled={!topic.trim() || !!busy} onClick={() => setStep(2)}>下一步：选来源</button></div>
      </> : <>
        <label>一段故事（一两句话即可，AI 编剧会拆成 3 镜）<textarea value={story} onChange={(e) => setStory(e.target.value)} rows={5} placeholder="例如：深夜便利店，值夜班的女孩把最后一份关东煮留给每天来但从不说话的流浪老人；今晚老人没来……"/></label>
        <div className="kp-row">
          <label>题材<select value={genre} onChange={(e) => setGenre(e.target.value)}>{['剧情短剧', '产品广告片', '治愈日常', '悬疑惊悚', '搞笑段子'].map((d) => <option key={d}>{d}</option>)}</select></label>
          <label>视觉风格<input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="美式复古好莱坞 / 霓虹赛博电影 / 日系清新…"/></label>
          <label>画幅<select value={ratio} onChange={(e) => setRatio(e.target.value)}><option value="16:9">横版 16:9</option><option value="9:16">竖版 9:16</option></select></label>
        </div>
        {aoStatus && !aoStatus.hasTextKey && <div className="kp-warn">写剧本需要文本模型 key（AO 密钥页或环境变量）。</div>}
        <div className="kp-actions"><button className="primary" disabled={!story.trim() || !!busy} onClick={() => setStep(2)}>下一步：选档位</button></div>
      </>}
    </section>}

    {step === 2 && line === 'drama' && <section className="kp-card">
      <h3>出片档位</h3>
      <div className="kp-lines">
        <button className={tier === 'local' ? 'active' : ''} onClick={() => setTier('local')}><b>本地草稿档 · 不花钱</b><small>{dramaOpts?.localReady ? '本机 sd.cpp 跑 MiniMax-H3 Q2：640×384、2 秒/镜、每镜约 3–4 分钟；画质草稿级，用来验证方向' : '未就绪：需要 sd-cli + 约 27 GB 模型（openshorts doctor 看怎么装）'}</small></button>
        <button className={tier === 'cloud' ? 'active' : ''} onClick={() => setTier('cloud')}><b>云端成片档 · 按秒计费</b><small>{dramaOpts?.cloudProviders.length ? `已配 key：${dramaOpts.cloudProviders.join(' / ')}` : '还没配视频供应商 key（秘塔 / APIMart / Agnes / 火山）'}</small></button>
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
          <label>视频供应商<select value={cloud.video_provider} onChange={(e) => { const p = vps.find((v) => v.id === e.target.value); const m = p?.models[0]; pick({video_provider: e.target.value, video_model: m?.id ?? '', video_resolution: m?.resolutions[0] ?? '', video_duration: String(m?.durations[0] ?? '')}); }}>
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
      <div className="kp-actions"><button onClick={() => setStep(1)}>上一步</button><button onClick={dramaPreflight} disabled={!!busy || !cloud.image_model}>看花费</button><button className="primary" disabled={!!busy || !cloud.image_model || preflight.length === 0 || (tier === 'local' && !localSt?.ok)} onClick={dramaRun}>确认花费，出片 →</button></div>
    </section>}

    {step === 2 && line === 'koubo' && <section className="kp-card">
      <h3>画面来源</h3>
      <div className="kp-srcs">
        <SrcCard k="stock" label="素材库" hint="Pexels / Pixabay 免费片段 + 本地素材夹 · 不花钱"/>
        <SrcCard k="image" label="AI 配图" hint="文生图 + 推拉动效 · 按张计费（M2 接入）"/>
        <SrcCard k="local" label="本地生成" hint="sd.cpp 本地出片 · 不花钱、草稿级（M2）"/>
        <SrcCard k="cloud" label="云端出片" hint="秘塔 / 火山 / Agnes … · 按秒计费（M2）"/>
      </div>
      <div className="kp-row">
        <label>本次画面<select value={source} onChange={(e) => setSource(e.target.value as any)}><option value="stock">素材库（找不到时用纯色底）</option><option value="solid">只用纯色底 + 大字幕（最快，测试用）</option></select></label>
        <label>本地素材夹（可选）<input value={localDir} onChange={(e) => setLocalDir(e.target.value)} placeholder="/path/to/我的素材（文件名或同名 .txt 里的关键词会被匹配）"/></label>
      </div>
      {cfg && !(cfg.stock.hasPexels || cfg.stock.hasPixabay) && <details className="kp-keys" open><summary>素材库 key（免费，注册即得；只存本机 <code>~/.openshorts/config.json</code>）</summary>
        <div className="kp-row">
          <label>Pexels key <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer">去申请 ↗</a><input value={keyDraft.pexelsKey} onChange={(e) => setKeyDraft({...keyDraft, pexelsKey: e.target.value})} placeholder="粘贴后保存"/></label>
          <label>Pixabay key <a href="https://pixabay.com/api/docs/" target="_blank" rel="noreferrer">去申请 ↗</a><input value={keyDraft.pixabayKey} onChange={(e) => setKeyDraft({...keyDraft, pixabayKey: e.target.value})}/></label>
        </div><button onClick={saveKeys} disabled={!keyDraft.pexelsKey && !keyDraft.pixabayKey}>保存 key</button>
      </details>}
      <h3>配音与字幕</h3>
      <div className="kp-row">
        <label>音色<div className="kp-inline"><select value={voice} onChange={(e) => setVoice(e.target.value)}>{voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select><button onClick={preview} disabled={!!busy}>▶ 试听</button><audio ref={audioRef}/></div></label>
        <label>字幕样式<select value={captions} onChange={(e) => setCaptions(e.target.value)}><option value="douyin">抖音黄字描边</option><option value="clean">简约白</option><option value="boxed">黑底白字</option></select></label>
      </div>
      <div className="kp-cost"><b>本次花费：0 元</b><small>素材库 / 本地素材 / 纯色底不花钱 · Edge TTS 免费 · 合成用本机 ffmpeg{sources && !sources.tools.ffmpeg ? ' ⛔ 未检测到 ffmpeg，出片会失败' : ''}</small></div>
      <div className="kp-actions"><button onClick={() => setStep(1)}>上一步</button><button className="primary" disabled={!!busy} onClick={createProject}>生成脚本 →</button></div>
    </section>}

    {step === 3 && line === 'drama' && !project && <section className="kp-card">
      <h3>正在出片<small> · {busy || '…'}</small></h3>
      <pre className="kp-log" style={{maxHeight: 420}}>{log.join('\n') || '等待引擎输出…'}</pre>
      <div className="kp-warn">云端任务一旦创建就会计费，中途关页面不会取消服务商那边的任务；本地出片关页面即停。</div>
    </section>}

    {step === 3 && project && <section className="kp-card">
      <h3>{project.title || project.topic}<small> · {project.shots.length} 个镜头 · 文案与检索词可改，画面在出片时按检索词找</small></h3>
      <ol className="kp-shots">{project.shots.map((s, i) => <li key={s.id}>
        <div className="kp-shot-head"><b>{i + 1}. {s.id === 'hook' ? '钩子' : s.id === 'outro' ? '收尾' : `第 ${i} 段`}</b>{s.durationSec ? <em>{s.durationSec.toFixed(1)}s</em> : null}{s.visual?.source ? <em>{s.visual.source}{s.visual.author ? ` · ${s.visual.author}` : ''}</em> : null}</div>
        <textarea value={s.text} rows={2} onChange={(e) => setProject({...project, shots: project.shots.map((x) => x.id === s.id ? {...x, text: e.target.value} : x)})}/>
        <div className="kp-row"><label>画面意图<input value={s.visualIntent} onChange={(e) => setProject({...project, shots: project.shots.map((x) => x.id === s.id ? {...x, visualIntent: e.target.value} : x)})}/></label><label>检索词（英文）<input value={s.query} onChange={(e) => setProject({...project, shots: project.shots.map((x) => x.id === s.id ? {...x, query: e.target.value} : x)})}/></label></div>
      </li>)}</ol>
      {log.length > 0 && <pre className="kp-log">{log.join('\n')}</pre>}
      <div className="kp-actions"><button onClick={() => setStep(2)} disabled={!!busy}>上一步</button><button onClick={saveShots} disabled={!!busy}>保存修改</button><button className="primary" disabled={!!busy} onClick={runProject}>{busy ? busy : '出片 →'}</button></div>
    </section>}

    {step === 4 && project?.line === 'drama' && <section className="kp-card kp-final">
      <h3>{project.title}<small> · {project.tier === 'local' ? '本地草稿档' : '云端成片档'} · {project.inputs?.video_provider} / {project.inputs?.video_model}</small></h3>
      {project.final?.file && <video controls className={`kp-drama-film ${project.inputs?.video_ratio === '9:16' ? 'portrait' : ''}`} src={fileUrl(project, project.final.file)} poster={project.shots[0]?.visual?.file ? fileUrl(project, project.shots[0].visual.file) : undefined}/>}
      <div className="kp-drama-shots">{(project.shots as unknown as DramaShot[]).map((s) => <div key={s.id} className="kp-drama-shot">
        {s.kind === 'image' ? <img src={fileUrl(project, s.visual.file)} alt={s.stepName}/> : <video controls muted src={fileUrl(project, s.visual.file)}/>}
        <b>{s.stepName}</b>
        {s.verification ? <em className={s.verification.pass ? 'ok' : 'warn'}>{s.verification.pass ? '✅ 验收通过' : `⚠️ 验收 ${s.verification.failed.length} 条未过`}{s.verification.reworked ? '（已重出 1 次）' : ''}</em> : <em>未验收</em>}
        {s.verification && !s.verification.pass && <ul className="kp-prov">{s.verification.failed.map((f, i) => <li key={i}>{f}</li>)}</ul>}
        <small>{s.visual.source === 'local' ? '本地 · 不花钱' : `${s.visual.provider ?? ''} ${s.visual.model ?? ''}`}{s.durationSec ? ` · ${s.durationSec}s` : ''}</small>
        <div className="kp-shot-actions">
          {s.verification && !s.verification.pass && <button disabled={!!busy} onClick={() => dramaRedo(s.id, s.verification!.failed.join('\n'), 'same')}>按验收意见重出</button>}
          <button disabled={!!busy} onClick={() => setRedo(redo?.shot === s.id ? null : {shot: s.id, feedback: '', tier: 'same'})}>提意见 / 换来源</button>
        </div>
        {redo?.shot === s.id && <div className="kp-redo">
          <textarea rows={2} value={redo.feedback} onChange={(e) => setRedo({...redo, feedback: e.target.value})} placeholder="想怎么改（可空：只换来源重出）"/>
          {s.kind === 'video' && <select value={redo.tier} onChange={(e) => setRedo({...redo, tier: e.target.value as any})}><option value="same">同一来源</option><option value="local" disabled={!dramaOpts?.localReady}>本地草稿档（不花钱）</option><option value="cloud">云端成片档（按秒计费，用第 2 步填的供应商）</option></select>}
          <button className="primary" disabled={!!busy} onClick={() => dramaRedo(s.id, redo.feedback, redo.tier)}>重出这一镜</button>
          <small>上游剧本 / 定妆图 / 其他镜头原样复用；合成会自动重跑。</small>
        </div>}
      </div>)}</div>
      {busy && log.length > 0 && <pre className="kp-log">{log.join('\n')}</pre>}
      <div className="kp-actions"><a className="kp-btn" href={project.final?.file ? fileUrl(project, project.final.file) : '#'} download>下载成片</a><button onClick={() => { setProject(null); setStep(2); }}>换档位再出一版</button><button className="primary" onClick={() => { setProject(null); setStory(''); setStep(1); }}>再做一条</button></div>
      <div className="kp-warn">草稿满意后切「云端成片档」用同一段故事重出；想让某一镜按验收意见重出，用命令行 <code>ao run … --resume last --from shot2 --feedback "…"</code>（界面版 M2 后半段）。</div>
    </section>}

    {step === 4 && project?.line !== 'drama' && project?.final && <section className="kp-card kp-final">
      <div className="kp-final-grid">
        <video controls src={fileUrl(project, project.final.file)} poster={project.final.cover ? fileUrl(project, project.final.cover) : undefined}/>
        <div>
          <h3>{project.title}</h3>
          <p><b>{project.final.durationSec.toFixed(1)} 秒</b> · 1080×1920 · <a href={fileUrl(project, project.final.file)} download>下载 mp4</a> · <a href={fileUrl(project, project.final.srt)} download>SRT</a>{project.final.cover && <> · <a href={fileUrl(project, project.final.cover)} download>封面</a></>}</p>
          <h4>标题（点复制）</h4><ul className="kp-copy">{project.publish.titles.map((t) => <li key={t} onClick={() => copy(t)}>{t}</li>)}</ul>
          <h4>话题</h4><p className="kp-tags" onClick={() => copy(project.publish.tags.map((t) => `#${t}`).join(' '))}>{project.publish.tags.map((t) => `#${t}`).join(' ')}</p>
          <h4>发布说明</h4><p>{project.publish.note}<br/><small>AI 标识：{project.publish.aiLabelText}</small></p>
          {project.provenance.length > 0 && <><h4>素材署名</h4><ul className="kp-prov">{project.provenance.map((p) => <li key={p.shot}>{p.shot}: {p.source}{p.author ? ` · ${p.author}` : ''}{p.license ? `（${p.license}）` : ''}</li>)}</ul></>}
          {project.final.quality && <><h4>质检 {project.final.quality.pass ? '✅ 通过' : '⛔ 有问题'}{project.final.quality.warnings ? ` · ${project.final.quality.warnings} 条提醒` : ''}</h4><ul className="kp-prov">{project.final.quality.items.map((q) => <li key={q.id}>{q.status === 'pass' ? '✅' : q.status === 'warn' ? '⚠️' : '⛔'} {q.msg}</li>)}</ul></>}
          {project.final.notes.length > 0 && <div className="kp-warn"><b>提示</b><ul>{project.final.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}
          <h4>发布包</h4>
          <div className="kp-inline"><select value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="douyin">抖音</option><option value="shipinhao">视频号</option><option value="bilibili">B 站</option><option value="shorts">YouTube Shorts</option></select><button onClick={makePack} disabled={!!busy}>打发布包（mp4 + 封面 + SRT + 文案）</button></div>
          {pack && <p style={{fontSize: 12}}>已生成：<code>{pack.dir}</code>{pack.zipName ? ` · ${pack.zipName}` : ''}<br/><small>不自动发布——拖进平台后台即可；AI 标识与素材署名都在文案里。</small></p>}
          <h4>批量出版本（同脚本换音色 / 字幕样式）</h4>
          <div className="kp-row">
            <label>音色（多选）<select multiple size={4} value={batchVoices} onChange={(e) => setBatchVoices([...e.target.selectedOptions].map((o) => o.value))}>{voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
            <label>字幕样式（多选）<select multiple size={3} value={batchCaptions} onChange={(e) => setBatchCaptions([...e.target.selectedOptions].map((o) => o.value))}><option value="douyin">抖音黄字描边</option><option value="clean">简约白</option><option value="boxed">黑底白字</option></select></label>
          </div>
          <div className="kp-actions" style={{justifyContent: 'flex-start'}}><button onClick={runBatch} disabled={!!busy || (batchVoices.length || 1) * (batchCaptions.length || 1) > 12}>出 {(batchVoices.length || 1) * (batchCaptions.length || 1)} 版</button></div>
          {batchResults.length > 0 && <ul className="kp-copy">{batchResults.map((r) => <li key={r.id} style={{cursor: 'default'}}>{r.ok ? '✅' : '⛔'} {r.id}{r.ok ? <> · {r.durationSec?.toFixed(1)}s · <a href={`/api/kaipian/projects/${encodeURIComponent(project.id)}/variant/${encodeURIComponent(r.id)}`} download>下载</a></> : ` ${r.error}`}</li>)}</ul>}
          {busy && log.length > 0 && <pre className="kp-log">{log.slice(-12).join('\n')}</pre>}
          <div className="kp-actions"><button onClick={() => setStep(3)}>改文案重出</button><button className="primary" onClick={() => { setProject(null); setTopic(''); setStep(1); }}>再做一条</button></div>
        </div>
      </div>
    </section>}
    <footer className="kp-foot">产物在 <code>{cfg?.outputDir ?? '~/OpenShorts'}</code> · key 只存本机 · 成片默认带 AI 生成标识 · <a href="https://github.com/jnMetaCode/openshorts" target="_blank" rel="noreferrer">GitHub</a></footer>
  </div>;
};
