import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);

export const renderWaveform = async ({input,output,width=1200,height=160,run=exec}) => {
  await run('ffmpeg',['-y','-v','error','-i',input,'-filter_complex',`showwavespic=s=${width}x${height}:colors=#b58a3d`,'-frames:v','1',output]);
  return output;
};
