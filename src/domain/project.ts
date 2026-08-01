// 协议定义在 shared/project-schema.mjs，浏览器、Remotion、服务端和 CLI 共用同一份。
// 这里只负责把它接进 TypeScript 并导出推导出来的类型。
import type {z} from 'zod';
import {
  audioCueSchema, captionSchema, easingSchema, entranceSchema, getProjectDuration, getSceneStart,
  keyframeSchema, layerSchema, parseProject, productionSchema, projectSchema, roleSchema, sceneSchema,
} from '../../shared/project-schema.mjs';

export {
  audioCueSchema, captionSchema, easingSchema, entranceSchema, getProjectDuration, getSceneStart,
  keyframeSchema, layerSchema, parseProject, productionSchema, projectSchema, roleSchema, sceneSchema,
};

export type Layer = z.infer<typeof layerSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type PaperProject = z.infer<typeof projectSchema>;
export type PlannedAsset = NonNullable<PaperProject['production']>['assetPlan'][number];
