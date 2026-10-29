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

export const Easing = {
  linear: (t: number) => t,
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
  outElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }
};
export type EasingFn = (t: number) => number;

export function interpolate(
  x: number,
  inputRange: [number, number],
  outputRange: [number, number],
  opts?: { easing?: EasingFn; extrapolateLeft?: 'extend' | 'clamp'; extrapolateRight?: 'extend' | 'clamp' }
): number {
  const [i0, i1] = inputRange, [o0, o1] = outputRange;
  const e = opts?.easing ?? Easing.linear;
  if (i1 === i0) return o0;
  let t = (x - i0) / (i1 - i0);
  const el = opts?.extrapolateLeft ?? 'extend', er = opts?.extrapolateRight ?? 'clamp';
  if (t <= 0) { if (el === 'clamp') t = 0; } else if (t >= 1) { if (er === 'clamp') t = 1; }
  const r = e(Math.min(1, Math.max(0, t)));
  return o0 + (o1 - o0) * r;
}

type SpringCfg = { damping?: number; stiffness?: number; mass?: number; overshootClamping?: boolean };

export function spring(
  opts: { frame: number; fps: number; from?: number; to?: number; config?: SpringCfg; durationInFrames?: number }
): number {
  const { frame, fps } = opts;
  const from = opts.from ?? 0, to = opts.to ?? 1;
  const { damping = 10, stiffness = 100, mass = 1, overshootClamping = false } = opts.config ?? {};
  const t = Math.max(0, frame) / fps;
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const omega0 = Math.sqrt(stiffness / mass);
  let v: number;
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    v = 1 - Math.exp(-zeta * omega0 * t) * (Math.cos(omegaD * t) + (zeta * omega0 / omegaD) * Math.sin(omegaD * t));
  } else {
    v = 1 - (1 + omega0 * t) * Math.exp(-omega0 * t);
  }
  if (opts.durationInFrames && opts.durationInFrames > 0) {
    // 归一化到指定帧数：以 95% 收敛点压缩时间轴
    const tp = opts.durationInFrames / fps;
    const scale = solveScale(zeta, omega0, tp, 0.95);
    if (scale > 0) {
      const tt = t * scale;
      if (zeta < 1) {
        const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
        v = 1 - Math.exp(-zeta * omega0 * tt) * (Math.cos(omegaD * tt) + (zeta * omega0 / omegaD) * Math.sin(omegaD * tt));
      } else {
        v = 1 - (1 + omega0 * tt) * Math.exp(-omega0 * tt);
      }
    }
  }
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

/* ---------- React 绑定 ---------- */

const R: any = (window as any).KV.React;
const RD: any = (window as any).KV.ReactDOM;
const { createContext, useContext, createElement, useState } = R;

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
  };
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
  interpolate, spring, Easing, useFrame, useVideoConfig, Sequence, AbsoluteFill, init, currentCompId
};
(window as any).KR = KR;
