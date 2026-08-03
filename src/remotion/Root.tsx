import React from 'react';
import {Composition} from 'remotion';
import {PaperVideo} from './PaperVideo';
import sampleProject from '../../projects/sample.json';
import {getProjectDuration, projectSchema} from '../domain/project';

const project = projectSchema.parse(sampleProject);

export const RemotionRoot: React.FC = () => <Composition
  id="OpenShortsVideo"
  component={PaperVideo}
  width={project.width}
  height={project.height}
  fps={project.fps}
  durationInFrames={getProjectDuration(project)}
  defaultProps={{project}}
  calculateMetadata={({props}) => {
    // inputProps 原样直达组件，不会自动过 schema——手写工程缺 audioCues 等
    // 可选字段时组件会崩。这里统一 parse 补齐默认值，所有渲染入口共用一份协议。
    const parsed = projectSchema.parse(props.project);
    return {
      width: parsed.width,
      height: parsed.height,
      fps: parsed.fps,
      durationInFrames: getProjectDuration(parsed),
      props: {project: parsed},
    };
  }}
/>;
