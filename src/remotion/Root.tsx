import React from 'react';
import {Composition} from 'remotion';
import {PaperVideo} from './PaperVideo';
import sampleProject from '../../projects/sample.json';
import {getProjectDuration, projectSchema} from '../domain/project';

const project = projectSchema.parse(sampleProject);

export const RemotionRoot: React.FC = () => <Composition
  id="PaperCutVideo"
  component={PaperVideo}
  width={project.width}
  height={project.height}
  fps={project.fps}
  durationInFrames={getProjectDuration(project)}
  defaultProps={{project}}
  calculateMetadata={({props}) => ({
    width: props.project.width,
    height: props.project.height,
    fps: props.project.fps,
    durationInFrames: getProjectDuration(props.project),
  })}
/>;
