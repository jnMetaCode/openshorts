import React, {useEffect, useState} from 'react';

// 场景卡面板（短剧第 1 步）：选一个场景 = 场景描述锁进剧本；有场景图时，角色卡那边可以"把人放进这个场景"。
export type Scene = {
  id: string; name: string; place: string; time: string; details: string; style: string;
  image: {file: string; source: string} | null; history: {file: string; source: string}[]; stale: boolean; imageUrl: string | null;
};
type Form = {name: string; place: string; time: string; details: string; style: string};
const EMPTY: Form = {name: '', place: '', time: '', details: '', style: ''};
const req = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(url, init); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any).error || `HTTP ${r.status}`);
  return j as T;
};
const json = (method: string, body: unknown): RequestInit => ({method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});

export const Scenes = ({lang, t, selected, onSelect, onScene, ratio = '16:9'}: {lang: string; t: (s: string) => string; selected: string; onSelect: (id: string) => void; onScene?: (s: Scene | null) => void; ratio?: string}) => {
  const [list, setList] = useState<Scene[]>([]);
  const [editing, setEditing] = useState<{id: string | null; form: Form} | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { req<Scene[]>('/api/kaipian/scenes').then(setList).catch((e) => setError(e.message)); }, []);
  const cur = list.find((x) => x.id === selected) ?? null;
  useEffect(() => { onScene?.(cur); }, [cur]);
  const C = lang === 'en' ? ': ' : '：';
  const put = (x: Scene) => setList((l) => (l.some((y) => y.id === x.id) ? l.map((y) => (y.id === x.id ? x : y)) : [x, ...l]));
  const act = async (label: string, fn: () => Promise<Scene>) => {
    setBusy(label); setError('');
    try { const x = await fn(); put(x); return x; } catch (e: any) { setError(e.message); return null; } finally { setBusy(''); }
  };
  const save = async () => {
    if (!editing) return;
    const body = {...editing.form, lang};
    const x = await act(t('保存中…'), () => (editing.id ? req<Scene>(`/api/kaipian/scenes/${encodeURIComponent(editing.id)}?lang=${lang}`, json('PUT', body)) : req<Scene>(`/api/kaipian/scenes?lang=${lang}`, json('POST', body))));
    if (x) { setEditing(null); onSelect(x.id); }
  };
  const remove = async (x: Scene) => {
    if (!confirm(t('删除这个场景卡？场景图也会删掉。'))) return;
    try { await req(`/api/kaipian/scenes/${encodeURIComponent(x.id)}`, {method: 'DELETE'}); setList((l) => l.filter((y) => y.id !== x.id)); if (selected === x.id) onSelect(''); } catch (e: any) { setError(e.message); }
  };
  const field = (k: keyof Form, label: string, ph: string, rows = 0) => (
    <label key={k}>{t(label)}{rows ? <textarea rows={rows} value={editing!.form[k]} placeholder={t(ph)} onChange={(e) => setEditing({...editing!, form: {...editing!.form, [k]: e.target.value}})}/> : <input value={editing!.form[k]} placeholder={t(ph)} onChange={(e) => setEditing({...editing!, form: {...editing!.form, [k]: e.target.value}})}/>}</label>
  );

  return <div className="kp-chars">
    <h4>{t('场景（场景卡，可选）')}</h4>
    <div className="kp-chips">
      <button className={!selected ? 'active' : ''} onClick={() => onSelect('')}>{t('不用场景卡（AI 按故事定景）')}</button>
      {list.map((x) => <button key={x.id} className={selected === x.id ? 'active' : ''} onClick={() => onSelect(x.id)}>
        {x.imageUrl ? <img src={x.imageUrl} alt="" className="kp-thumb kp-thumb-wide"/> : null}{x.name}{x.stale ? ' ⚠️' : ''}</button>)}
      <button onClick={() => setEditing({id: null, form: EMPTY})}>＋ {t('新建场景')}</button>
    </div>
    {cur && !editing && <div className="kp-charcard">
      {cur.imageUrl ? <img src={cur.imageUrl} alt={cur.name} className="kp-portrait"/> : <div className="kp-portrait kp-empty">{t('还没有场景图')}</div>}
      <div>
        <p><b>{cur.name}</b> · {cur.place}</p>
        {cur.time && <p>{t('时间 / 天气 / 光线')}{C}{cur.time}</p>}
        {cur.details && <p>{t('细节')}{C}{cur.details}</p>}
        {cur.style && <p>{t('画面风格')}{C}{cur.style}</p>}
        {cur.stale && <div className="kp-warn">{t('场景改过，场景图还是旧的')}</div>}
        <p className="kp-hint">{t('场景描述会锁进剧本。有场景图时，可以在上面的角色卡里点「放进这个场景」，让出片第一帧就是人在景里。')}</p>
        <div className="kp-actions">
          <button disabled={!!busy} onClick={() => act(t('本机出场景图中（约 2 分钟）…'), () => req<Scene>(`/api/kaipian/scenes/${encodeURIComponent(cur.id)}/render?lang=${lang}`, json('POST', {ratio})))}>{cur.image ? t('换一张（新种子）') : t('本机出场景图（不花钱）')}</button>
          <label className="kp-btn">{t('上传场景图')}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) act(t('上传中…'), async () => req<Scene>(`/api/kaipian/scenes/${encodeURIComponent(cur.id)}/upload?lang=${lang}`, {method: 'POST', headers: {'Content-Type': f.type || 'application/octet-stream'}, body: await f.arrayBuffer()})); }}/></label>
          <button disabled={!!busy} onClick={() => setEditing({id: cur.id, form: {name: cur.name, place: cur.place, time: cur.time, details: cur.details, style: cur.style}})}>{t('改设定')}</button>
          <button disabled={!!busy} onClick={() => remove(cur)}>{t('删除')}</button>
        </div>
      </div>
    </div>}
    {editing && <div className="kp-charform">
      <div className="kp-row">{field('name', '名字（只在本机识别用）', '旧天台')}{field('place', '地点', '老居民楼天台，水箱，晾衣绳')}</div>
      <div className="kp-row">{field('time', '时间 / 天气 / 光线', '傍晚，雨后，天边橙红')}{field('style', '画面风格', '胶片质感，暖色')}</div>
      {field('details', '细节', '一把旧藤椅，地上有积水', 2)}
      <div className="kp-actions"><button onClick={() => setEditing(null)}>{t('取消')}</button><button className="primary" disabled={!!busy || !editing.form.name.trim() || !editing.form.place.trim()} onClick={save}>{t('保存场景')}</button></div>
    </div>}
    {busy && <p className="kp-hint">{busy}</p>}
    {error && <div className="kp-error">{error}</div>}
  </div>;
};
