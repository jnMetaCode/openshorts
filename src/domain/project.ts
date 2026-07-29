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

export const layerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  src: z.string().min(1),
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
});

export const captionSchema = z.object({
  text: z.string(),
  fromFrame: z.number().int().nonnegative(),
  toFrame: z.number().int().positive(),
  words: z.array(z.object({text:z.string(),fromFrame:z.number().int().nonnegative(),toFrame:z.number().int().positive()})).default([]),
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
    generation: z.object({provider:z.string(),model:z.string(),seed:z.union([z.string(),z.number()]).optional(),workflowId:z.string().optional(),parameters:z.record(z.string(),z.unknown()).default({}),createdAt:z.string()}).optional(),
    reviewHistory: z.array(z.object({status:z.enum(['approved','rejected']),note:z.string().default(''),createdAt:z.string()})).default([]),
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

export type Layer = z.infer<typeof layerSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type PaperProject = z.infer<typeof projectSchema>;
export type PlannedAsset = NonNullable<PaperProject['production']>['assetPlan'][number];

export const getProjectDuration = (project: PaperProject) =>
  project.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0);

export const getSceneStart = (project: PaperProject, sceneIndex: number) =>
  project.scenes.slice(0, sceneIndex).reduce((sum, scene) => sum + scene.durationFrames, 0);
