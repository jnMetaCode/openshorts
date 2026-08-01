// 配乐合成。
//
// 旧版是一段写死的 16 音符正弦波循环，每 12 秒重复一次，而且任何故事都输出同一串——
// 纯正弦没有泛音包络，听感像电话保持音。
//
// 这里改用 Karplus-Strong 弹拨弦：一段噪声激励在延迟线里循环并逐次低通衰减，
// 天然长出拨弦的起振和泛音滚降，接近古筝/琵琶，和纸片剪纸的国风调性也对得上。
// 每个故事从 storyboard.json 读自己的调式、速度和情绪。

const SAMPLE_RATE = 48000;

// 五声音阶：宫 商 角 徵 羽。中国调式的骨架，避免半音带来的西洋味。
const MODES = {
  gong: [0, 2, 4, 7, 9],      // 宫（大调感，明亮开阔）
  yu: [0, 3, 5, 7, 10],       // 羽（小调感，苍凉）
  zhi: [0, 2, 5, 7, 9],       // 徵（中性偏暖）
};

export const MOODS = {
  epic: {mode: 'gong', octave: 0, tempo: 0.62, decay: 0.9955, brightness: 0.46, padLevel: 0.075, swell: true, reverb: 0.38},
  urgent: {mode: 'yu', octave: 0, tempo: 0.44, decay: 0.9938, brightness: 0.54, padLevel: 0.06, swell: false, reverb: 0.26},
  elegiac: {mode: 'yu', octave: -12, tempo: 0.86, decay: 0.9968, brightness: 0.34, padLevel: 0.09, swell: true, reverb: 0.46},
  bright: {mode: 'zhi', octave: 12, tempo: 0.5, decay: 0.9948, brightness: 0.58, padLevel: 0.05, swell: false, reverb: 0.30},
};

const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// 确定性伪随机：同样的 seed 永远得到同样的曲子，成片可复现。
const rng = (seed) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
};

/** 生成 A-B-A' 三段式的音高序列，避免整首都在重复同一个动机。 */
export const composeMelody = ({mood, bars, seed}) => {
  const random = rng(seed);
  const scale = MODES[mood.mode];
  const root = 62 + mood.octave;                  // D
  const pick = (low, high) => scale[Math.floor(random() * scale.length)] + 12 * (low + Math.floor(random() * (high - low + 1)));
  const motif = Array.from({length: 8}, () => root + pick(0, 1));
  const contrast = Array.from({length: 8}, () => root + pick(1, 2));
  // A 原样，B 对比，A' 把动机整体上行一个音级收尾
  const lift = scale[1] - scale[0];
  const variation = motif.map((note, index) => index % 2 ? note + lift : note);
  const sections = [motif, motif, contrast, variation];
  const notes = [];
  while (notes.length < bars) notes.push(...sections[Math.floor(notes.length / motif.length) % sections.length]);
  return notes.slice(0, bars);
};

/**
 * Karplus-Strong 弹拨弦。噪声激励 → 延迟线循环 → 每圈两点平均低通 + 衰减。
 * brightness 控制激励里保留多少高频，decay 控制余音长短。
 */
const pluck = ({freq, seconds, decay, brightness, seed}) => {
  const random = rng(seed);
  const size = Math.max(2, Math.round(SAMPLE_RATE / freq));
  const buffer = new Float32Array(size);
  let previous = 0;
  for (let i = 0; i < size; i += 1) {
    const white = random() * 2 - 1;
    previous = brightness * white + (1 - brightness) * previous;  // 一阶低通塑造音色
    buffer[i] = previous;
  }
  const total = Math.round(seconds * SAMPLE_RATE);
  const out = new Float32Array(total);
  let index = 0;
  for (let i = 0; i < total; i += 1) {
    const next = (index + 1) % size;
    const value = (buffer[index] + buffer[next]) * 0.5 * decay;
    out[i] = buffer[index];
    buffer[index] = value;
    index = next;
  }
  // 弦还在振动时截断会在每个音尾留下咔哒声，用最后 18% 做余弦淡出收干净。
  const release = Math.max(1, Math.round(total * 0.18));
  for (let i = total - release; i < total; i += 1) {
    out[i] *= 0.5 * (1 + Math.cos(Math.PI * (i - (total - release)) / release));
  }
  return out;
};

// Schroeder 混响：4 条并联梳状延迟造密度，2 级串联全通把回声抹匀。
// 干声是「听着廉价」的最大来源——真实乐器永远在某个空间里。
const reverb = (input, {mix = 0.32, room = 0.84} = {}) => {
  const combs = [1557, 1617, 1491, 1422].map((size) => ({buffer: new Float32Array(size), index: 0, gain: room}));
  const allpasses = [225, 556].map((size) => ({buffer: new Float32Array(size), index: 0}));
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    let wet = 0;
    for (const comb of combs) {
      const value = comb.buffer[comb.index];
      wet += value;
      comb.buffer[comb.index] = input[i] + value * comb.gain;
      comb.index = (comb.index + 1) % comb.buffer.length;
    }
    wet *= 0.25;
    for (const ap of allpasses) {
      const value = ap.buffer[ap.index];
      const output = value - wet * 0.5;
      ap.buffer[ap.index] = wet + value * 0.5;
      ap.index = (ap.index + 1) % ap.buffer.length;
      wet = output;
    }
    out[i] = input[i] * (1 - mix) + wet * mix;
  }
  return out;
};

// 节奏型：1 = 弹，0 = 留白。每拍都弹会像节拍器，留白才有呼吸。
const PATTERNS = {
  epic: [1, 0, 1, 1, 0, 1, 0, 0],
  urgent: [1, 1, 0, 1, 1, 0, 1, 0],
  elegiac: [1, 0, 0, 1, 0, 0, 1, 0],
  bright: [1, 0, 1, 0, 1, 1, 0, 1],
};

export const renderMusic = ({mood: moodName = 'epic', seconds = 60, seed = 20260801}) => {
  const mood = MOODS[moodName] ?? MOODS.epic;
  const beat = mood.tempo;
  const bars = Math.ceil(seconds / beat) + 1;
  const notes = composeMelody({mood, bars, seed});
  const frames = Math.round(seconds * SAMPLE_RATE);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const scale = MODES[mood.mode];
  const root = 62 + mood.octave;

  // 旋律：按节奏型弹奏，留白处不弹；力度和起弹时间做轻微人性化，避免机械感
  const pattern = PATTERNS[moodName] ?? PATTERNS.epic;
  const humanize = rng(seed ^ 0x5f3759df);
  for (const [index, note] of notes.entries()) {
    if (!pattern[index % pattern.length]) continue;
    const jitter = (humanize() - 0.5) * beat * 0.06;          // ±3% 拍长的起弹偏移
    const start = Math.round((index * beat + jitter) * SAMPLE_RATE);
    if (start >= frames) break;
    const voice = pluck({freq: midiToFreq(note), seconds: Math.min(beat * 3.2, seconds), decay: mood.decay, brightness: mood.brightness, seed: seed + index * 977});
    const pan = index % 2 ? 0.58 : 0.42;
    const accent = index % pattern.length === 0 ? 1 : 0.72 + humanize() * 0.22;
    const level = 0.30 * accent;
    for (let i = 0; i < voice.length && start + i < frames; i += 1) {
      if (start + i < 0) continue;
      left[start + i] += voice[i] * level * (1 - pan);
      right[start + i] += voice[i] * level * pan;
    }
  }

  // 低音衬底：每四拍换一次根音，用低八度长音撑住
  for (let bar = 0; bar * beat * 4 < seconds; bar += 1) {
    const start = Math.round(bar * beat * 4 * SAMPLE_RATE);
    const degree = scale[[0, 4, 3, 4][bar % 4] % scale.length];
    const voice = pluck({freq: midiToFreq(root - 12 + degree), seconds: beat * 4.4, decay: 0.9975, brightness: 0.22, seed: seed + 5000 + bar * 131});
    for (let i = 0; i < voice.length && start + i < frames; i += 1) {
      const value = voice[i] * mood.padLevel;
      left[start + i] += value;
      right[start + i] += value;
    }
  }

  // 混响放在动态包络之前，让尾音也跟着整体起伏
  const wetLeft = reverb(left, {mix: mood.reverb ?? 0.34});
  const wetRight = reverb(right, {mix: (mood.reverb ?? 0.34) * 0.92});
  left.set(wetLeft); right.set(wetRight);

  // 整体动态：入场淡入、收尾淡出；epic/elegiac 额外走一条缓慢的起伏，避免全程一个音量
  let peak = 0;
  for (let i = 0; i < frames; i += 1) {
    const t = i / SAMPLE_RATE;
    const fade = Math.min(1, t / 2.4) * Math.min(1, (seconds - t) / 3.5);
    const swell = mood.swell ? 0.82 + 0.18 * Math.sin(2 * Math.PI * t / 26) : 1;
    left[i] *= fade * swell;
    right[i] *= fade * swell;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  // 归一到 -6 dBFS，后面还有母带的 loudnorm 兜底
  const gain = peak > 0 ? 0.5 / peak : 1;
  const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i += 1) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i] * gain)) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i] * gain)) * 32767), i * 4 + 2);
  }
  return {data, peak, notes};
};

export const wavBuffer = (data, channels = 2) => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22); header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * channels * 2, 28); header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};
