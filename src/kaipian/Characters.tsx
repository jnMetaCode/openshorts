import React, {useEffect, useState} from 'react';

// 角色卡面板（短剧第 1 步）：选一张卡 = 外形锁进剧本 + 定妆图直接拿去出片（引擎跳过出图）。
// 卡片本身在 ~/.openshorts/characters，跨片复用；这里只做选、建、改、出图、上传、回退。
export type Card = {
  id: string; name: string; basics: string; face: string; marks: string[]; outfit: string; background: string; extra: string;
  portrait: {file: string; source: 'local-flux' | 'upload' | 'cloud-edit'; seed: number | null; translated?: boolean; ratio?: string | null; provider?: string; model?: string; freeform?: string} | null;
  history: {file: string; source: string; seed: number | null}[]; stale: boolean; drift?: boolean; portraitUrl: string | null;
};
type Form = {name: string; basics: string; face: string; marks: string; outfit: string; background: string; extra: string};
const EMPTY: Form = {name: '', basics: '', face: '', marks: '', outfit: '', background: '', extra: ''};

const req = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(url, init); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any).error || `HTTP ${r.status}`);
  return j as T;
};
const json = (method: string, body: unknown): RequestInit => ({method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
const toForm = (c: Card): Form => ({name: c.name, basics: c.basics, face: c.face, marks: c.marks.join('\n'), outfit: c.outfit, background: c.background, extra: c.extra});
const thumb = (c: Card, file: string) => `/api/kaipian/characters/${encodeURIComponent(c.id)}/portrait?f=${encodeURIComponent(file)}`;

export const Characters = ({lang, t, selected, onSelect, onCard, ratio = '16:9', scene = null}: {lang: string; t: (s: string) => string; selected: string; onSelect: (id: string) => void; onCard?: (c: Card | null) => void; ratio?: string; scene?: {id: string; name: string; imageUrl: string | null} | null}) => {
  const [list, setList] = useState<Card[]>([]);
  const [editing, setEditing] = useState<{id: string | null; form: Form} | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // 云端保脸改图：供应商只列 AO 里配了 key 的；上次用过的那家记在 config.imageEdit
  const [edit, setEdit] = useState<{open: boolean; provider: string; model: string; instruction: string; providers: {id: string; models: string[]}[]}>({open: false, provider: '', model: '', instruction: '', providers: []});
  const openEdit = async () => {
    try {
      const o = await req<{providers: {id: string; models: string[]}[]; saved: {provider: string; model: string} | null}>('/api/kaipian/image-edit/options');
      const p = o.saved?.provider || o.providers[0]?.id || '';
      setEdit({open: true, providers: o.providers, provider: p, model: o.saved?.model || o.providers.find((x) => x.id === p)?.models[0] || '', instruction: ''});
    } catch (e: any) { setError(e.message); }
  };
  const retouch = (c: Card, withScene: boolean) => act(t('云端改图中（按张计费，通常 10–60 秒）…'), () => req<Card>(`/api/kaipian/characters/${encodeURIComponent(c.id)}/edit?lang=${lang}`, json('POST', {provider: edit.provider, model: edit.model, instruction: edit.instruction, ...(withScene && scene ? {scene: scene.id} : {})})));
  const load = async () => { try { setList(await req<Card[]>('/api/kaipian/characters')); } catch (e: any) { setError(e.message); } };
  useEffect(() => { load(); }, []);
  const cur = list.find((c) => c.id === selected) ?? null;
  const C = lang === 'en' ? ': ' : '：';   // 标签后的冒号跟着语言走，英文界面别出全角
  // 第 2 步要知道「这张卡有没有定妆图」：有就不用再选出图供应商
  useEffect(() => { onCard?.(cur); }, [cur]);
  // 换卡 / 出图 / 上传都要替换列表里那一张（整张换，不做字段合并）
  const put = (c: Card) => setList((l) => (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [c, ...l]));
  const act = async (label: string, fn: () => Promise<Card>) => {
    setBusy(label); setError('');
    try { const c = await fn(); put(c); return c; } catch (e: any) { setError(e.message); return null; } finally { setBusy(''); }
  };
  const save = async () => {
    if (!editing) return;
    const body = {...editing.form, marks: editing.form.marks.split('\n').map((s) => s.trim()).filter(Boolean), lang};
    const c = await act(t('保存中…'), () => (editing.id ? req<Card>(`/api/kaipian/characters/${encodeURIComponent(editing.id)}?lang=${lang}`, json('PUT', body)) : req<Card>(`/api/kaipian/characters?lang=${lang}`, json('POST', body))));
    if (c) { setEditing(null); onSelect(c.id); }
  };
  const render = (c: Card, keepSeed: boolean) => act(t('本机出定妆图中（约 2 分钟）…'), () => req<Card>(`/api/kaipian/characters/${encodeURIComponent(c.id)}/render?lang=${lang}`, json('POST', {keepSeed, ratio})));
  const upload = (c: Card, f: File) => act(t('上传中…'), async () => req<Card>(`/api/kaipian/characters/${encodeURIComponent(c.id)}/upload?lang=${lang}`, {method: 'POST', headers: {'Content-Type': f.type || 'application/octet-stream'}, body: await f.arrayBuffer()}));
  const restore = (c: Card, file: string) => act(t('切换中…'), () => req<Card>(`/api/kaipian/characters/${encodeURIComponent(c.id)}/restore?lang=${lang}`, json('POST', {file})));
  const remove = async (c: Card) => {
    if (!confirm(t('删除这张角色卡？定妆图和历史图都会删掉。'))) return;
    try { await req(`/api/kaipian/characters/${encodeURIComponent(c.id)}`, {method: 'DELETE'}); setList((l) => l.filter((x) => x.id !== c.id)); if (selected === c.id) onSelect(''); } catch (e: any) { setError(e.message); }
  };
  const field = (k: keyof Form, label: string, ph: string, rows = 0) => (
    <label key={k}>{t(label)}{rows ? <textarea rows={rows} value={editing!.form[k]} placeholder={t(ph)} onChange={(e) => setEditing({...editing!, form: {...editing!.form, [k]: e.target.value}})}/> : <input value={editing!.form[k]} placeholder={t(ph)} onChange={(e) => setEditing({...editing!, form: {...editing!.form, [k]: e.target.value}})}/>}</label>
  );

  return <div className="kp-chars">
    <h4>{t('主角（角色卡，可选）')}</h4>
    <div className="kp-chips">
      <button className={!selected ? 'active' : ''} onClick={() => onSelect('')}>{t('不用角色卡（AI 按故事捏一个）')}</button>
      {list.map((c) => <button key={c.id} className={selected === c.id ? 'active' : ''} onClick={() => onSelect(c.id)}>
        {c.portraitUrl ? <img src={c.portraitUrl} alt="" className="kp-thumb"/> : null}{c.name}{c.stale ? ' ⚠️' : ''}</button>)}
      <button onClick={() => setEditing({id: null, form: EMPTY})}>＋ {t('新建角色')}</button>
    </div>
    {cur && !editing && <div className="kp-charcard">
      {cur.portraitUrl ? <img src={cur.portraitUrl} alt={cur.name} className="kp-portrait"/> : <div className="kp-portrait kp-empty">{t('还没有定妆图')}</div>}
      <div>
        <p><b>{cur.name}</b> · {cur.basics}</p>
        {cur.face && <p>{t('面容')}{C}{cur.face}</p>}
        {cur.marks.length > 0 && <p>{t('标志特征')}{C}{cur.marks.join(' · ')}</p>}
        {cur.outfit && <p>{t('服装')}{C}{cur.outfit}</p>}
        {cur.background && <p>{t('定妆图背景')}{C}{cur.background}</p>}
        {cur.portrait?.ratio && (ratio === '16:9' ? cur.portrait.ratio !== '16:9' : cur.portrait.ratio === '16:9') && <div className="kp-warn">{t('定妆图的画幅跟片子不一样：出片首帧会从中间裁，人可能只剩半身。点「同种子重出」会按片子的画幅重出一张。')}</div>}
        {cur.drift && <div className="kp-warn">{t('定妆图按这句改过：')}「{cur.portrait?.freeform}」{t('——卡片里的服装 / 背景文字还是旧的。剧本照文字写、第一帧照图出，不改会对不上：点「改设定」把文字改成跟图一致。')}</div>}
        {cur.stale && <div className="kp-warn">{t('卡片改过，定妆图还是旧的——用「同种子重出」更新（脸型构图大体保留，细节会变）')}</div>}
        {cur.portrait?.translated === false && <div className="kp-warn">{t('出这张图时没配文本模型，提示词没翻成英文，效果会差一些')}</div>}
        <p className="kp-hint">{cur.portrait ? t('出片时直接用这张定妆图，不再单独出图（省一张图的钱）。外形文字同时锁进剧本。') : t('没有定妆图时只锁外形文字，定妆图照常由引擎出。')}</p>
        <div className="kp-actions">
          <button disabled={!!busy} onClick={() => render(cur, false)}>{cur.portrait ? t('换一张（新种子）') : t('本机出定妆图（不花钱）')}</button>
          {cur.portrait?.seed != null && <button disabled={!!busy} onClick={() => render(cur, true)}>{t('同种子重出')}</button>}
          <label className="kp-btn">{t('上传面容图 / 定妆图')}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(cur, f); e.target.value = ''; }}/></label>
          {cur.portrait && <button disabled={!!busy} onClick={() => (edit.open ? setEdit({...edit, open: false}) : openEdit())}>{t('保脸改图（云端）')}</button>}
          <button disabled={!!busy} onClick={() => setEditing({id: cur.id, form: toForm(cur)})}>{t('改设定')}</button>
          <button disabled={!!busy} onClick={() => remove(cur)}>{t('删除')}</button>
        </div>
        {edit.open && cur.portrait && <div className="kp-charform">
          <p className="kp-hint">{t('以当前定妆图为参考，保住脸只改你说的那部分。本机做不到这一步（本机出图不收参考图）；按供应商单张计费。')}</p>
          {edit.providers.length === 0 ? <div className="kp-warn">{t('还没有配任何出图供应商的 key——设置里存一把（比如 agnes / 火山 / lanox），再回来改图。')}</div> : <div className="kp-row">
            <label>{t('改图供应商')}<select value={edit.provider} onChange={(e) => setEdit({...edit, provider: e.target.value, model: edit.providers.find((x) => x.id === e.target.value)?.models[0] ?? ''})}>{edit.providers.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}</select></label>
            <label>{t('模型（要支持改图）')}<input value={edit.model} onChange={(e) => setEdit({...edit, model: e.target.value})} placeholder="agnes-image-2.5-flash"/></label>
          </div>}
          <label>{t('要改什么（留空 = 按卡片改动自动写）')}<textarea rows={2} value={edit.instruction} placeholder={t('比如：换成白衬衫、袖子挽起；背景换成夜里的便利店门口')} onChange={(e) => setEdit({...edit, instruction: e.target.value})}/></label>
          <div className="kp-actions">
            <button disabled={!!busy || !edit.provider || !edit.model} onClick={() => retouch(cur, false)}>{t('改图')}</button>
            {scene?.imageUrl && <button className="primary" disabled={!!busy || !edit.provider || !edit.model} onClick={() => retouch(cur, true)}>{t('放进这个场景')}「{scene.name}」</button>}
          </div>
        </div>}
        {cur.history.length > 0 && <div className="kp-history">{t('历史定妆图（点一下换回去）')}{C}{cur.history.slice().reverse().map((h) =>
          <img key={h.file} src={thumb(cur, h.file)} alt="" className="kp-thumb" title={`${h.source}${h.seed != null ? ` · seed ${h.seed}` : ''}`} onClick={() => !busy && restore(cur, h.file)}/>)}</div>}
      </div>
    </div>}
    {editing && <div className="kp-charform">
      <div className="kp-row">{field('name', '名字（只在本机识别用，不写进剧本）', '陈伟')}{field('basics', '基础人设', '28 岁男性外卖骑手，中等身材，疲惫但眼神警觉')}</div>
      {field('face', '面容', '方脸，短黑发略乱，黑框眼镜，胡茬')}
      {field('marks', '标志特征（一行一条，每一镜都要在）', '左眉尾一道浅疤\n右手背贴着创可贴', 3)}
      <div className="kp-row">{field('outfit', '服装', '深蓝色外卖冲锋衣，袖口磨白')}{field('background', '定妆图背景（留空 = 浅灰棚拍；写成剧里的场景，出片第一帧就是人在场景里）', '雨夜老小区楼道，昏黄声控灯')}</div>
      {field('extra', '其它细节', '')}
      <div className="kp-actions"><button onClick={() => setEditing(null)}>{t('取消')}</button><button className="primary" disabled={!!busy || !editing.form.name.trim()} onClick={save}>{t('保存角色')}</button></div>
    </div>}
    {busy && <p className="kp-hint">{busy}</p>}
    {error && <div className="kp-error">{error}</div>}
  </div>;
};
