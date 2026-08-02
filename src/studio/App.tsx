import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Player} from '@remotion/player';
import {PaperVideo} from '../remotion/PaperVideo';
import {subtitleBottomRatio} from '../../shared/captions.mjs';
import {getProjectDuration, projectSchema, type Layer, type PaperProject, type PlannedAsset, type Scene} from '../domain/project';
import './v08.css';
import './v09.css';
import './v10.css';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type RenderState = {id?: string; status: string; progress?: number; output?: string; error?: string};
type QualityState = {status: 'idle' | 'running' | 'done' | 'error'; report?: string; error?: string};
type DragState = {id: string; clientX: number; clientY: number; x: number; y: number} | null;
type AssetInspection = {width: number; height: number; channels: string; hasTransparency: boolean; touchesEdge: boolean};
type ProcessedAsset = {path: string; inspection: AssetInspection};
type AdapterSummary = {id: string; name: string; transport: string; configured: boolean};
type ProjectSummary = {id: string; title: string; scenes: number; updatedAt: string};
type TemplateSummary = {id: string; name: string; description: string; category: string};
type JobSummary = {id: string; type: string; status: string; progress: number; output?: string; error?: string; variant?: string; assets?: ProcessedAsset[]};
type StyleSummary = {id: string; name: string; palette: string};
type PlannerSummary = {id: string; name: string; configured: boolean; description: string};
type StoryboardPreview = {title: string; totalFrames: number; fps: number; scenes: Array<{id: string; title: string; narration: string; purpose: string; shotType: string; durationFrames: number; assets: Array<{name: string; role: string; prompt: string}>}>};

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const assetUrl = (src: string) => /^(https?:|data:|blob:)/.test(src) ? src : `/${src.replace(/^\//, '')}`;

const NumberField = ({label, value, onChange, step = 1}: {label: string; value: number; onChange: (value: number) => void; step?: number}) =>
  <label className="field"><span>{label}</span><input type="number" value={value} step={step} onChange={(event) => onChange(Number(event.target.value))}/></label>;

const LayoutCanvas = ({project, scene, selectedId, onSelect, onMoveStart, onMove, onMoveEnd}: {
  project: PaperProject; scene: Scene; selectedId: string | null; onSelect: (id: string) => void;
  onMoveStart: (event: React.PointerEvent<HTMLImageElement>, layer: Layer) => void;
  onMove: (event: React.PointerEvent<HTMLImageElement>) => void; onMoveEnd: () => void;
}) => <div className="layout-canvas" style={{aspectRatio: `${project.width}/${project.height}`, background: scene.backgroundColor}}>
  {[...scene.layers].sort((a, b) => a.zIndex - b.zIndex).map((item) => {
    const box = {left: `${item.x / project.width * 100}%`, top: `${item.y / project.height * 100}%`, width: `${item.width / project.width * 100}%`, zIndex: item.zIndex, opacity: item.opacity, transform: `rotate(${item.rotation}deg) scaleX(${item.flipX ? -1 : 1})`};
    const common = {
      key: item.id,
      className: item.id === selectedId ? 'selected' : '',
      onClick: (event: React.MouseEvent) => {event.stopPropagation(); onSelect(item.id);},
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => onMoveStart(event as React.PointerEvent<HTMLImageElement>, item),
      onPointerMove: onMove as unknown as (event: React.PointerEvent<HTMLElement>) => void,
      onPointerUp: onMoveEnd, onPointerCancel: onMoveEnd,
    };
    // 文字图层没有 src，画布上直接渲染文字，否则拖拽排版会拿到 undefined
    if (item.kind === 'text' && item.style) return <div {...common} style={{
      ...box, position: 'absolute', whiteSpace: 'pre-wrap', cursor: 'grab',
      textAlign: item.style.align, color: item.style.color ?? project.theme.paper,
      background: item.style.background, padding: item.style.padding,
      fontFamily: item.style.mono ? 'ui-monospace, Menlo, monospace' : 'inherit',
      fontSize: `${item.style.fontSize / project.width * 100}cqw`,
      fontWeight: item.style.fontWeight, lineHeight: item.style.lineHeight,
    }}>{item.style.text}</div>;
    return <img {...common} src={assetUrl(item.src ?? '')} alt={item.name} draggable={false} style={box}/>;
  })}
  <span className="safe-area" style={{bottom: `${subtitleBottomRatio(project.width, project.height) * 100}%`}}>字幕安全区</span>
  {project.height > project.width && <span className="platform-unsafe">平台 UI 遮挡区</span>}
</div>;

export const App: React.FC = () => {
  const [project, setProject] = useState<PaperProject | null>(null);
  const [past, setPast] = useState<PaperProject[]>([]);
  const [future, setFuture] = useState<PaperProject[]>([]);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [layerId, setLayerId] = useState<string | null>(null);
  const [mode, setMode] = useState<'preview' | 'layout'>('preview');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [render, setRender] = useState<RenderState>({status: 'idle'});
  const [quality, setQuality] = useState<QualityState>({status: 'idle'});
  const [notice, setNotice] = useState('');
  const [assetInspection, setAssetInspection] = useState<AssetInspection | null>(null);
  const [processedAssets, setProcessedAssets] = useState<ProcessedAsset[]>([]);
  const [keyColor, setKeyColor] = useState('#00ff00');
  const [keyFuzz, setKeyFuzz] = useState(12);
  const [preserveCanvas, setPreserveCanvas] = useState(true);
  const [grid, setGrid] = useState({rows: 1, columns: 3});
  const [adapters, setAdapters] = useState<AdapterSummary[]>([]);
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('tang-landscape');
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [batchText, setBatchText] = useState('[\n  {"name":"长安版","variables":{"城市":"长安"}},\n  {"name":"洛阳版","variables":{"城市":"洛阳"}}\n]');
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [styles, setStyles] = useState<StyleSummary[]>([]);
  const [planners, setPlanners] = useState<PlannerSummary[]>([]);
  const [storyForm, setStoryForm] = useState({title: '我的纸片故事', text: '长安城从晨雾中醒来。来自远方的使者走进宫门。盛唐的故事，从这一刻展开。', styleId: 'tang-collage', aspect: '16:9', planner: 'rules', characterBible: '主角：唐代青年，深青色圆领袍，黑色幞头，二十五岁'});
  const [storyboardPreview, setStoryboardPreview] = useState<StoryboardPreview | null>(null);
  const [briefUrl, setBriefUrl] = useState<string | null>(null);
  const [keyframeFrame, setKeyframeFrame] = useState(0);
  const [promptDraft, setPromptDraft] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSelection, setReviewSelection] = useState<string[]>([]);
  const [reviewNote, setReviewNote] = useState('');
  const [traceDraft, setTraceDraft] = useState({provider:'manual',model:'',seed:'',parameters:'{}'});
  const [waveformSrc, setWaveformSrc] = useState<string | null>(null);
  const [asrState, setAsrState] = useState<{configured:boolean;command?:string}>({configured:false});
  const dragRef = useRef<DragState>(null);

  const checkpoint = (snapshot: PaperProject) => {
    setPast((items) => [...items.slice(-39), structuredClone(snapshot)]);
    setFuture([]);
  };

  const updateProject = (fn: (draft: PaperProject) => void, record = true) => {
    if (!project) return;
    if (record) checkpoint(project);
    const draft = structuredClone(project);
    fn(draft);
    setProject(draft);
    setSaveState('idle');
  };

  const undo = () => {
    if (!project || !past.length) return;
    const previous = past[past.length - 1];
    setFuture((items) => [structuredClone(project), ...items].slice(0, 40));
    setPast((items) => items.slice(0, -1));
    setProject(previous); setSaveState('idle');
  };

  const redo = () => {
    if (!project || !future.length) return;
    const next = future[0];
    setPast((items) => [...items.slice(-39), structuredClone(project)]);
    setFuture((items) => items.slice(1));
    setProject(next); setSaveState('idle');
  };

  useEffect(() => { fetch('/api/project').then((response) => response.json()).then((data) => {
    const parsed = projectSchema.parse(data);
    setProject(parsed); setLayerId(parsed.scenes[0]?.layers[0]?.id ?? null);
  }).catch((error) => setNotice(`项目载入失败：${error.message}`)); }, []);

  const refreshWorkspace = async () => {
    const [projectItems, templateItems, jobItems] = await Promise.all([fetch('/api/projects').then((response) => response.json()), fetch('/api/templates').then((response) => response.json()), fetch('/api/jobs').then((response) => response.json())]);
    setProjectList(projectItems); setTemplates(templateItems); setJobs(jobItems);
  };

  useEffect(() => {fetch('/api/adapters').then((response) => response.json()).then(setAdapters).catch(() => setAdapters([])); fetch('/api/storyboards/styles').then((response) => response.json()).then(setStyles).catch(() => setStyles([])); fetch('/api/storyboards/planners').then((response) => response.json()).then(setPlanners).catch(() => setPlanners([])); fetch('/api/asr').then((response) => response.json()).then(setAsrState).catch(() => undefined); void refreshWorkspace();}, []);

  useEffect(() => {const timer = window.setInterval(() => {fetch('/api/jobs').then((response) => response.json()).then(setJobs).catch(() => undefined);}, 3000); return () => window.clearInterval(timer);}, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault(); event.shiftKey ? redo() : undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project, past, future]);

  useEffect(() => {
    if (render.status !== 'queued' && render.status !== 'rendering') return;
    const timer = window.setInterval(async () => {
      const next = await fetch(`/api/render/status${render.id ? `?id=${render.id}` : ''}`).then((response) => response.json());
      setRender(next);
      if (next.status === 'done' || next.status === 'failed') {window.clearInterval(timer); void refreshWorkspace();}
    }, 1000);
    return () => window.clearInterval(timer);
  }, [render.status]);

  const scene = project?.scenes[sceneIndex];
  const layer = scene?.layers.find((item) => item.id === layerId) ?? null;
  const plannedAsset = project?.production?.assetPlan.find((item) => item.id === layer?.assetPlanId);
  const duration = useMemo(() => project ? getProjectDuration(project) : 1, [project]);
  useEffect(() => {
    setWaveformSrc(null); if (!scene?.narrationSrc) return;
    fetch('/api/audio/waveform',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({src:scene.narrationSrc})}).then((response) => response.json()).then((body) => body.path && setWaveformSrc(body.path)).catch(() => undefined);
  },[scene?.narrationSrc]);
  const updateLayer = (patch: Partial<Layer>, record = true) => updateProject((draft) => {
    const target = draft.scenes[sceneIndex].layers.find((item) => item.id === layerId);
    if (target) Object.assign(target, patch);
  }, record);

  const selectScene = (index: number) => {
    setSceneIndex(index); setLayerId(project?.scenes[index]?.layers[0]?.id ?? null); setKeyframeFrame(0);
  };

  useEffect(() => {setPromptDraft(plannedAsset?.prompt ?? '');}, [plannedAsset?.id, plannedAsset?.prompt]);
  useEffect(() => {setTraceDraft({provider:plannedAsset?.generation?.provider ?? 'manual',model:plannedAsset?.generation?.model ?? '',seed:String(plannedAsset?.generation?.seed ?? ''),parameters:JSON.stringify(plannedAsset?.generation?.parameters ?? {},null,2)});}, [plannedAsset?.id]);

  const upsertKeyframe = () => {
    if (!layer || !scene) return;
    const frame = Math.max(0, Math.min(scene.durationFrames - 1, Math.round(keyframeFrame)));
    const item = {frame, x: layer.x, y: layer.y, width: layer.width, rotation: layer.rotation, opacity: layer.opacity, easing: 'ease-in-out' as const};
    updateLayer({keyframes: [...(layer.keyframes ?? []).filter((keyframe) => keyframe.frame !== frame), item].sort((a, b) => a.frame - b.frame)});
  };

  const deleteKeyframe = (frame: number) => layer && updateLayer({keyframes: (layer.keyframes ?? []).filter((item) => item.frame !== frame)});

  const updateKeyframe = (frame: number, patch: Partial<NonNullable<Layer['keyframes']>[number]>) => layer && updateLayer({keyframes: (layer.keyframes ?? []).map((item) => item.frame === frame ? {...item, ...patch} : item)});

  const savePromptVersion = async () => {
    if (!project || !plannedAsset || !promptDraft.trim()) return;
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/prompts/${encodeURIComponent(plannedAsset.id)}/versions`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:promptDraft,note:'编辑器保存'})});
    const body = await response.json(); if (!response.ok) return setNotice(body.error ?? '提示词版本保存失败');
    setProject(projectSchema.parse(body)); setSaveState('saved'); setNotice('提示词新版本已保存');
  };

  const activatePrompt = async (versionId: string) => {
    if (!project || !plannedAsset) return;
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/prompts/${encodeURIComponent(plannedAsset.id)}/activate`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({versionId})});
    const body = await response.json(); if (!response.ok) return setNotice(body.error ?? '提示词版本切换失败'); setProject(projectSchema.parse(body)); setSaveState('saved');
  };

  const autoMatchAssets = async () => {
    if (!project || !processedAssets.length) return setNotice('请先上传、拆分或生成一批素材');
    const assets = processedAssets.map((item) => ({path:item.path, role: layer?.role, sceneId: scene?.id}));
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/assets/auto-match`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({assets})});
    const body = await response.json(); if (!response.ok) return setNotice(body.error ?? '素材匹配失败');
    setProject(projectSchema.parse(body.project)); setSaveState('saved'); setNotice(`已自动匹配 ${body.matches.length} 项素材`);
  };

  const reviewSelected = async (status: 'approved' | 'rejected') => {
    if (!project || !reviewSelection.length) return setNotice('请先选择需要审核的素材');
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/assets/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({assetIds:reviewSelection,status,note:reviewNote})});
    const body = await response.json(); if (!response.ok) return setNotice(body.error ?? '素材审核失败');
    setProject(projectSchema.parse(body.project)); setSaveState('saved'); setReviewSelection([]); setNotice(`已${status === 'approved' ? '批准' : '退回'} ${body.updated} 项素材`);
  };

  const saveGenerationTrace = async () => {
    if (!project || !plannedAsset) return;
    try {
      const parameters = JSON.parse(traceDraft.parameters || '{}');
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/assets/${encodeURIComponent(plannedAsset.id)}/trace`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...traceDraft,parameters})});
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? '来源记录保存失败'); setProject(projectSchema.parse(body)); setSaveState('saved'); setNotice('生成来源已记录');
    } catch (error) {setNotice(error instanceof Error ? error.message : '生成参数 JSON 无效');}
  };

  const retimeNarration = async () => {
    if (!project) return;
    await save(); const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/retime-narration`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({paddingSeconds:.2})});
    const body = await response.json(); if (!response.ok) return setNotice(body.error ?? '旁白节奏重排失败');
    setProject(projectSchema.parse(body.project)); setSaveState('saved'); setNotice(`已按旁白重排 ${body.updated} 个镜头，字幕与关键帧同步缩放`);
  };

  const switchProject = async (id: string) => {
    if (id === project?.id) return;
    await save();
    await fetch(`/api/projects/${encodeURIComponent(id)}/activate`, {method: 'POST'});
    const parsed = projectSchema.parse(await fetch(`/api/projects/${encodeURIComponent(id)}`).then((response) => response.json()));
    setProject(parsed); setPast([]); setFuture([]); setSceneIndex(0); setLayerId(parsed.scenes[0]?.layers[0]?.id ?? null); setSaveState('saved');
  };

  const createProject = async () => {
    const response = await fetch('/api/projects', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({templateId: selectedTemplate})});
    const body = await response.json();
    if (!response.ok) return setNotice(body.error ?? '创建项目失败');
    const parsed = projectSchema.parse(body); setProject(parsed); setPast([]); setFuture([]); setSceneIndex(0); setLayerId(parsed.scenes[0]?.layers[0]?.id ?? null); setSaveState('saved'); await refreshWorkspace();
  };

  const exportPackage = async () => {
    await save();
    const response = await fetch(`/api/projects/${encodeURIComponent(project!.id)}/export`, {method: 'POST'}); const body = await response.json();
    if (!response.ok) return setNotice(body.error ?? '项目打包失败');
    const link = document.createElement('a'); link.href = body.download; link.click(); setNotice(`项目包已生成，包含 ${body.assets} 个素材`);
  };

  const importPackage = async (file: File) => {
    const form = new FormData(); form.append('bundle', file);
    const response = await fetch('/api/projects/import', {method: 'POST', body: form}); const body = await response.json();
    if (!response.ok) return setNotice(body.error ?? '项目包导入失败');
    const parsed = projectSchema.parse(body.project); setProject(parsed); setPast([]); setFuture([]); setSceneIndex(0); setLayerId(parsed.scenes[0]?.layers[0]?.id ?? null); setSaveState('saved'); await refreshWorkspace(); setNotice(`项目包导入成功，共迁移 ${body.assets} 个素材`);
  };

  const duplicateScene = () => {
    if (!scene) return;
    const copy = structuredClone(scene);
    copy.id = uid('scene'); copy.name = `${scene.name} 副本`;
    copy.layers.forEach((item) => {item.id = uid('layer');});
    updateProject((draft) => draft.scenes.splice(sceneIndex + 1, 0, copy));
    setSceneIndex(sceneIndex + 1); setLayerId(copy.layers[0]?.id ?? null);
  };

  const deleteScene = () => {
    if (!project || project.scenes.length <= 1) return setNotice('项目至少需要保留一个镜头');
    updateProject((draft) => draft.scenes.splice(sceneIndex, 1));
    const nextIndex = Math.max(0, sceneIndex - 1);
    const nextScene = sceneIndex === 0 ? project.scenes[1] : project.scenes[sceneIndex - 1];
    setSceneIndex(nextIndex); setLayerId(nextScene?.layers[0]?.id ?? null);
  };

  const duplicateLayer = () => {
    if (!layer) return;
    const copy = {...structuredClone(layer), id: uid('layer'), name: `${layer.name} 副本`, x: layer.x + 35, y: layer.y + 25, zIndex: layer.zIndex + 1};
    updateProject((draft) => draft.scenes[sceneIndex].layers.push(copy));
    setLayerId(copy.id);
  };

  const deleteLayer = () => {
    if (!scene || !layer) return;
    if (scene.layers.length <= 1) return setNotice('镜头至少需要保留一个图层');
    const nextId = scene.layers.find((item) => item.id !== layer.id)?.id ?? null;
    updateProject((draft) => {draft.scenes[sceneIndex].layers = draft.scenes[sceneIndex].layers.filter((item) => item.id !== layer.id);});
    setLayerId(nextId);
  };

  const save = async () => {
    if (!project) return;
    setSaveState('saving');
    const response = await fetch('/api/project', {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(project)});
    setSaveState(response.ok ? 'saved' : 'error');
    if (!response.ok) setNotice((await response.json()).error ?? '保存失败');
  };

  const exportJson = () => {
    if (!project) return;
    const blob = new Blob([JSON.stringify(project, null, 2)], {type: 'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `${project.id}.json`; link.click(); URL.revokeObjectURL(link.href);
  };

  const importJson = async (file: File) => {
    try {
      const parsed = projectSchema.parse(JSON.parse(await file.text()));
      if (project) checkpoint(project);
      setProject(parsed); setSceneIndex(0); setLayerId(parsed.scenes[0].layers[0]?.id ?? null); setSaveState('idle');
      setNotice(`已导入 ${file.name}，保存后写入当前项目`);
    } catch (error) { setNotice(`导入失败：${error instanceof Error ? error.message : 'JSON 格式错误'}`); }
  };

  const upload = async (file: File) => {
    const form = new FormData(); form.append('asset', file);
    const response = await fetch('/api/assets', {method: 'POST', body: form});
    const body = await response.json();
    if (!response.ok) return setNotice(body.error ?? '上传失败');
    if (layer) updateProject((draft) => {
      const target = draft.scenes[sceneIndex].layers.find((item) => item.id === layer.id); if (target) target.src = body.path;
      const plan = draft.production?.assetPlan.find((item) => item.id === layer.assetPlanId); if (plan) Object.assign(plan,{src:body.path,status:'ready'});
    });
    setAssetInspection(null); setProcessedAssets([]);
    setNotice(`已上传 ${file.name}，并替换当前图层`);
  };

  const inspectAsset = async () => {
    if (!layer) return;
    const response = await fetch('/api/assets/inspect', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({src: layer.src ?? ""})});
    const body = await response.json();
    if (!response.ok) return setNotice(body.error ?? '素材检查失败');
    setAssetInspection(body);
  };

  const keyAsset = async () => {
    if (!layer) return;
    const response = await fetch('/api/assets/key', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({src: layer.src ?? "", color: keyColor, fuzz: keyFuzz, preserveCanvas})});
    const body = await response.json();
    if (!response.ok) return setNotice(body.error ?? '抠图失败');
    updateProject((draft) => {
      const target = draft.scenes[sceneIndex].layers.find((item) => item.id === layer.id); if (target) target.src = body.path;
      const plan = draft.production?.assetPlan.find((item) => item.id === layer.assetPlanId); if (plan) Object.assign(plan,{src:body.path,status:'ready'});
    }); setAssetInspection(body.inspection); setProcessedAssets([{path: body.path, inspection: body.inspection}]);
    setNotice('纯色背景已移除，并替换当前图层');
  };

  const splitAsset = async () => {
    if (!layer) return;
    const response = await fetch('/api/assets/split', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({src: layer.src, rows: grid.rows, columns: grid.columns, prefix: layer.name})});
    const body = await response.json();
    if (!response.ok) return setNotice(body.error ?? '素材表拆分失败');
    setProcessedAssets(body.assets); setNotice(`已拆分出 ${body.assets.length} 个独立素材，点击缩略图替换图层`);
  };

  const uploadAudio = async (file: File, target: 'narration' | 'soundtrack') => {
    const form = new FormData(); form.append('audio', file);
    const response = await fetch('/api/audio', {method: 'POST', body: form});
    const body = await response.json();
    if (!response.ok) return setNotice(body.error ?? '音频上传失败');
    if (target === 'narration') setWaveformSrc(body.waveform ?? null);
    updateProject((draft) => {
      if (target === 'soundtrack') { draft.soundtrackSrc = body.path; return; }
      const targetScene = draft.scenes[sceneIndex];
      targetScene.narrationSrc = body.path;
      const nextDuration = Math.max(1, Math.ceil(body.durationSeconds * draft.fps));
      targetScene.durationFrames = nextDuration;
      targetScene.captions = targetScene.captions
        .filter((caption) => caption.fromFrame < nextDuration)
        .map((caption) => ({...caption, toFrame: Math.max(caption.fromFrame + 1, Math.min(caption.toFrame, nextDuration))}));
    });
    setNotice(target === 'narration' ? `旁白 ${body.durationSeconds.toFixed(2)} 秒，镜头已自动匹配为 ${Math.ceil(body.durationSeconds * project!.fps)} 帧` : '背景音乐已更新');
  };

  const transcribeNarration = async () => {
    if (!project || !scene) return;
    await save(); const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/scenes/${encodeURIComponent(scene.id)}/transcribe`,{method:'POST'}); const body = await response.json();
    if (!response.ok) return setNotice(body.error ?? '旁白转写失败'); setProject(projectSchema.parse(body.project)); setSaveState('saved'); setNotice(`已生成 ${body.transcript.segments.length} 段逐字字幕`);
  };

  const addCaption = () => {
    if (!project || !scene) return;
    const last = scene.captions.at(-1);
    const suggestedStart = Math.min(last?.toFrame ?? 0, Math.max(0, scene.durationFrames - 1));
    const fromFrame = suggestedStart >= scene.durationFrames - 1 ? Math.max(0, scene.durationFrames - project.fps * 2) : suggestedStart;
    const toFrame = Math.min(scene.durationFrames, Math.max(fromFrame + 1, fromFrame + project.fps * 2));
    updateProject((draft) => draft.scenes[sceneIndex].captions.push({text: '新字幕', fromFrame, toFrame, words: []}));
  };

  const updateCaption = (index: number, patch: Partial<Scene['captions'][number]>) => updateProject((draft) => {
    const caption = draft.scenes[sceneIndex].captions[index];
    Object.assign(caption, patch);
    caption.fromFrame = Math.max(0, Math.min(caption.fromFrame, draft.scenes[sceneIndex].durationFrames - 1));
    caption.toFrame = Math.max(caption.fromFrame + 1, Math.min(caption.toFrame, draft.scenes[sceneIndex].durationFrames));
  });

  const deleteCaption = (index: number) => updateProject((draft) => {draft.scenes[sceneIndex].captions.splice(index, 1);});

  const startRender = async () => {
    await save();
    const response = await fetch('/api/render', {method: 'POST'});
    const body = await response.json(); setRender(response.ok ? body : {status: 'failed', error: body.error});
  };

  const startQuality = async () => {
    setQuality({status: 'running'});
    const response = await fetch('/api/quality', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id: render.id})});
    const body = await response.json();
    setQuality(response.ok ? {status: 'done', report: body.report} : {status: 'error', error: body.error});
  };

  const startBatch = async () => {
    try {
      const variants = JSON.parse(batchText);
      if (!Array.isArray(variants)) throw new Error('批量变量必须是 JSON 数组');
      await save();
      const response = await fetch('/api/render/batch', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({variants})});
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? '批量任务创建失败');
      setNotice(`已加入 ${body.jobs.length} 个批量渲染任务`); await refreshWorkspace();
    } catch (error) { setNotice(error instanceof Error ? error.message : '批量变量格式错误'); }
  };

  const retryJob = async (id: string) => {await fetch(`/api/jobs/${id}/retry`, {method: 'POST'}); await refreshWorkspace();};
  const cancelJob = async (id: string) => {await fetch(`/api/jobs/${id}/cancel`, {method: 'POST'}); await refreshWorkspace();};

  const runComfyWorkflowFile = async (file: File) => {
    try {
      const workflow = JSON.parse(await file.text()); const response = await fetch('/api/adapters/comfyui/generate', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({workflow})}); const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'ComfyUI 任务创建失败');
      setNotice('ComfyUI 工作流已加入任务队列'); await refreshWorkspace();
    } catch (error) {setNotice(error instanceof Error ? error.message : 'ComfyUI workflow JSON 无效');}
  };

  const planStory = async () => {
    const response = await fetch('/api/storyboards/plan', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(storyForm)}); const body = await response.json();
    if (!response.ok) return setNotice(body.error ?? '文案规划失败'); setStoryboardPreview(body.storyboard); setBriefUrl(null);
  };

  const createStoryDraft = async () => {
    const response = await fetch('/api/storyboards/create', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(storyForm)}); const body = await response.json();
    if (!response.ok) return setNotice(body.error ?? '草稿创建失败');
    const parsed = projectSchema.parse(body.project); setProject(parsed); setPast([]); setFuture([]); setSceneIndex(0); setLayerId(parsed.scenes[0]?.layers[0]?.id ?? null); setSaveState('saved'); setStoryboardPreview(body.storyboard); setBriefUrl(body.brief); await refreshWorkspace(); setNotice(`已创建 ${parsed.scenes.length} 镜头草稿`);
  };

  const moveStart = (event: React.PointerEvent<HTMLImageElement>, item: Layer) => {
    if (!project || item.role === 'background') return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    checkpoint(project); setLayerId(item.id);
    dragRef.current = {id: item.id, clientX: event.clientX, clientY: event.clientY, x: item.x, y: item.y};
  };

  const move = (event: React.PointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    const canvas = event.currentTarget.closest('.layout-canvas')?.getBoundingClientRect();
    if (!drag || !canvas || !project) return;
    const x = Math.round(drag.x + (event.clientX - drag.clientX) * project.width / canvas.width);
    const y = Math.round(drag.y + (event.clientY - drag.clientY) * project.height / canvas.height);
    updateProject((draft) => Object.assign(draft.scenes[sceneIndex].layers.find((item) => item.id === drag.id)!, {x, y}), false);
  };

  const moveEnd = () => {dragRef.current = null;};

  if (!project || !scene) return <main className="loading"><div className="brand-mark">纸</div><p>{notice || '正在打开工作台…'}</p></main>;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">纸</div><div><strong>PaperCut Studio</strong><small>分层纸片动画工作台 · 本地优先</small></div></div>
      <div className="actions">
        <button className="icon-action" disabled={!past.length} onClick={undo} title="撤销 (⌘Z)">↶</button><button className="icon-action" disabled={!future.length} onClick={redo} title="重做 (⇧⌘Z)">↷</button>
        <span className={`save-state ${saveState}`}>{saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : saveState === 'error' ? '保存失败' : '有未保存改动'}</span>
        <button className="planner-button" onClick={() => setPlannerOpen(true)}>文案成片</button><button className="review-button" onClick={() => {setReviewOpen(true);setReviewSelection(project.production?.assetPlan.filter((item) => item.status === 'assigned' || item.status === 'ready').map((item) => item.id) ?? []);}}>素材审核</button><label className="import-button">导入 JSON<input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && importJson(event.target.files[0])}/></label>
        <label className="import-button">导入项目包<input type="file" accept="application/zip,.zip" onChange={(event) => event.target.files?.[0] && importPackage(event.target.files[0])}/></label>
        <button className="ghost" onClick={exportPackage}>打包项目</button><button className="ghost" onClick={exportJson}>导出 JSON</button><button className="ghost" onClick={save}>保存项目</button>
        <button className="primary" disabled={render.status === 'rendering' || render.status === 'queued'} onClick={startRender}>渲染 MP4</button>
      </div>
    </header>

    <aside className="scene-panel panel">
      <div className="workspace-picker"><label>当前项目<select value={project.id} onChange={(event) => switchProject(event.target.value)}>{projectList.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><div><select value={selectedTemplate} onChange={(event) => setSelectedTemplate(event.target.value)}>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button onClick={createProject}>从模板新建</button></div></div>
      <div className="panel-title"><span>镜头</span><em>{project.scenes.length}</em></div>
      {project.scenes.map((item, index) => <button key={item.id} className={`scene-card ${index === sceneIndex ? 'active' : ''}`} onClick={() => selectScene(index)}><span className="scene-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{item.name}</strong><small>{(item.durationFrames / project.fps).toFixed(1)} 秒 · {item.layers.length} 图层</small></div></button>)}
      <div className="scene-actions"><button onClick={duplicateScene}>＋ 新镜头</button><button onClick={deleteScene} disabled={project.scenes.length <= 1}>删除</button></div>
      <div className="method-card"><span>方法论检查</span><b>背景 → 后排 → 主体 → 前景</b><small>图层错峰入场，叙事权重决定运动幅度。</small></div>
      <div className="adapter-card"><span>素材适配器</span>{adapters.map((adapter) => <div key={adapter.id}><i className={adapter.configured ? 'ready' : ''}/><b>{adapter.name}</b>{adapter.id === 'comfyui' && adapter.configured ? <label className="workflow-upload">运行<input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && runComfyWorkflowFile(event.target.files[0])}/></label> : <small>{adapter.transport}{adapter.configured ? ' · 可用' : ' · 未配置'}</small>}</div>)}</div>
      <div className="batch-card"><span>批量变量</span><small>在标题或字幕中使用 <code>{'{{城市}}'}</code></small><textarea value={batchText} onChange={(event) => setBatchText(event.target.value)}/><button onClick={startBatch}>加入批量渲染队列</button></div>
      <div className="jobs-card"><span>最近任务</span>{jobs.slice(0, 6).map((job) => <div key={job.id} className={job.status}><i/><section><b>{job.variant || job.type}</b><small>{job.status} · {Math.round((job.progress ?? 0) * 100)}%</small></section>{job.output ? <a href={job.output}>MP4</a> : job.assets?.length ? <button onClick={() => setProcessedAssets(job.assets!)}>{job.assets.length} 素材</button> : ['failed','interrupted'].includes(job.status) ? <button onClick={() => retryJob(job.id)}>重试</button> : ['queued','running','cancel_requested'].includes(job.status) ? <button onClick={() => cancelJob(job.id)}>取消</button> : null}</div>)}</div>
    </aside>

    <main className="canvas-area">
      <div className="canvas-meta"><span>{project.width} × {project.height}</span><strong>{scene.name}</strong><div className="mode-switch"><button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>动画预览</button><button className={mode === 'layout' ? 'active' : ''} onClick={() => setMode('layout')}>拖拽排版</button></div></div>
      <div className="player-frame">
        {mode === 'preview' ? <Player component={PaperVideo} inputProps={{project}} durationInFrames={duration} compositionWidth={project.width} compositionHeight={project.height} fps={project.fps} controls loop style={{width: '100%', aspectRatio: `${project.width}/${project.height}`}}/> : <LayoutCanvas project={project} scene={scene} selectedId={layerId} onSelect={setLayerId} onMoveStart={moveStart} onMove={move} onMoveEnd={moveEnd}/>} 
      </div>
      <div className="timeline"><div className="timeline-ruler"><span>图层节奏与关键帧</span><span>{(scene.durationFrames / project.fps).toFixed(1)}s</span></div>{scene.layers.slice().sort((a, b) => b.zIndex - a.zIndex).map((item) => <button key={item.id} className={`track ${item.id === layerId ? 'active' : ''}`} onClick={() => setLayerId(item.id)}><span>{item.name}</span><i className="track-bar" style={{marginLeft: `${Math.min(70, item.delayFrames / scene.durationFrames * 100)}%`, width: `${Math.max(18, 94 - item.delayFrames / scene.durationFrames * 100)}%`}}>{(item.keyframes ?? []).map((keyframe) => <b key={keyframe.frame} title={`${keyframe.frame} 帧`} style={{left:`${keyframe.frame / scene.durationFrames * 100}%`}}/>)}</i><em>{item.role}</em></button>)}<div className="caption-lane"><span>字幕</span><div>{scene.captions.map((caption, index) => <i key={`${caption.text}-${index}`} title={caption.text} style={{left: `${caption.fromFrame / scene.durationFrames * 100}%`, width: `${(caption.toFrame - caption.fromFrame) / scene.durationFrames * 100}%`}}>{index + 1}</i>)}</div></div></div>
    </main>

    <aside className="inspector panel">
      <div className="panel-title"><span>镜头与图层</span><em>{layer?.role ?? '—'}</em></div>
      <div className="scene-fields"><label className="field wide"><span>镜头名称</span><input value={scene.name} onChange={(event) => updateProject((draft) => {draft.scenes[sceneIndex].name = event.target.value;})}/></label><NumberField label="镜头帧数" value={scene.durationFrames} onChange={(durationFrames) => updateProject((draft) => {draft.scenes[sceneIndex].durationFrames = Math.max(1, durationFrames);})}/><div className="audio-actions"><label>上传旁白并匹配时长<input type="file" accept="audio/*" onChange={(event) => event.target.files?.[0] && uploadAudio(event.target.files[0], 'narration')}/></label><label>上传背景音乐<input type="file" accept="audio/*" onChange={(event) => event.target.files?.[0] && uploadAudio(event.target.files[0], 'soundtrack')}/></label></div><button className="rhythm-action" onClick={retimeNarration}>按全部旁白重排镜头节奏</button>{scene.narrationSrc && <div className="audio-preview"><span>旁白 · {(scene.durationFrames / project.fps).toFixed(2)}s</span>{waveformSrc && <img className="waveform" src={assetUrl(waveformSrc)} alt="旁白波形"/>}<audio src={assetUrl(scene.narrationSrc)} controls/>{asrState.configured && <button className="asr-action" onClick={transcribeNarration}>本地 ASR 转写并生成逐字字幕</button>}<button onClick={() => updateProject((draft) => {delete draft.scenes[sceneIndex].narrationSrc;})}>移除</button></div>}</div>
      <section className="caption-editor"><div className="section-title"><span>字幕时间轴</span><button onClick={addCaption}>＋ 添加</button></div>{scene.captions.map((caption, index) => <div className="caption-item" key={index}><div><b>{index + 1}</b><input value={caption.text} onChange={(event) => updateCaption(index, {text: event.target.value})}/><button onClick={() => deleteCaption(index)}>×</button></div><div className="caption-ranges"><label>入<input type="range" min="0" max={Math.max(1, scene.durationFrames - 1)} value={caption.fromFrame} onChange={(event) => updateCaption(index, {fromFrame: Number(event.target.value)})}/><em>{caption.fromFrame}f</em></label><label>出<input type="range" min="1" max={scene.durationFrames} value={caption.toFrame} onChange={(event) => updateCaption(index, {toFrame: Number(event.target.value)})}/><em>{caption.toFrame}f</em></label></div></div>)}</section>
      {layer ? <>
        <label className="field wide"><span>图层名称</span><input value={layer.name} onChange={(event) => updateLayer({name: event.target.value})}/></label>
        {layer.kind === 'text'
          ? <div className="asset-preview"><div><small>文字图层 · {layer.style?.fontSize}px{layer.style?.mono ? ' · 等宽' : ''}</small><code>{layer.style?.text.slice(0, 60)}</code></div></div>
          : <>
            <div className="asset-preview"><img src={assetUrl(layer.src ?? '')} alt="当前图层"/><div><small>素材路径</small><code>{layer.src}</code></div></div>
            <label className="upload">替换透明 PNG / SVG<input type="file" accept="image/png,image/webp,image/svg+xml" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])}/></label>
          </>}
        {plannedAsset && <><section className="prompt-history"><div className="section-title"><span>素材提示词 · {plannedAsset.status}</span><em>{plannedAsset.promptVersions.length} 版</em></div><textarea value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)}/><button onClick={savePromptVersion}>保存为新版本</button><div>{plannedAsset.promptVersions.map((version) => <button key={version.id} className={version.id === plannedAsset.activePromptVersion ? 'active' : ''} onClick={() => activatePrompt(version.id)} title={version.note}>{version.id}</button>)}</div></section><section className="trace-editor"><div className="section-title"><span>生成来源溯源</span><em>{plannedAsset.generation ? '已记录' : '待记录'}</em></div><div><input value={traceDraft.provider} onChange={(event) => setTraceDraft({...traceDraft,provider:event.target.value})} placeholder="供应器"/><input value={traceDraft.model} onChange={(event) => setTraceDraft({...traceDraft,model:event.target.value})} placeholder="模型"/><input value={traceDraft.seed} onChange={(event) => setTraceDraft({...traceDraft,seed:event.target.value})} placeholder="Seed"/></div><textarea value={traceDraft.parameters} onChange={(event) => setTraceDraft({...traceDraft,parameters:event.target.value})}/><button onClick={saveGenerationTrace}>保存来源与参数</button></section></>}
        <section className="asset-tools"><div className="section-title"><span>素材处理</span><button onClick={inspectAsset}>检查</button></div>{assetInspection && <div className={`inspection ${assetInspection.touchesEdge ? 'warn' : ''}`}><b>{assetInspection.width}×{assetInspection.height}</b><span>{assetInspection.hasTransparency ? '透明通道 ✓' : '无透明通道'}</span><span>{assetInspection.touchesEdge ? '内容贴边，可能被裁切' : '边缘留白正常'}</span></div>}<div className="key-controls"><label>背景色<input type="color" value={keyColor} onChange={(event) => setKeyColor(event.target.value)}/></label><label>容差<input type="range" min="0" max="40" value={keyFuzz} onChange={(event) => setKeyFuzz(Number(event.target.value))}/><em>{keyFuzz}%</em></label><label className="preserve"><input type="checkbox" checked={preserveCanvas} onChange={(event) => setPreserveCanvas(event.target.checked)}/>保留画布，适合先抠图再拆素材表</label><button onClick={keyAsset}>移除纯色背景</button></div><div className="split-controls"><label>行<input type="number" min="1" max="12" value={grid.rows} onChange={(event) => setGrid({...grid, rows: Number(event.target.value)})}/></label><label>列<input type="number" min="1" max="12" value={grid.columns} onChange={(event) => setGrid({...grid, columns: Number(event.target.value)})}/></label><button onClick={splitAsset}>拆分素材表</button></div>{processedAssets.length > 0 && <><button className="auto-match" onClick={autoMatchAssets}>自动匹配这一批素材到计划图层</button><div className="processed-assets">{processedAssets.map((item) => <button key={item.path} onClick={() => {updateLayer({src: item.path}); setAssetInspection(item.inspection);}} title={item.path}><img src={assetUrl(item.path)} alt="处理后的素材"/><span>{item.inspection.width}×{item.inspection.height}</span></button>)}</div></>}</section>
        <div className="layer-actions"><button onClick={duplicateLayer}>复制</button><button onClick={() => updateLayer({zIndex: layer.zIndex + 1})}>上移一层</button><button onClick={() => updateLayer({zIndex: layer.zIndex - 1})}>下移一层</button><button className="danger" onClick={deleteLayer}>删除</button></div>
        <div className="field-grid"><NumberField label="X" value={layer.x} onChange={(x) => updateLayer({x})}/><NumberField label="Y" value={layer.y} onChange={(y) => updateLayer({y})}/><NumberField label="宽度" value={layer.width} onChange={(width) => updateLayer({width})}/><NumberField label="层级" value={layer.zIndex} onChange={(zIndex) => updateLayer({zIndex})}/><NumberField label="旋转" value={layer.rotation} onChange={(rotation) => updateLayer({rotation})} step={0.5}/><NumberField label="延迟帧" value={layer.delayFrames} onChange={(delayFrames) => updateLayer({delayFrames})}/></div>
        <section className="keyframe-editor"><div className="section-title"><span>关键帧动画</span><em>{layer.keyframes?.length ?? 0}</em></div><div className="keyframe-add"><input type="range" min="0" max={Math.max(0,scene.durationFrames-1)} value={keyframeFrame} onChange={(event) => setKeyframeFrame(Number(event.target.value))}/><input type="number" min="0" max={scene.durationFrames-1} value={keyframeFrame} onChange={(event) => setKeyframeFrame(Number(event.target.value))}/><button onClick={upsertKeyframe}>记录当前姿态</button></div>{(layer.keyframes ?? []).map((keyframe) => <div className="keyframe-item" key={keyframe.frame}><button onClick={() => setKeyframeFrame(keyframe.frame)}>{keyframe.frame}f</button><select value={keyframe.easing} onChange={(event) => updateKeyframe(keyframe.frame,{easing:event.target.value as typeof keyframe.easing})}><option value="linear">线性</option><option value="ease-in">渐入</option><option value="ease-out">渐出</option><option value="ease-in-out">平滑</option></select><button onClick={() => deleteKeyframe(keyframe.frame)}>×</button></div>)}</section>
        <label className="field wide"><span>角色权重</span><select value={layer.role} onChange={(event) => updateLayer({role: event.target.value as Layer['role']})}><option value="background">背景</option><option value="tertiary">后排</option><option value="secondary">配角</option><option value="primary">主角</option><option value="foreground">前景</option></select></label>
        <label className="field wide"><span>入场方向</span><select value={layer.entrance} onChange={(event) => updateLayer({entrance: event.target.value as Layer['entrance']})}><option value="none">无</option><option value="left">左侧</option><option value="right">右侧</option><option value="up">上方</option><option value="down">下方</option><option value="scale">缩放</option><option value="fade">淡入</option></select></label>
        <label className="check"><input type="checkbox" checked={layer.paperEdge} onChange={(event) => updateLayer({paperEdge: event.target.checked})}/>纸片白边与落影</label>
      </> : <p>选择一个图层开始编辑。</p>}
      {render.status !== 'idle' && <div className={`render-card ${render.status}`}><strong>{render.status === 'done' ? '渲染完成' : render.status === 'failed' ? '渲染失败' : '正在渲染'}</strong><progress max="1" value={render.progress ?? 0}/><small>{render.error ?? (render.progress ? `${Math.round(render.progress * 100)}%` : '正在准备浏览器…')}</small>{render.output && <a href={render.output}>打开 MP4</a>}{render.status === 'done' && <button onClick={startQuality} disabled={quality.status === 'running'}>{quality.status === 'running' ? '正在验收…' : '生成验收报告'}</button>}{quality.report && <a href={quality.report}>打开验收报告</a>}{quality.error && <small>{quality.error}</small>}</div>}
      {notice && <button className="notice" onClick={() => setNotice('')}>{notice}<span>×</span></button>}
    </aside>
    {plannerOpen && <div className="planner-overlay"><div className="planner-modal"><header><div><b>文案成片策划台</b><small>先生成可编辑草稿，再逐层替换正式素材</small></div><button onClick={() => setPlannerOpen(false)}>×</button></header><main><section className="planner-form"><label>项目标题<input value={storyForm.title} onChange={(event) => setStoryForm({...storyForm, title: event.target.value})}/></label><label>口播文案<textarea value={storyForm.text} onChange={(event) => setStoryForm({...storyForm, text: event.target.value})}/></label><label>分镜规划器<select value={storyForm.planner} onChange={(event) => setStoryForm({...storyForm,planner:event.target.value})}>{planners.map((planner) => <option key={planner.id} value={planner.id} disabled={!planner.configured}>{planner.name}{planner.configured?'':' · 未配置'}</option>)}</select></label><div><label>视觉风格<select value={storyForm.styleId} onChange={(event) => setStoryForm({...storyForm, styleId: event.target.value})}>{styles.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}</select></label><label>画幅<select value={storyForm.aspect} onChange={(event) => setStoryForm({...storyForm, aspect: event.target.value})}><option value="16:9">横屏 16:9</option><option value="9:16">竖屏 9:16</option></select></label></div><label>角色一致性设定<textarea className="characters" value={storyForm.characterBible} onChange={(event) => setStoryForm({...storyForm, characterBible: event.target.value})} placeholder="每行一个角色：李白：白袍，束发，三十岁"/></label><button className="plan-action" onClick={planStory}>分析文案并生成分镜</button></section><section className="story-preview">{storyboardPreview ? <><div className="preview-summary"><b>{storyboardPreview.scenes.length} 个镜头</b><span>{(storyboardPreview.totalFrames / storyboardPreview.fps).toFixed(1)} 秒</span></div>{storyboardPreview.scenes.map((item, index) => <article key={item.id}><em>{String(index + 1).padStart(2, '0')}</em><div><b>{item.title} · {item.shotType}</b><p>{item.narration}</p><small>{item.purpose} · {(item.durationFrames / storyboardPreview.fps).toFixed(1)}s</small><details><summary>{item.assets.length} 项素材需求</summary>{item.assets.map((asset) => <div key={asset.name}><strong>{asset.role} · {asset.name}</strong><p>{asset.prompt}</p></div>)}</details></div></article>)}<footer><button onClick={createStoryDraft}>一键组装可编辑草稿</button>{briefUrl && <a href={briefUrl}>下载素材需求单</a>}</footer></> : <div className="empty-plan"><span>镜</span><b>等待分析文案</b><small>系统将生成镜头、时长、字幕、五层素材清单和一致性提示词。</small></div>}</section></main></div></div>}
    {reviewOpen && <div className="review-overlay"><div className="review-modal"><header><div><b>素材审核看板</b><small>{project.production?.assetPlan.filter((item) => item.status === 'approved').length ?? 0} 已批准 · {project.production?.assetPlan.length ?? 0} 总计</small></div><button onClick={() => setReviewOpen(false)}>×</button></header><main>{(project.production?.assetPlan ?? []).map((asset: PlannedAsset) => <article key={asset.id} className={asset.status}><label><input type="checkbox" checked={reviewSelection.includes(asset.id)} onChange={() => setReviewSelection((items) => items.includes(asset.id) ? items.filter((id) => id !== asset.id) : [...items,asset.id])}/><span>{asset.sceneId}</span></label><div className="review-thumb">{asset.src ? <img src={assetUrl(asset.src)} alt={asset.name}/> : <em>待<br/>素材</em>}</div><section><b>{asset.name}</b><small>{asset.role} · {asset.status}</small><p>{asset.prompt}</p>{asset.generation && <code>{asset.generation.provider} / {asset.generation.model} / seed {String(asset.generation.seed ?? '—')}</code>}</section></article>)}</main><footer><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="审核备注：构图、朝向、裁切或角色一致性问题"/><button className="reject" onClick={() => reviewSelected('rejected')}>退回重做</button><button className="approve" onClick={() => reviewSelected('approved')}>批量批准</button></footer></div></div>}
  </div>;
};
