import cors from 'cors';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {inspectImage, removeColor, splitSheet} from '../scripts/lib/assets.mjs';
import {ProjectStore, applyVariables, safeId} from './lib/project-store.mjs';
import {PersistentJobQueue} from './lib/job-queue.mjs';
import {exportProjectBundle, importProjectBundle} from '../scripts/lib/project-package.mjs';
import {runComfyWorkflow} from './lib/comfyui.mjs';
import {extractComfyTrace, isReproducible} from '../shared/comfy-trace.mjs';
import {createDraftProject, listStylePresets, storyboardMarkdown} from '../shared/storyboard.mjs';
import {activatePromptVersion, addPromptVersion, applyAssetMatches} from '../shared/production.mjs';
import {listPlanners, planStoryboard} from './lib/planner.mjs';
import {attachGenerationTrace, retimeProjectFromNarration, retimeScene, reviewAssets} from '../shared/review.mjs';
import {runAsr, transcriptToCaptions} from './lib/asr.mjs';
import {corsOptions, createOriginGuard, createActionGuard, resolveAllowedOrigins} from './lib/origin-guard.mjs';
import {renderWaveform} from '../scripts/lib/audio.mjs';
import {kaipian} from './kaipian.mjs';
import { installProxy } from '../src/net/proxy.mjs';
installProxy();   // Node 的 fetch 不认 HTTPS_PROXY，不装的话代理后的机器所有联网功能都会 ECONNRESET

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectsDir = path.join(root, 'projects');
const templatesDir = path.join(root, 'templates');
const dataDir = path.join(root, 'data');
const uploadsDir = path.join(root, 'public', 'uploads');
const publicDir = path.join(root, 'public');
const adaptersDir = path.join(root, 'adapters');
const outDir = path.join(root, 'out');
const app = express();
const run = promisify(execFile);
const projectStore = new ProjectStore({projectsDir, templatesDir});
const jobQueue = new PersistentJobQueue(path.join(dataDir, 'jobs.json'));
await projectStore.init();
await jobQueue.init();
let activeProjectId = (await projectStore.list())[0]?.id ?? 'tang-paper-demo';
let lastJobId = jobQueue.list()[0]?.id ?? null;
let queueProcessing = false;
const activeCancels = new Map();
const renderConcurrency = Math.max(1, Math.min(8, Number(process.env.OPENSHORTS_RENDER_CONCURRENCY ?? 1)));

await fs.mkdir(uploadsDir, {recursive: true});
await fs.mkdir(outDir, {recursive: true});

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_request, file, callback) => {
    const safe = file.originalname.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
    callback(null, `${Date.now()}-${safe || 'asset.png'}`);
  },
});
const imageUpload = multer({storage, limits: {fileSize: 20 * 1024 * 1024}, fileFilter: (_req, file, callback) => callback(null, ['image/png', 'image/webp', 'image/svg+xml'].includes(file.mimetype))});
const audioUpload = multer({storage, limits: {fileSize: 200 * 1024 * 1024}, fileFilter: (_req, file, callback) => callback(null, ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/ogg'].includes(file.mimetype))});
const bundleUpload = multer({dest: path.join(dataDir, 'imports'), limits: {fileSize: 500 * 1024 * 1024}, fileFilter: (_req, file, callback) => callback(null, file.originalname.endsWith('.zip') || file.mimetype.includes('zip'))});

const allowedOrigins = resolveAllowedOrigins({port: Number(process.env.PORT ?? 4174), configured: process.env.OPENSHORTS_ALLOWED_ORIGINS});
app.use(cors(corsOptions(allowedOrigins)));
app.use(createOriginGuard(allowedOrigins));
app.use(createActionGuard(allowedOrigins));   // SSE 接口只能是 GET，但它们会出片/下模型/花钱，同样得拦跨站
app.use(express.json({limit: '5mb'}));
app.use('/out', express.static(outDir));
app.use('/uploads', express.static(uploadsDir));

app.get('/api/health', (_req, res) => res.json({ok: true, product: 'OpenShorts', renderConcurrency}));
app.get('/api/project', async (_req, res, next) => {
  try { res.json(await projectStore.get(activeProjectId)); } catch (error) { next(error); }
});
app.put('/api/project', async (req, res, next) => {
  try {
    const saved = await projectStore.save(req.body); activeProjectId = saved.id;
    res.json({ok: true, project: saved});
  } catch (error) { next(error); }
});
app.get('/api/projects', async (_req, res, next) => { try { res.json(await projectStore.list()); } catch (error) { next(error); } });
app.get('/api/projects/:id', async (req, res, next) => { try { res.json(await projectStore.get(req.params.id)); } catch (error) { next(error); } });
app.put('/api/projects/:id', async (req, res, next) => {
  try { if (req.params.id !== req.body?.id) return res.status(400).json({error: 'URL 项目 ID 与项目内容不一致'}); res.json(await projectStore.save(req.body)); } catch (error) { next(error); }
});
app.post('/api/projects/:id/activate', async (req, res, next) => {
  try { await projectStore.get(req.params.id); activeProjectId = req.params.id; res.json({ok: true, id: activeProjectId}); } catch (error) { next(error); }
});
app.get('/api/templates', async (_req, res, next) => { try { res.json(await projectStore.templates()); } catch (error) { next(error); } });
app.post('/api/projects', async (req, res, next) => {
  try { const created = await projectStore.createFromTemplate(req.body ?? {}); activeProjectId = created.id; res.status(201).json(created); } catch (error) { next(error); }
});
app.post('/api/projects/:id/export', async (req, res, next) => {
  try {
    const project = await projectStore.get(req.params.id); const filename = `${project.id}.openshorts.zip`;
    const result = await exportProjectBundle({project, publicDir, output: path.join(outDir, 'exports', filename)});
    res.json({download: `/out/exports/${filename}`, assets: result.assets});
  } catch (error) { next(error); }
});
app.post('/api/projects/import', bundleUpload.single('bundle'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({error: '请选择 500MB 以内的 .zip 项目包'});
  try {
    const namespace = `import-${Date.now()}`;
    const imported = await importProjectBundle({archive: req.file.path, publicDir, namespace});
    const existing = new Set((await projectStore.list()).map((item) => item.id));
    if (existing.has(imported.project.id)) imported.project.id = `${imported.project.id}-${Date.now().toString(36)}`;
    const saved = await projectStore.save(imported.project); activeProjectId = saved.id;
    res.status(201).json({project: saved, assets: imported.assets});
  } catch (error) { next(error); }
  finally { await fs.rm(req.file.path, {force: true}); }
});
app.get('/api/storyboards/styles', (_req, res) => res.json(listStylePresets()));
app.get('/api/storyboards/planners', (_req, res) => res.json(listPlanners()));
app.post('/api/storyboards/plan', async (req, res, next) => {
  try { const storyboard = await planStoryboard(req.body ?? {}); res.json({storyboard, markdown: storyboardMarkdown(storyboard)}); } catch (error) { next(error); }
});
app.post('/api/storyboards/create', async (req, res, next) => {
  try {
    const storyboard = await planStoryboard(req.body ?? {}); const baseId = safeId(req.body?.id || storyboard.title, `story-${Date.now().toString(36)}`);
    const existing = new Set((await projectStore.list()).map((item) => item.id)); const id = existing.has(baseId) ? `${baseId}-${Date.now().toString(36)}` : baseId;
    const project = await projectStore.save(createDraftProject(storyboard, id)); activeProjectId = project.id;
    const briefName = `${project.id}-asset-brief.md`; await fs.mkdir(path.join(outDir, 'briefs'), {recursive: true}); await fs.writeFile(path.join(outDir, 'briefs', briefName), storyboardMarkdown(storyboard));
    res.status(201).json({project, storyboard, brief: `/out/briefs/${briefName}`});
  } catch (error) { next(error); }
});
app.post('/api/projects/:id/prompts/:assetId/versions', async (req, res, next) => {
  try {
    const project = await projectStore.get(req.params.id); const asset = project.production?.assetPlan?.find((item) => item.id === req.params.assetId);
    if (!asset) return res.status(404).json({error: '素材计划不存在'});
    Object.assign(asset, addPromptVersion(asset, req.body?.prompt, req.body?.note));
    res.status(201).json(await projectStore.save(project));
  } catch (error) { next(error); }
});
app.post('/api/projects/:id/prompts/:assetId/activate', async (req, res, next) => {
  try {
    const project = await projectStore.get(req.params.id); const asset = project.production?.assetPlan?.find((item) => item.id === req.params.assetId);
    if (!asset) return res.status(404).json({error: '素材计划不存在'});
    Object.assign(asset, activatePromptVersion(asset, req.body?.versionId));
    res.json(await projectStore.save(project));
  } catch (error) { next(error); }
});
app.post('/api/projects/:id/assets/auto-match', async (req, res, next) => {
  try {
    const result = applyAssetMatches(await projectStore.get(req.params.id), Array.isArray(req.body?.assets) ? req.body.assets : []);
    const project = await projectStore.save(result.project); if (activeProjectId === req.params.id) activeProjectId = project.id;
    res.json({project, matches: result.matches});
  } catch (error) { next(error); }
});
app.post('/api/projects/:id/assets/review', async (req, res, next) => {
  try { const result = reviewAssets(await projectStore.get(req.params.id), req.body ?? {}); res.json({project:await projectStore.save(result.project),updated:result.updated}); } catch (error) { next(error); }
});
app.post('/api/projects/:id/assets/:assetId/trace', async (req, res, next) => {
  try { res.json(await projectStore.save(attachGenerationTrace(await projectStore.get(req.params.id), req.params.assetId, req.body ?? {}))); } catch (error) { next(error); }
});
app.post('/api/assets', imageUpload.single('asset'), (req, res) => {
  if (!req.file) return res.status(400).json({error: '仅支持 20MB 以内的 PNG、WebP 或 SVG'});
  res.status(201).json({path: `uploads/${req.file.filename}`});
});
const resolvePublicAsset = (src) => {
  if (typeof src !== 'string' || /^(https?:|data:|blob:)/.test(src)) throw new Error('素材工具仅处理 public 目录中的本地文件');
  const target = path.resolve(publicDir, src.replace(/^\/+/, ''));
  if (!target.startsWith(`${publicDir}${path.sep}`)) throw new Error('素材路径超出 public 目录');
  return target;
};
const createWaveform = async (src) => {
  const input = resolvePublicAsset(src); const filename = `waveform-${path.parse(input).name.replace(/[^a-zA-Z0-9_-]/g,'-')}.png`; const output = path.join(uploadsDir,filename);
  await renderWaveform({input,output,run});
  return `uploads/${filename}`;
};
app.post('/api/assets/inspect', async (req, res, next) => {
  try { res.json(await inspectImage(resolvePublicAsset(req.body?.src))); } catch (error) { next(error); }
});
app.post('/api/assets/key', async (req, res, next) => {
  try {
    const filename = `keyed-${Date.now()}.png`;
    const inspection = await removeColor({input: resolvePublicAsset(req.body?.src), output: path.join(uploadsDir, filename), color: req.body?.color ?? '#00ff00', fuzz: Number(req.body?.fuzz ?? 12), trim: !req.body?.preserveCanvas});
    res.status(201).json({path: `uploads/${filename}`, inspection});
  } catch (error) { next(error); }
});
app.post('/api/assets/split', async (req, res, next) => {
  try {
    const batch = `split-${Date.now()}`;
    const prefix = String(req.body?.prefix ?? 'layer').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'layer';
    const results = await splitSheet({input: resolvePublicAsset(req.body?.src), outputDir: path.join(uploadsDir, batch), prefix, rows: Number(req.body?.rows ?? 1), columns: Number(req.body?.columns ?? 1)});
    res.status(201).json({assets: results.map((item) => ({path: `uploads/${batch}/${path.basename(item.file)}`, region: item.region, inspection: item.inspection}))});
  } catch (error) { next(error); }
});
app.post('/api/audio/waveform', async (req,res,next) => {try {res.json({path:await createWaveform(req.body?.src)});} catch(error){next(error);}});
app.get('/api/asr', (_req,res) => res.json({configured:Boolean(process.env.OPENSHORTS_ASR_COMMAND),command:process.env.OPENSHORTS_ASR_COMMAND ? path.basename(process.env.OPENSHORTS_ASR_COMMAND) : null}));
app.post('/api/projects/:id/scenes/:sceneId/transcribe', async (req,res,next) => {
  try {
    const project = await projectStore.get(req.params.id); const index = project.scenes.findIndex((item) => item.id === req.params.sceneId); if (index < 0) return res.status(404).json({error:'镜头不存在'});
    const scene = project.scenes[index]; if (!scene.narrationSrc) return res.status(409).json({error:'请先上传镜头旁白'});
    const transcript = await runAsr({audioPath:resolvePublicAsset(scene.narrationSrc)}); const durationFrames = Math.max(1,Math.ceil((transcript.duration+.2)*project.fps));
    project.scenes[index] = retimeScene(scene,durationFrames); project.scenes[index].captions = transcriptToCaptions(transcript,project.fps,durationFrames);
    res.json({project:await projectStore.save(project),transcript});
  } catch(error){next(error);}
});
app.post('/api/projects/:id/retime-narration', async (req, res, next) => {
  try {
    const project = await projectStore.get(req.params.id); const durations = {};
    for (const scene of project.scenes) {
      if (!scene.narrationSrc) continue;
      const {stdout} = await run('ffprobe', ['-v','error','-show_entries','format=duration','-of','json',resolvePublicAsset(scene.narrationSrc)]);
      durations[scene.id] = Number(JSON.parse(stdout).format?.duration ?? 0);
    }
    const result = retimeProjectFromNarration(project,durations,Number(req.body?.paddingSeconds ?? .2));
    if (!result.updated) return res.status(409).json({error:'项目中还没有旁白音频'});
    res.json({project:await projectStore.save(result.project),updated:result.updated,durations});
  } catch (error) { next(error); }
});
app.get('/api/adapters', async (_req, res, next) => {
  try {
    const entries = await fs.readdir(adaptersDir, {withFileTypes: true});
    const manifests = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = JSON.parse(await fs.readFile(path.join(adaptersDir, entry.name, 'adapter.json'), 'utf8'));
      manifests.push({...manifest, configured: (manifest.requiresEnv ?? []).every((name) => Boolean(process.env[name]))});
    }
    res.json(manifests);
  } catch (error) { next(error); }
});
app.post('/api/audio', audioUpload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({error: '仅支持 200MB 以内的 WAV、MP3、M4A、AAC、FLAC 或 OGG'});
    const {stdout} = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', req.file.path]);
    const durationSeconds = Number(JSON.parse(stdout).format?.duration ?? 0);
    const audioPath = `uploads/${req.file.filename}`; const waveform = await createWaveform(audioPath).catch(() => null);
    res.status(201).json({path: audioPath, durationSeconds, waveform});
  } catch (error) { next(error); }
});

const publicJob = (job) => {
  if (!job) return {status: 'idle', progress: 0};
  const {payload, ...rest} = job;
  return {...rest, projectId: payload?.projectId, variant: payload?.variant};
};

const runRender = async (job) => {
  try {
    await jobQueue.update(job.id, {status: 'running', progress: 0, attempts: job.attempts + 1});
    const [{bundle}, {renderMedia, selectComposition, makeCancelSignal}] = await Promise.all([
      import('@remotion/bundler'),
      import('@remotion/renderer'),
    ]);
    const project = job.payload.project;
    const chromeCandidates = [process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean);
    let browserExecutable = null; for (const candidate of chromeCandidates) {if (await fs.access(candidate).then(() => true).catch(() => false)) {browserExecutable=candidate;break;}}
    const bundled = await bundle({entryPoint: path.join(root, 'src', 'remotion', 'index.ts'), webpackOverride: (config) => config});
    const composition = await selectComposition({serveUrl: bundled, id: 'OpenShortsVideo', inputProps: {project}, browserExecutable});
    const filename = `${project.id}-${job.id.slice(0, 8)}.mp4`;
    let persistedProgress = 0;
    const cancellation = makeCancelSignal(); activeCancels.set(job.id, cancellation.cancel);
    await renderMedia({
      composition, serveUrl: bundled, codec: 'h264', outputLocation: path.join(outDir, filename), inputProps: {project}, browserExecutable, concurrency: renderConcurrency, cancelSignal: cancellation.cancelSignal,
      onProgress: ({progress}) => { job.progress = progress; if (progress - persistedProgress >= 0.1) { persistedProgress = progress; job.updatedAt = new Date().toISOString(); } },
    });
    await jobQueue.update(job.id, {status: 'done', progress: 1, output: `/out/${filename}`, error: null});
  } catch (error) {
    const cancelled = job.status === 'cancel_requested' || String(error).toLowerCase().includes('cancel');
    await jobQueue.update(job.id, cancelled ? {status: 'cancelled', error: null} : {status: 'failed', error: error instanceof Error ? error.message : String(error)});
  } finally { activeCancels.delete(job.id); }
};

const runComfyJob = async (job) => {
  try {
    await jobQueue.update(job.id, {status: 'running', progress: 0.05, attempts: job.attempts + 1});
    const controller = new AbortController(); activeCancels.set(job.id, () => controller.abort());
    const result = await runComfyWorkflow({endpoint: process.env.COMFYUI_URL, workflow: job.payload.workflow, signal: controller.signal, onPoll: ({polls}) => {job.progress = Math.min(0.9, 0.1 + polls * 0.04);}});
    // 溯源从工作流里解析出来跟着结果走，网页端放素材时就不用再手抄 model/seed。
    const trace = {...extractComfyTrace(job.payload.workflow), workflowId: result.promptId};
    const batch = `comfyui-${Date.now()}`; const assets = [];
    for (const [index, image] of result.images.entries()) {
      const safe = path.basename(image.filename).replace(/[^a-zA-Z0-9._-]/g, '-') || `image-${index + 1}.png`;
      const relative = `uploads/${batch}/${String(index + 1).padStart(2, '0')}-${safe}`; const target = path.join(publicDir, relative);
      await fs.mkdir(path.dirname(target), {recursive: true}); await fs.writeFile(target, image.data);
      assets.push({path: relative, inspection: await inspectImage(target), trace});
    }
    await jobQueue.update(job.id, {status: 'done', progress: 1, assets, trace, reproducible: isReproducible(trace), providerJobId: result.promptId, error: null});
  } catch (error) {
    const cancelled = job.status === 'cancel_requested' || String(error).toLowerCase().includes('取消') || String(error).toLowerCase().includes('abort');
    await jobQueue.update(job.id, cancelled ? {status: 'cancelled', error: null} : {status: 'failed', error: error instanceof Error ? error.message : String(error)});
  } finally { activeCancels.delete(job.id); }
};

const processQueue = async () => {
  if (queueProcessing) return;
  queueProcessing = true;
  try { let job; while ((job = jobQueue.next())) { lastJobId = job.id; if (job.type === 'comfyui-generate') await runComfyJob(job); else await runRender(job); } }
  finally { queueProcessing = false; }
};

app.post('/api/render', async (_req, res, next) => {
  try { const job = await jobQueue.add('render', {project: await projectStore.get(activeProjectId), projectId: activeProjectId}); lastJobId = job.id; void processQueue(); res.status(202).json(publicJob(job)); } catch (error) { next(error); }
});
app.post('/api/render/batch', async (req, res, next) => {
  try {
    const variants = Array.isArray(req.body?.variants) ? req.body.variants.slice(0, 20) : [];
    if (!variants.length) return res.status(400).json({error: '至少需要一个批量变量版本'});
    const source = await projectStore.get(activeProjectId); const jobs = [];
    for (const variant of variants) {
      const project = applyVariables(structuredClone(source), variant.variables ?? {});
      project.id = `${source.id}-${String(variant.name ?? jobs.length + 1).replace(/[^\w\u4e00-\u9fff-]/g, '-')}`;
      const job = await jobQueue.add('batch-render', {project, projectId: activeProjectId, variant: variant.name, variables: variant.variables ?? {}}); jobs.push(publicJob(job)); lastJobId = job.id;
    }
    void processQueue(); res.status(202).json({jobs});
  } catch (error) { next(error); }
});
app.get('/api/render/status', (req, res) => res.json(publicJob(jobQueue.get(req.query.id ?? lastJobId))));
app.get('/api/jobs', (_req, res) => res.json(jobQueue.list().map(publicJob)));
app.post('/api/jobs/:id/retry', async (req, res, next) => { try { const job = await jobQueue.retry(req.params.id); lastJobId = job.id; void processQueue(); res.status(202).json(publicJob(job)); } catch (error) { next(error); } });
app.post('/api/jobs/:id/cancel', async (req, res, next) => {
  try { const job = await jobQueue.cancel(req.params.id); activeCancels.get(job.id)?.(); res.status(202).json(publicJob(job)); } catch (error) { next(error); }
});
app.post('/api/adapters/comfyui/generate', async (req, res, next) => {
  try {
    if (!process.env.COMFYUI_URL) return res.status(409).json({error: '未设置 COMFYUI_URL'});
    if (!req.body?.workflow || typeof req.body.workflow !== 'object') return res.status(400).json({error: '请选择 ComfyUI API workflow JSON'});
    const job = await jobQueue.add('comfyui-generate', {workflow: req.body.workflow, projectId: activeProjectId}); lastJobId = job.id; void processQueue(); res.status(202).json(publicJob(job));
  } catch (error) { next(error); }
});
app.post('/api/quality', async (req, res, next) => {
  try {
    const job = jobQueue.get(req.body?.id ?? lastJobId);
    if (job?.status !== 'done' || !job.output) return res.status(409).json({error: '请先完成一次网页渲染'});
    const videoPath = path.join(outDir, path.basename(job.output));
    const qualityProject = path.join(dataDir, `quality-${job.id}.json`);
    await fs.writeFile(qualityProject, `${JSON.stringify(job.payload.project, null, 2)}\n`);
    const {stdout} = await run(process.execPath, [path.join(root, 'scripts', 'quality-report.mjs'), videoPath, qualityProject], {cwd: root, env: {...process.env, QUALITY_ALLOW_FAILURE: '1'}, maxBuffer: 10 * 1024 * 1024});
    res.json({ok: true, report: '/out/quality/report.md', json: '/out/quality/report.json', frames: '/out/quality/', log: stdout.trim()});
  } catch (error) { next(error); }
});

app.use('/api/kaipian', kaipian);
app.use(express.static(path.join(root, 'dist')));
app.get(/.*/, (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));

app.use((error, _req, res, _next) => res.status(error?.status ?? 500).json({
  error: error instanceof Error ? error.message : '服务器错误',
  ...(error?.errors ? {issues: error.errors} : {}),
}));

const port = Number(process.env.PORT ?? 4174); const host = process.env.HOST ?? '127.0.0.1';
const httpServer = app.listen(port, host, () => console.log(`OpenShorts API: http://${host}:${port}`));
httpServer.on('error',(error)=>{console.error(`OpenShorts 无法监听 ${host}:${port}：${error instanceof Error ? error.message : error}`);process.exitCode=1;});
void processQueue();
