/* Tempus 运行时：确定性逐帧渲染核心。
 * 每一帧都是时间 t 的纯函数；无跨帧状态、无随机数。
 * 该文件被 vite.render.config.ts 打成 IIFE（vendor.js），
 * 与用户代码共同注入预览 iframe 与无头渲染页。 */

import * as ReactNS from 'react';
import * as ReactDOMNS from 'react-dom';
import * as ReactDOMClientNS from 'react-dom/client';
import * as ThreeNS from 'three';

/* 注入层：用户代码经 esbuild 虚拟模块访问 window.KV.React / ReactDOM / Three。
 * 必须在本文件顶部先挂载，下文的运行时才能取到引用。 */
(window as any).KV = {
  React: ReactNS,
  ReactDOM: Object.assign({}, ReactDOMNS, ReactDOMClientNS),
  Three: ThreeNS
};

type Comp = {
  id: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  component: (props: { frame: number }) => any;
};

const comps: Comp[] = [];
let marks: { t: number; label: string }[] = [];
let currentId: string | null = null;

export function registerComposition(def: Comp): void {
  const i = comps.findIndex((c) => c.id === def.id);
  if (i >= 0) comps[i] = def; else comps.push(def);
}

export function listCompositions(): { id: string; width: number; height: number; fps: number; durationInFrames: number }[] {
  return comps.map(({ id, width, height, fps, durationInFrames }) => ({ id, width, height, fps, durationInFrames }));
}

export function mark(t: number, label: string): void {
  // 组件体内每帧都会执行，同一 (t,label) 只登记一次
  if (marks.some((m) => m.t === t && m.label === label)) return;
  marks.push({ t, label });
}

export function getMarks(): { t: number; label: string }[] {
  return marks;
}

/* ---------- 插值与弹簧 ---------- */

/* 三次贝塞尔缓动求解（与 CSS cubic-bezier 同参数顺序） */
function cubicBezierEasing(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const dx = sampleX(t) - x;
      if (Math.abs(dx) < 1e-5) break;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= dx / d;
    }
    return sampleY(t);
  };
}

export const Easing = {
  linear: (t: number) => t,
  step0: () => 0,
  step1: () => 1,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t: number) =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  outBack: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  inBack: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  inOutBack: (t: number) => {
    const c1 = 1.70158, c2 = c1 * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },
  outCirc: (t: number) => Math.sqrt(1 - Math.pow(t - 1, 2)),
  inOutQuart: (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  outBounce: (t: number) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  outElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  /* 与 React Native / Remotion 同族：贝塞尔 + 组合器 */
  bezier: cubicBezierEasing,
  in: (e: (t: number) => number) => e,
  out: (e: (t: number) => number) => (t: number) => 1 - e(1 - t),
  inOut: (e: (t: number) => number) => (t: number) =>
    t < 0.5 ? e(2 * t) / 2 : 1 - e(2 - 2 * t) / 2
};
export type EasingFn = (t: number) => number;

type Extrapolate = 'extend' | 'clamp' | 'identity';

export interface InterpolateOptions {
  easing?: EasingFn;
  extrapolateLeft?: Extrapolate;
  extrapolateRight?: Extrapolate;
  /** 阶梯化：每 n 帧才更新一次数值（定格/卡帧风格） */
  posterize?: number;
}

export function interpolate(
  x: number,
  inputRange: [number, number],
  outputRange: [number, number],
  opts?: InterpolateOptions
): number {
  const [i0, i1] = inputRange, [o0, o1] = outputRange;
  const e = opts?.easing ?? Easing.linear;
  if (i1 === i0) return o0;
  const pz = opts?.posterize ?? 0;
  const xx = pz && pz > 0 ? i0 + Math.floor((x - i0) / pz) * pz : x;
  let t = (xx - i0) / (i1 - i0);
  const el = opts?.extrapolateLeft ?? 'extend', er = opts?.extrapolateRight ?? 'clamp';
  if (t <= 0) {
    if (el === 'clamp') t = 0;
    else if (el === 'identity') return x;
  } else if (t >= 1) {
    if (er === 'clamp') t = 1;
    else if (er === 'identity') return x;
  }
  const r = e(Math.min(1, Math.max(0, t)));
  return o0 + (o1 - o0) * r;
}

type SpringCfg = { damping?: number; stiffness?: number; mass?: number; overshootClamping?: boolean };

export interface SpringOptions {
  frame: number;
  fps?: number;
  from?: number;
  to?: number;
  config?: SpringCfg;
  durationInFrames?: number;
  /** 收敛判定阈值：spring 走完 durationInFrames 时距终值的剩余比例，默认 0.001 */
  durationRestThreshold?: number;
  /** 延迟多少帧开始（这些帧返回 from） */
  delay?: number;
  /** 反向播放 */
  reverse?: boolean;
}

function springValueAt(zeta: number, omega0: number, t: number): number {
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * omega0 * t) * (Math.cos(omegaD * t) + (zeta * omega0 / omegaD) * Math.sin(omegaD * t));
  }
  return 1 - (1 + omega0 * t) * Math.exp(-omega0 * t);
}

/* 执行顺序与 Remotion 一致：先拉伸到 durationInFrames，再 reverse，最后 delay 位移。 */
export function spring(opts: SpringOptions): number {
  const fps = opts.fps ?? 30;
  const from = opts.from ?? 0, to = opts.to ?? 1;
  const { damping = 10, stiffness = 100, mass = 1, overshootClamping = false } = opts.config ?? {};
  const delay = opts.delay ?? 0;
  const rest = opts.durationRestThreshold ?? 0.001;
  const dur = opts.durationInFrames && opts.durationInFrames > 0 ? opts.durationInFrames : null;

  const f = opts.frame - delay;
  if (f <= 0) return from;

  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const omega0 = Math.sqrt(stiffness / mass);
  let t = f / fps;

  // 1) 拉伸到指定帧数
  if (dur) {
    const scale = solveScale(zeta, omega0, dur / fps, 1 - rest);
    if (scale > 0) t *= scale;
  }
  // 2) 反向
  if (opts.reverse) {
    const total = dur ? dur / fps : 1;
    t = Math.max(0, total - t);
  }

  const v = springValueAt(zeta, omega0, t);
  let out = from + (to - from) * v;
  if (overshootClamping) {
    const lo = Math.min(from, to), hi = Math.max(from, to);
    out = Math.min(hi, Math.max(lo, out));
  }
  return out;
}

function solveScale(zeta: number, omega0: number, tTarget: number, threshold: number): number {
  // 求 s 使 1 - envelope(s*tTarget) ≈ threshold；envelope = e^{-ζωt}(带振荡包络)
  const env = (tt: number) => Math.exp(-zeta * omega0 * tt) * (1 + zeta * omega0 * tt);
  let lo = 0.01, hi = 100;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (env(mid * tTarget) > 1 - threshold) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ---------- 确定性随机 / 噪声 ----------
 * 与 Remotion 的 random(seed) 同语义：同一 seed 永远同一结果，
 * 保证逐帧导出可复现（禁止 Math.random）。 */

export function random(seed: string | number): number {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  let t = (h + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* 一维平滑噪声（确定性，值域 0~1）：用于漂浮、抖动、有机运动 */
export function noise1D(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = random('noise#' + i);
  const b = random('noise#' + (i + 1));
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

/* ---------- React 绑定 ---------- */

const R: any = (window as any).KV.React;
const RD: any = (window as any).KV.ReactDOM;
const { createContext, useContext, createElement, useState, useRef, useLayoutEffect, useEffect } = R;

type CtxVal = { frame: number; comp: Comp; offset: number };
// R 是运行期注入的 React（any），此处不经泛型
const Ctx: any = R.createContext({ frame: 0, offset: 0, comp: null });

export function useFrame(): number {
  return useContext(Ctx).frame;
}

export function useVideoConfig(): { width: number; height: number; fps: number; durationInFrames: number } {
  const { comp } = useContext(Ctx);
  return { width: comp.width, height: comp.height, fps: comp.fps, durationInFrames: comp.durationInFrames };
}

export function AbsoluteFill(props: any): any {
  return createElement('div', {
    style: {
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      width: '100%', height: '100%', overflow: 'hidden', ...props.style
    },
    className: props.className,
    children: props.children
  });
}

export function Sequence(props: { from?: number; durationInFrames?: number; children?: any; style?: any; name?: string }): any {
  const ctx = useContext(Ctx);
  const from = Math.round(props.from ?? 0);
  const dur = props.durationInFrames;
  const local = ctx.frame - from;
  if (local < 0) return null;
  if (dur !== undefined && local >= dur) return null;
  return createElement(Ctx.Provider, { value: { ...ctx, frame: local, offset: ctx.offset + from } },
    createElement('div', { style: { position: 'absolute', inset: 0, ...props.style } }, props.children));
}

/* Remotion 命名对齐：useCurrentFrame 等价于 useFrame，便于直接搬运 Remotion 代码 */
export const useCurrentFrame = useFrame;

/* Series：子片段按 durationInFrames 顺序首尾相接，只渲染当前命中片段 */
export function Series(props: { children?: any }): any {
  const ctx = useContext(Ctx);
  const kids = R.Children.toArray(props.children);
  let acc = 0;
  for (const k of kids) {
    const dur = Math.round((k as any)?.props?.durationInFrames ?? 0);
    if (ctx.frame >= acc && ctx.frame < acc + dur) {
      return createElement(
        Ctx.Provider,
        { value: { ...ctx, frame: ctx.frame - acc, offset: ctx.offset + acc } },
        createElement('div', { style: { position: 'absolute', inset: 0 } }, k)
      );
    }
    acc += dur;
  }
  return null;
}

/* Freeze：把时间钉在指定帧，之后画面静止 */
export function Freeze(props: { frame?: number; children?: any }): any {
  const ctx = useContext(Ctx);
  const f = Math.round(props.frame ?? 0);
  const frozen = Math.min(f, ctx.frame);
  return createElement(
    Ctx.Provider,
    { value: { ...ctx, frame: frozen } },
    createElement('div', { style: { position: 'absolute', inset: 0 } }, props.children)
  );
}

/* ================= 音频 =================
 *
 * 与 Remotion 的 Audio 对齐：<Audio src volume startFrom durationInFrames playbackRate />
 *
 * 预览：真实发声。<audio> 元素不进 React 树（new Audio() 挂全局），由 __seek 统一对齐
 *       —— 播放时让它自己走（只在大幅漂移时纠偏），暂停/拖动时精确 seek 到帧对应时刻。
 * 导出：iframe 在 file:// 下不能用 blob:，所以音频由父窗口 OfflineAudioContext 离线混音，
 *       见 src/core/audio.ts；这里只负责把 slots 的静态描述交出去。
 *
 * 音量是每帧求值的：写 volume={interpolate(frame,[0,30],[0,1])} 就是真实的淡入。 */

const MEDIA: Record<string, string> = ((window as any).__MEDIA ?? {});

/** 工程素材 → 可播放 URL（父窗口注册的 blob: 表）。
 * 容错顺序：精确 → 忽略大小写 → 只比文件名（用户常把 assets/bgm.mp3 写成 bgm.mp3）。 */
export function staticFile(p: string): string {
  const raw = String(p ?? '');
  const norm = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
  if (MEDIA[norm]) return MEDIA[norm];
  const lower = norm.toLowerCase();
  for (const k of Object.keys(MEDIA)) {
    if (k.toLowerCase() === lower) return MEDIA[k];
  }
  const base = lower.split('/').pop() ?? lower;
  for (const k of Object.keys(MEDIA)) {
    if ((k.toLowerCase().split('/').pop() ?? '') === base) return MEDIA[k];
  }
  return raw;
}

type AudioSlot = {
  key: string;
  el: HTMLAudioElement;
  src: string;
  startFrame: number;
  endFrame: number;
  startFrom: number;
  rate: number;
};

const audioSlots = new Map<string, AudioSlot>();
let audioSeq = 0;
let playingFlag = false;

/** 与当前帧对齐所有音频。force=用户主动跳转，必须硬 seek；否则播放中只纠大漂移。 */
function syncAudio(frame: number, force: boolean): void {
  const comp = comps.find((c) => c.id === currentId) ?? comps[0];
  if (!comp) return;
  const fps = comp.fps;
  for (const s of audioSlots.values()) {
    const el = s.el;
    const inside = frame >= s.startFrame && frame < s.endFrame;
    if (!inside) {
      if (!el.paused) el.pause();
      continue;
    }
    const want = s.startFrom + ((frame - s.startFrame) / fps) * s.rate;
    const drift = Math.abs(el.currentTime - want);
    if (force || !playingFlag || drift > 0.35) {
      try { el.currentTime = want; } catch { /* 元数据未就绪，下一帧再试 */ }
    }
    if (playingFlag) {
      if (el.paused) void el.play().catch(() => { /* 未就绪或自动播放策略拦截 */ });
    } else if (!el.paused) {
      el.pause();
    }
  }
}

/** 播放状态由 Workspace 通过 __setPlaying 透传，音频据此决定自己走还是跟随 seek */
export function setPlaying(p: boolean): void {
  playingFlag = !!p;
  if (!playingFlag) {
    for (const s of audioSlots.values()) if (!s.el.paused) s.el.pause();
  }
}

export function Audio(props: {
  src: string;
  volume?: number;
  startFrom?: number;
  durationInFrames?: number;
  playbackRate?: number;
  muted?: boolean;
  loop?: boolean;
}): any {
  const ctx = useContext(Ctx);
  const comp = ctx.comp;
  const from = ctx.offset ?? 0;
  const url = staticFile(props.src ?? '');
  const dur = props.durationInFrames ?? Math.max(0, (comp?.durationInFrames ?? 0) - from);
  const rate = props.playbackRate ?? 1;

  const idRef: any = useRef('');
  if (!idRef.current) idRef.current = 'au-' + (++audioSeq);

  useLayoutEffect(() => {
    const AudioCtor: any = (window as any).Audio;
    const el = new AudioCtor() as HTMLAudioElement;
    el.src = url;
    el.preload = 'auto';
    el.loop = !!props.loop;
    el.volume = 0;
    /* 加载失败要说出来：否则就是「明明写了 Audio 却一点声音都没有」的静默故障 */
    el.addEventListener('error', () => {
      try {
        (window as any).parent?.postMessage({ __tempus: 'audio-error', src: props.src, url }, '*');
      } catch { /* 跨源不可写时忽略 */ }
    });
    const key = idRef.current;
    audioSlots.set(key, {
      key, el, src: url,
      startFrame: from, endFrame: from + dur,
      startFrom: props.startFrom ?? 0, rate
    });
    syncAudio(ctx.frame, true);
    return () => {
      const s = audioSlots.get(key);
      if (s) {
        try { s.el.pause(); } catch { /* 已销毁 */ }
        s.el.removeAttribute('src');
        audioSlots.delete(key);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  /* 每帧刷新：时间线区间 + 音量包络 + 倍速 */
  const slot = audioSlots.get(idRef.current);
  if (slot) {
    slot.startFrame = from;
    slot.endFrame = from + dur;
    slot.startFrom = props.startFrom ?? 0;
    slot.rate = rate;
    const v = props.muted ? 0 : Math.max(0, Math.min(1, props.volume ?? 1));
    if (Math.abs(slot.el.volume - v) > 0.004) slot.el.volume = v;
    if (slot.el.playbackRate !== rate) slot.el.playbackRate = rate;
  }
  return null;
}

/** 交给父窗口做离线混音的描述（不含逐帧音量，音量由父窗口采样） */
export function collectAudio(): {
  startFrame: number; endFrame: number; startFrom: number; rate: number; volume: number; src: string;
}[] {
  const out: ReturnType<typeof collectAudio> = [];
  for (const s of audioSlots.values()) {
    if (!s.src) continue;
    out.push({
      startFrame: s.startFrame, endFrame: s.endFrame,
      startFrom: s.startFrom, rate: s.rate,
      volume: s.el.volume, src: s.src
    });
  }
  return out;
}

/** 只读当前各音频的瞬时音量，供父窗口采样音量包络 */
export function audioVolumes(): number[] {
  return Array.from(audioSlots.values()).map((s) => s.el.volume);
}

/* ---------- 引导与确定性 seek ---------- */

export function init(opts: { compId?: string | null }): void {
  marks = [];
  const comp = (opts.compId ? comps.find((c) => c.id === opts.compId) : null) ?? comps[0];
  if (!comp) {
    document.body.innerHTML = '<div style="color:#94a3b8;font:14px system-ui;padding:24px">该工程尚未注册任何合成（registerComposition）。</div>';
    (window as any).__ready = true;
    return;
  }
  currentId = comp.id;
  let setFrame: ((n: number) => void) | null = null;
  let pendingFrame: number | null = null;

  const Root = (): any => {
    // 初渲染消费 seek 提前量：无头渲染在首帧提交前就会调 __seek(0)
    const [frame, sf] = useState(pendingFrame ?? 0);
    pendingFrame = null;
    setFrame = sf;
    return createElement(Ctx.Provider, { value: { frame, comp, offset: 0 } }, createElement(comp.component, { frame }));
  };

  const root = RD.createRoot(document.getElementById('root')!);
  root.render(createElement(Root));

  (window as any).__seek = (n: number): void => {
    // flushSync 保证求值返回时 DOM 已是第 n 帧（确定性截图的前提）；
    // setFrame 未就绪（首帧尚未提交）时先记入 pendingFrame，由 Root 初渲染消费。
    const target = Math.round(n);
    RD.flushSync(() => {
      if (setFrame) setFrame(target);
      else pendingFrame = target;
    });
    (window as any).__frame = target;
    (window as any).__seekSeq = ((window as any).__seekSeq ?? 0) + 1;
    /* 画面驱动音频：暂停/拖动时精确定位，播放中只纠大漂移 */
    try { syncAudio(target, !playingFlag); } catch { /* 音频未就绪不影响画面 */ }
  };
  (window as any).__setPlaying = (p: boolean): void => setPlaying(p);
  (window as any).__collectAudio = (): any => collectAudio();
  (window as any).__audioVolumes = (): number[] => audioVolumes();
  (window as any).__media = MEDIA;
  (window as any).__comp = { id: comp.id, width: comp.width, height: comp.height, fps: comp.fps, durationInFrames: comp.durationInFrames };
  (window as any).__comps = listCompositions();
  (window as any).__ready = true;
}

export function currentCompId(): string | null {
  return currentId;
}

/* window.KR 汇总（用户代码通过 import {..} from 'tempus' 拿到同一批引用） */
const KR = {
  registerComposition, listCompositions, mark, getMarks,
  interpolate, spring, Easing, random, noise1D,
  useFrame, useCurrentFrame, useVideoConfig,
  Sequence, Series, Freeze, AbsoluteFill, init, currentCompId,
  Audio, staticFile, setPlaying, collectAudio, audioVolumes
};
(window as any).KR = KR;
