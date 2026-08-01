export interface CaptionCue {
  text: string;
  fromFrame: number;
  toFrame: number;
  words: {text: string; fromFrame: number; toFrame: number}[];
}

/** 单行最多字数；默认 16，保证在 1080 宽竖屏下不换行。 */
export declare const MAX_LINE_CHARS: number;
export declare const splitCaptionText: (text: string, maxChars?: number) => string[];
export declare const splitCaptions: (
  text: string,
  frames: number,
  options?: {maxChars?: number; leadFrames?: number; tailFrames?: number},
) => CaptionCue[];
export declare const captionReadingRate: (caption: {text: string; fromFrame: number; toFrame: number}, fps: number) => number;
export declare const subtitleBottomRatio: (width: number, height: number) => number;
export declare const subtitleFontSize: (width: number, height: number) => number;
