import React, {useEffect, useRef, useState} from 'react';
import './kaipian.css';

type Src = {ok: boolean; reason: string; tier?: string};
type Sources = {stock: Src; image: Src; local: Src; cloud: Src; layered: Src; tools: {ffmpeg: boolean; whisper: boolean; magick: boolean}};
type Voice = {id: string; label: string};
type Shot = {id: string; text: string; visualIntent: string; query: string; emphasis: string[]; durationSec: number | null; status: string; visual: {source: string | null; file: string | null; author?: string | null; license?: string}};
type Project = {id: string; title: string; topic: string; shots: Shot[]; voice: {voice: string; rate: number}; captions: {preset: string}; defaults: {visualSource: string; localDirs: string[]}; publish: {titles: string[]; tags: string[]; note: string; aiLabelText: string}; final?: {file: string; srt: string; cover: string | null; publish: string; durationSec: number; notes: string[]; quality?: {pass: boolean; warnings: number; items: Array<{id: string; status: string; msg: string}>}} | null; provenance: Array<{shot: string; source: string; author?: string | null; license?: string; page?: string | null}>};

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => { const r = await fetch(url, {headers: {'Content-Type': 'application/json'}, ...init}); const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const fileUrl = (p: Project, abs: string) => `/api/kaipian/projects/${encodeURIComponent(p.id)}/file/${encodeURIComponent(abs.split('/').pop() || '')}`;

export const Kaipian = () => {
  const [step, setStep] = useState(1);
  const [line, setLine] = useState<'koubo' | 'drama'>('koubo');
  const [topic, setTopic] = useState('');
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
  };
  useEffect(() => {
    refresh().catch((e) => setError(String(e.message)));
    // ?project=<id> 深链：直接打开某个项目（做完的落在第 4 步，没做完的落在第 3 步）
    const id = new URLSearchParams(location.search).get('project');
    if (id) openProject(id).catch((e) => setError(String(e.message)));
  }, []);

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
        <div className="kp-row">
          <label>目标时长<select value={duration} onChange={(e) => setDuration(e.target.value)}>{['45秒', '60秒', '90秒'].map((d) => <option key={d}>{d}</option>)}</select></label>
          <label>语气<select value={tone} onChange={(e) => setTone(e.target.value)}>{['科普讲解', '犀利观点', '轻松口播'].map((d) => <option key={d}>{d}</option>)}</select></label>
        </div>
        {aoStatus && !aoStatus.hasTextKey && <div className="kp-warn">还没有写脚本用的文本模型 key。用你自己的 key：在 AO 密钥页配置（<code>{aoStatus.aoHome}</code>）或设置环境变量 <code>DEEPSEEK_API_KEY</code> 等后重启。</div>}
        <div className="kp-actions"><button className="primary" disabled={!topic.trim() || !!busy} onClick={() => setStep(2)}>下一步：选来源</button></div>
      </> : <div className="kp-warn">AI 短剧的界面在 M2。现在可以用命令行跑同一条流水线：<code>openshorts drama -i story="…" -i video_provider=… </code>（参数与 AO 短剧流水线一致，运行前会先打印花费预览）。</div>}
    </section>}

    {step === 2 && <section className="kp-card">
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

    {step === 4 && project?.final && <section className="kp-card kp-final">
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
          <div className="kp-actions"><button onClick={() => setStep(3)}>改文案重出</button><button className="primary" onClick={() => { setProject(null); setTopic(''); setStep(1); }}>再做一条</button></div>
        </div>
      </div>
    </section>}
    <footer className="kp-foot">产物在 <code>{cfg?.outputDir ?? '~/OpenShorts'}</code> · key 只存本机 · 成片默认带 AI 生成标识 · <a href="https://github.com/jnMetaCode/openshorts" target="_blank" rel="noreferrer">GitHub</a></footer>
  </div>;
};
