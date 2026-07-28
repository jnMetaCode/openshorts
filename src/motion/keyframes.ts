import {Easing, interpolate} from 'remotion';
import type {Layer} from '../domain/project';

const easing = {
  linear: Easing.linear,
  'ease-in': Easing.in(Easing.cubic),
  'ease-out': Easing.out(Easing.cubic),
  'ease-in-out': Easing.inOut(Easing.cubic),
};

export type LayerPose = Pick<Layer, 'x' | 'y' | 'width' | 'rotation' | 'opacity'>;

export const resolveLayerPose = (layer: Layer, frame: number): LayerPose => {
  const frames = [...(layer.keyframes ?? [])].sort((a, b) => a.frame - b.frame);
  if (!frames.length) return {x: layer.x, y: layer.y, width: layer.width, rotation: layer.rotation, opacity: layer.opacity};
  const before = [...frames].reverse().find((item) => item.frame <= frame) ?? frames[0];
  const after = frames.find((item) => item.frame >= frame) ?? frames.at(-1)!;
  if (before.frame === after.frame) return {x: before.x, y: before.y, width: before.width, rotation: before.rotation, opacity: before.opacity};
  const options = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const, easing: easing[after.easing]};
  const value = (from: number, to: number) => interpolate(frame, [before.frame, after.frame], [from, to], options);
  return {x: value(before.x, after.x), y: value(before.y, after.y), width: value(before.width, after.width), rotation: value(before.rotation, after.rotation), opacity: value(before.opacity, after.opacity)};
};
