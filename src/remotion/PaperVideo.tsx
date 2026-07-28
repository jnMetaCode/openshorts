import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Layer, PaperProject, Scene} from '../domain/project';
import {entranceVector, roleMotion} from '../motion/animation';
import {resolveLayerPose} from '../motion/keyframes';

const assetUrl = (src: string) => /^(https?:|data:|blob:)/.test(src) ? src : staticFile(src.replace(/^\//, ''));

const PaperLayer: React.FC<{layer: Layer}> = ({layer}) => {
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

  return <Img
    src={assetUrl(layer.src)}
    style={{
      position: 'absolute', left: 0, top: 0, width: pose.width, height: 'auto',
      opacity, zIndex: layer.zIndex,
      transformOrigin: '50% 100%',
      transform: `translate(${translateX}px, ${translateY}px) rotate(${pose.rotation}deg) scale(${layer.flipX ? -scale : scale}, ${scale})`,
      filter: layer.paperEdge ? 'drop-shadow(3px 0 #f5eedc) drop-shadow(-3px 0 #f5eedc) drop-shadow(0 3px #f5eedc) drop-shadow(0 14px 8px rgba(20,15,12,.28))' : undefined,
    }}
  />;
};

const SceneView: React.FC<{scene: Scene; project: PaperProject}> = ({scene, project}) => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, scene.durationFrames], [1, scene.cameraZoom], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const caption = scene.captions.find((item) => frame >= item.fromFrame && frame < item.toFrame);
  return <AbsoluteFill style={{backgroundColor: scene.backgroundColor, overflow: 'hidden', color: project.theme.ink}}>
    <AbsoluteFill style={{transform: `scale(${zoom})`}}>
      {[...scene.layers].sort((a, b) => a.zIndex - b.zIndex).map((layer) => <PaperLayer key={layer.id} layer={layer}/>) }
    </AbsoluteFill>
    {caption && <div style={{
      position: 'absolute', left: '12%', right: '12%', bottom: '5%', zIndex: 1000,
      padding: '15px 28px', borderRadius: 8, textAlign: 'center',
      background: project.theme.subtitleBackground, color: project.theme.paper,
      fontFamily: 'system-ui, sans-serif', fontSize: Math.round(project.height * 0.04), fontWeight: 700,
      letterSpacing: 2, boxShadow: '0 8px 30px rgba(0,0,0,.25)',
    }}>{caption.words?.length ? caption.words.map((word,index) => <span key={`${word.text}-${index}`} style={{color:frame >= word.fromFrame && frame < word.toFrame ? project.theme.accent : project.theme.paper,marginRight:2}}>{word.text}</span>) : caption.text}</div>}
    {scene.narrationSrc && <Audio src={assetUrl(scene.narrationSrc)}/>} 
  </AbsoluteFill>;
};

export const PaperVideo: React.FC<{project: PaperProject}> = ({project}) => <AbsoluteFill>
  {project.soundtrackSrc && <Audio src={assetUrl(project.soundtrackSrc)} volume={0.18} loop/>}
  {project.scenes.map((scene, index) => {
    const from = project.scenes.slice(0, index).reduce((sum, item) => sum + item.durationFrames, 0);
    return <Sequence key={scene.id} from={from} durationInFrames={scene.durationFrames} premountFor={project.fps}>
      <SceneView scene={scene} project={project}/>
    </Sequence>;
  })}
</AbsoluteFill>;
