import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {subtitleBottomRatio, subtitleFontSize} from '../../shared/captions.mjs';
import type {Layer, PaperProject, Scene} from '../domain/project';
import {entranceVector, roleMotion} from '../motion/animation';
import {resolveLayerPose} from '../motion/keyframes';

const assetUrl = (src: string) => /^(https?:|data:|blob:)/.test(src) ? src : staticFile(src.replace(/^\//, ''));

// 文字图层：技术讲解里承载数字、术语和代码。逐行显现让一屏内容跟着口播推进，
// 而不是整块一次砸出来——后者正是「画面静止十几秒」的来源。
const TextBlock: React.FC<{layer: Layer; project: PaperProject; localFrame: number}> = ({layer, project, localFrame}) => {
  const style = layer.style!;
  const lines = style.text.split('\n');
  const visible = style.revealFrames > 0
    ? lines.map((_, index) => localFrame >= index * style.revealFrames)
    : lines.map(() => true);
  return <div style={{
    width: layer.width,
    padding: style.padding,
    borderRadius: style.background ? 14 : undefined,
    background: style.background,
    textAlign: style.align,
    color: style.color ?? project.theme.paper,
    fontFamily: style.mono
      ? 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
      : '"PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif',
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    whiteSpace: 'pre-wrap',
  }}>
    {lines.map((line, index) => (
      <div key={`${line}-${index}`} style={{
        opacity: visible[index] ? 1 : 0,
        transform: visible[index] ? 'translateY(0)' : 'translateY(14px)',
        transition: 'none',
      }}>{line === '' ? ' ' : line}</div>
    ))}
  </div>;
};

const PaperLayer: React.FC<{layer: Layer; project: PaperProject}> = ({layer, project}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localFrame = Math.max(0, frame - layer.delayFrames);
  const pose = resolveLayerPose(layer, frame);
  const progress = layer.entrance === 'none' ? 1 : spring({frame: localFrame, fps, config: {damping: 14, mass: 0.8, stiffness: 115}});
  const vector = entranceVector(layer);
  const motion = roleMotion[layer.role];
  const drift = layer.role === 'background' ? 0 : Math.sin((frame + layer.delayFrames) / 20) * Math.min(4, motion.rise / 10);
  const opacity = layer.entrance === 'none' ? pose.opacity : interpolate(progress, [0, 0.45, 1], [0, pose.opacity, pose.opacity]);
  const scale = interpolate(progress, [0, 1], [motion.startScale, 1]);
  const translateX = pose.x + vector.x * (1 - progress);
  const translateY = pose.y + vector.y * (1 - progress) + drift;

  const boxStyle: React.CSSProperties = {
    position: 'absolute', left: 0, top: 0, width: pose.width, height: 'auto',
    opacity, zIndex: layer.zIndex,
    transformOrigin: '50% 100%',
    transform: `translate(${translateX}px, ${translateY}px) rotate(${pose.rotation}deg) scale(${layer.flipX ? -scale : scale}, ${scale})`,
    filter: layer.paperEdge ? 'drop-shadow(3px 0 #f5eedc) drop-shadow(-3px 0 #f5eedc) drop-shadow(0 3px #f5eedc) drop-shadow(0 14px 8px rgba(20,15,12,.28))' : undefined,
  };

  if (layer.kind === 'text') {
    // 文字自带描边会糊，改用落影保证压在画面上也读得清
    return <div style={{...boxStyle, filter: layer.paperEdge ? 'drop-shadow(0 6px 18px rgba(0,0,0,.55))' : undefined}}>
      <TextBlock layer={layer} project={project} localFrame={localFrame}/>
    </div>;
  }

  return <Img src={assetUrl(layer.src!)} style={boxStyle}/>;
};

const SceneView: React.FC<{scene: Scene; project: PaperProject}> = ({scene, project}) => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, scene.durationFrames], [1, scene.cameraZoom], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const caption = scene.captions.find((item) => frame >= item.fromFrame && frame < item.toFrame);
  return <AbsoluteFill style={{backgroundColor: scene.backgroundColor, overflow: 'hidden', color: project.theme.ink}}>
    <AbsoluteFill style={{transform: `scale(${zoom})`}}>
      {[...scene.layers].sort((a, b) => a.zIndex - b.zIndex).map((layer) => <PaperLayer key={layer.id} layer={layer} project={project}/>) }
    </AbsoluteFill>
    {caption && <div style={{
      position: 'absolute', left: '7%', right: '7%', bottom: `${subtitleBottomRatio(project.width, project.height) * 100}%`, zIndex: 1000,
      padding: '14px 20px', borderRadius: 8, textAlign: 'center',
      background: project.theme.subtitleBackground, color: project.theme.paper,
      fontFamily: 'system-ui, sans-serif', fontSize: subtitleFontSize(project.width, project.height), fontWeight: 700,
      letterSpacing: 2, boxShadow: '0 8px 30px rgba(0,0,0,.25)',
    }}>{caption.words?.length ? caption.words.map((word,index) => <span key={`${word.text}-${index}`} style={{color:frame >= word.fromFrame && frame < word.toFrame ? project.theme.accent : project.theme.paper,marginRight:2}}>{word.text}</span>) : caption.text}</div>}
    {scene.narrationSrc && <Audio src={assetUrl(scene.narrationSrc)}/>} 
    {scene.audioCues.map((cue, index) => <Sequence key={`${cue.src}-${index}`} from={cue.fromFrame}>
      <Audio src={assetUrl(cue.src)} volume={cue.volume}/>
    </Sequence>)}
  </AbsoluteFill>;
};

export const PaperVideo: React.FC<{project: PaperProject}> = ({project}) => <AbsoluteFill>
  {project.soundtrackSrc && <Audio src={assetUrl(project.soundtrackSrc)} volume={project.soundtrackVolume ?? 0.18} loop/>}
  {project.scenes.map((scene, index) => {
    const from = project.scenes.slice(0, index).reduce((sum, item) => sum + item.durationFrames, 0);
    return <Sequence key={scene.id} from={from} durationInFrames={scene.durationFrames} premountFor={project.fps}>
      <SceneView scene={scene} project={project}/>
    </Sequence>;
  })}
</AbsoluteFill>;
