import { mediaBlob } from './media';

/* 音频离线引擎：波形峰值 + 导出混音（WAV）。
 *
 * 预览靠 <audio> 实时发声；导出走的是无头 Edge 的 file:// 页面，blob: 在那里不成立，
 * 所以导出阶段由这里用 OfflineAudioContext 把整条时间线离线渲染成一条 WAV，
 * 再交给 Rust 的 ffmpeg 与逐帧画面合并。 */

export type AudioClip = {
  startFrame: number;
  endFrame: number;
  startFrom: number;
  rate: number;
  volume: number;
  src: string;       // blob: URL
};

export type WavePeaks = {
  /** 每个桶的最大振幅（0~1） */
  peaks: Float32Array;
  durationSec: number;
  sampleRate: number;
  channels: number;
  /** 用于判断波形是否已就绪 */
  ok: boolean;
};

let sharedCtx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!sharedCtx) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    sharedCtx = new AC();
  }
  return sharedCtx;
}

const decodeCache = new Map<string, AudioBuffer>();

/** 解码音频文件（按绝对路径缓存 AudioBuffer） */
export async function decodeAudio(absPath: string): Promise<AudioBuffer> {
  const hit = decodeCache.get(absPath);
  if (hit) return hit;
  const blob = await mediaBlob(absPath);
  const buf = await blob.arrayBuffer();
  const audio = await ctx().decodeAudioData(buf.slice(0));
  decodeCache.set(absPath, audio);
  return audio;
}

/** 计算波形峰值：把整段音频压成 n 个桶，每桶取绝对值峰值 */
export async function waveform(absPath: string, buckets = 900): Promise<WavePeaks> {
  try {
    const buf = await decodeAudio(absPath);
    const ch = buf.getChannelData(0);
    const n = Math.max(64, Math.min(buckets, ch.length));
    const peaks = new Float32Array(n);
    const step = ch.length / n;
    for (let i = 0; i < n; i++) {
      const s = Math.floor(i * step), e = Math.min(ch.length, Math.floor((i + 1) * step));
      let m = 0;
      for (let j = s; j < e; j++) {
        const v = ch[j] < 0 ? -ch[j] : ch[j];
        if (v > m) m = v;
      }
      peaks[i] = m;
    }
    return {
      peaks,
      durationSec: buf.duration,
      sampleRate: buf.sampleRate,
      channels: buf.numberOfChannels,
      ok: true
    };
  } catch {
    return { peaks: new Float32Array(0), durationSec: 0, sampleRate: 0, channels: 0, ok: false };
  }
}

/* ---------- WAV 编码 ---------- */

function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numCh = channels.length;
  const len = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = len * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  let p = 0;
  const str = (s: string): void => { for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i)); };
  const u32 = (v: number): void => { view.setUint32(p, v, true); p += 4; };
  const u16 = (v: number): void => { view.setUint16(p, v, true); p += 2; };

  str('RIFF'); u32(36 + dataSize); str('WAVE');
  str('fmt '); u32(16); u16(1); u16(numCh); u32(sampleRate);
  u32(sampleRate * blockAlign); u16(blockAlign); u16(16);
  str('data'); u32(dataSize);

  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      p += 2;
    }
  }
  return new Uint8Array(buf);
}

export function bytesToBase64(bytes: Uint8Array): string {
  /* 分块拼，避免 apply 参数上限 */
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as unknown as number[]);
  }
  return btoa(bin);
}

/* ---------- 离线混音 ---------- */

export type MixRequest = {
  clips: AudioClip[];
  totalFrames: number;
  fps: number;
  /** 逐帧调回以采样音量包络（返回该帧各 clip 的 volume） */
  sampleVolumes?: (frame: number) => Promise<number[]>;
  /** 采样间隔（帧），默认每 3 帧一个点 */
  sampleStep?: number;
  onProgress?: (done: number, total: number) => void;
};

/** 把时间线上所有音频片段离线混成一条立体声 WAV（16-bit / 48kHz） */
export async function mixTimelineWav(req: MixRequest): Promise<Uint8Array> {
  const { clips, totalFrames, fps } = req;
  const sampleRate = 48000;
  const totalSec = totalFrames / fps;

  /* 1) 采样音量包络：拖拽/seek 期间组件不重渲染，所以必须主动逐点求值 */
  const step = Math.max(1, req.sampleStep ?? 3);
  const frames: number[] = [];
  for (let f = 0; f <= totalFrames; f += step) frames.push(f);
  const env: number[][] = [];
  if (req.sampleVolumes && clips.length) {
    for (let i = 0; i < frames.length; i++) {
      env.push(await req.sampleVolumes(frames[i]));
      if (i % 20 === 0) req.onProgress?.(i, frames.length);
    }
  }

  /* 2) 解码各片段源 */
  const buffers: (AudioBuffer | null)[] = [];
  for (const c of clips) {
    try {
      const res = await fetch(c.src);
      const arr = await res.arrayBuffer();
      buffers.push(await ctx().decodeAudioData(arr));
    } catch {
      buffers.push(null);
    }
  }

  const offline = new OfflineAudioContext(2, Math.max(1, Math.ceil(totalSec * sampleRate)), sampleRate);

  clips.forEach((clip, i) => {
    const buf = buffers[i];
    if (!buf) return;
    const src = offline.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = clip.rate || 1;

    const gain = offline.createGain();
    /* 音量曲线：把采样点映射成 setValueAtTime 序列（线性插值由浏览器补间） */
    const g0 = env.length ? (env[0][i] ?? clip.volume) : clip.volume;
    gain.gain.setValueAtTime(g0, 0);
    for (let k = 1; k < frames.length; k++) {
      const t = frames[k] / fps;
      if (t > totalSec) break;
      const v = env[k] ? (env[k][i] ?? clip.volume) : clip.volume;
      gain.gain.setValueAtTime(v, t);
    }

    src.connect(gain).connect(offline.destination);

    /* 时间线位置 → 上下文时间；start(when, offset, duration) */
    const when = Math.max(0, clip.startFrame / fps);
    const offset = Math.max(0, clip.startFrom);
    const dur = Math.max(0, (clip.endFrame - clip.startFrame) / fps) * (clip.rate || 1);
    const available = Math.max(0, buf.duration - offset);
    const playDur = Math.min(dur, available);
    if (playDur > 0.001) {
      try { src.start(when, offset, playDur); } catch { /* 参数越界就跳过这一条 */ }
    }
  });

  const rendered = await offline.startRendering();
  const L = rendered.getChannelData(0);
  const Rr = rendered.getChannelData(1);
  return encodeWav([L, Rr], sampleRate);
}
