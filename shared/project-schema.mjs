// PaperCut v1 项目协议的唯一定义。
// 浏览器编辑器、Remotion 渲染器、Express 服务端和 CLI 校验全部从这里读同一份 schema——
// 以前 TS 里的 Zod、服务端的两行手检和 CLI 的手写规则是三套各说各话的标准。
import {z} from 'zod';

export const roleSchema = z.enum(['background', 'tertiary', 'secondary', 'primary', 'foreground']);
export const entranceSchema = z.enum(['none', 'left', 'right', 'up', 'down', 'scale', 'fade']);
export const easingSchema = z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']);

export const keyframeSchema = z.object({
  frame: z.number().int().nonnegative(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  rotation: z.number(),
  opacity: z.number().min(0).max(1),
  easing: easingSchema.default('ease-in-out'),
});

// 技术讲解的核心需求是「说到某个数字/术语时，它出现在屏幕上」。
// 图层原来只能是图片，所以想让「$10」上屏就得去画一个金币 SVG——慢，而且信息量低。
// kind:'text' 让文字成为一等图层；等宽 + 逐行显现就能表达代码与终端。
export const textStyleSchema = z.object({
  text: z.string().min(1),
  fontSize: z.number().positive().default(96),
  fontWeight: z.number().int().min(100).max(900).default(700),
  color: z.string().optional(),                                   // 省略则用 theme.paper
  align: z.enum(['left', 'center', 'right']).default('left'),
  mono: z.boolean().default(false),                               // 代码与终端
  lineHeight: z.number().positive().default(1.28),
  letterSpacing: z.number().default(0),
  background: z.string().optional(),                              // 卡片底色，便于压在画面上
  padding: z.number().nonnegative().default(0),
  // 逐行显现：每行间隔多少帧出现。0 表示整块一起出现。
  revealFrames: z.number().nonnegative().default(0),
});

export const layerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['image', 'text', 'video']).default('image'),
  // 视频图层：评论/解说时引用真实画面。startFrom 为从源视频第几秒开始播，静音（旁白与配乐来自母带）。
  startFrom: z.number().nonnegative().default(0),
  src: z.string().min(1).optional(),
  style: textStyleSchema.optional(),
  role: roleSchema,
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  zIndex: z.number().int(),
  delayFrames: z.number().int().nonnegative().default(0),
  entrance: entranceSchema.default('left'),
  flipX: z.boolean().default(false),
  paperEdge: z.boolean().default(true),
  assetPlanId: z.string().optional(),
  keyframes: z.array(keyframeSchema).default([]),
}).refine(
  (layer) => layer.kind === 'text' ? Boolean(layer.style) : Boolean(layer.src),
  {message: '图片/视频图层必须有 src，文字图层必须有 style'},
);

export const isTextLayer = (layer) => layer?.kind === 'text';

export const captionSchema = z.object({
  text: z.string(),
  fromFrame: z.number().int().nonnegative(),
  toFrame: z.number().int().positive(),
  words: z.array(z.object({text: z.string(), fromFrame: z.number().int().nonnegative(), toFrame: z.number().int().positive()})).default([]),
}).refine((item) => item.toFrame > item.fromFrame, '字幕结束帧必须大于开始帧');

export const audioCueSchema = z.object({
  src: z.string().min(1),
  fromFrame: z.number().int().nonnegative().default(0),
  volume: z.number().min(0).max(2).default(1),
});

export const sceneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  durationFrames: z.number().int().positive(),
  backgroundColor: z.string().default('#d9c8a4'),
  cameraZoom: z.number().min(1).max(1.3).default(1.02),
  layers: z.array(layerSchema).min(1),
  captions: z.array(captionSchema).default([]),
  narrationSrc: z.string().optional(),
  audioCues: z.array(audioCueSchema).default([]),
});

export const productionSchema = z.object({
  plannerVersion: z.number().int().positive(),
  sourceText: z.string(),
  style: z.record(z.string(), z.unknown()),
  characters: z.array(z.object({id: z.string(), name: z.string(), description: z.string()})),
  assetPlan: z.array(z.object({
    id: z.string(), role: roleSchema, name: z.string(), prompt: z.string(), requirements: z.array(z.string()),
    sceneId: z.string().optional(), status: z.enum(['planned', 'ready', 'assigned', 'approved', 'rejected']).default('planned'), src: z.string().optional(),
    promptVersions: z.array(z.object({id: z.string(), prompt: z.string(), note: z.string().default(''), createdAt: z.string()})).default([]),
    activePromptVersion: z.string().optional(),
    generation: z.object({provider: z.string(), model: z.string(), seed: z.union([z.string(), z.number()]).optional(), workflowId: z.string().optional(), parameters: z.record(z.string(), z.unknown()).default({}), createdAt: z.string()}).optional(),
    reviewHistory: z.array(z.object({status: z.enum(['approved', 'rejected']), note: z.string().default(''), createdAt: z.string()})).default([]),
  })),
}).passthrough();

export const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().min(12).max(60),
  theme: z.object({
    paper: z.string(),
    ink: z.string(),
    accent: z.string(),
    subtitleBackground: z.string(),
  }),
  soundtrackSrc: z.string().optional(),
  soundtrackVolume: z.number().min(0).max(2).default(0.18),
  production: productionSchema.optional(),
  scenes: z.array(sceneSchema).min(1),
});

export const getProjectDuration = (project) =>
  project.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0);

export const getSceneStart = (project, sceneIndex) =>
  project.scenes.slice(0, sceneIndex).reduce((sum, scene) => sum + scene.durationFrames, 0);

/** Zod 报错转成人能读的中文列表，服务端和 CLI 共用同一套措辞。 */
export const formatIssues = (error) => error.issues.map((issue) => {
  const where = issue.path.length ? issue.path.join('.') : '(根)';
  return `${where}：${issue.message}`;
});

/**
 * 校验并归一化项目（补齐 default）。
 *
 * 这里只查「结构完整性」——工程存进来就必须成立、且无法自动修复的规则。
 * 时间轴越界（关键帧/字幕超出镜头时长）不在这里拦：编辑器里缩短镜头是常规操作，
 * 存盘时报 400 会挡住用户。那类问题归 `scripts/lib/quality.mjs` 在验收阶段报告。
 * @returns {{ok: true, project: object} | {ok: false, errors: string[]}}
 */
export const parseProject = (value) => {
  const parsed = projectSchema.safeParse(value);
  if (!parsed.success) return {ok: false, errors: formatIssues(parsed.error)};
  const project = parsed.data;
  const errors = [];
  const layerIds = new Set();
  const sceneIds = new Set();
  for (const scene of project.scenes) {
    if (sceneIds.has(scene.id)) errors.push(`镜头 id 重复：${scene.id}`);
    sceneIds.add(scene.id);
    for (const layer of scene.layers) {
      if (layerIds.has(layer.id)) errors.push(`图层 id 重复：${layer.id}`);
      layerIds.add(layer.id);
    }
  }
  return errors.length ? {ok: false, errors} : {ok: true, project};
};
