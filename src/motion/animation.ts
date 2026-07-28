import type {Layer} from '../domain/project';

export const roleMotion = {
  background: {distance: 8, rise: 2, startScale: 1},
  tertiary: {distance: 38, rise: 22, startScale: 0.95},
  secondary: {distance: 58, rise: 38, startScale: 0.9},
  primary: {distance: 78, rise: 55, startScale: 0.86},
  foreground: {distance: 92, rise: 28, startScale: 0.94},
} as const;

export const entranceVector = (layer: Layer) => {
  const distance = roleMotion[layer.role].distance;
  switch (layer.entrance) {
    case 'left': return {x: -distance, y: 0};
    case 'right': return {x: distance, y: 0};
    case 'up': return {x: 0, y: -distance};
    case 'down': return {x: 0, y: distance};
    default: return {x: 0, y: 0};
  }
};

export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
