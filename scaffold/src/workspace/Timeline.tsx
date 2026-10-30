import React, { useCallback, useEffect, useRef } from 'react';
import type { Mark } from '../core/types';
import { onSettings } from '../core/settings';
import { IconZoomIn, IconZoomOut, IconFit } from '../ui/icons';

/* 时间轴：canvas 按需绘制（标尺 / 合成块 / 标记旗 / 播放头），拖拽定位、滚轮缩放。
 * 不再常驻 rAF：仅在帧、标记、缩放、尺寸变化时重绘，播放时随帧重绘（≤fps 次/秒）。 */

type Props = {
  duration: number;
  fps: number;
  frame: number;
  marks: Mark[];
  onSeek: (f: number) => void;
};

export function Timeline({ duration, fps, frame, marks, onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pxPerFrameRef = useRef(3.2);
  const scrollRef = useRef(0); // 水平滚动（帧）
  const dragRef = useRef(false);
  const stateRef = useRef({ duration, fps, frame, marks });
  stateRef.current = { duration, fps, frame, marks };

  const draw = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { duration: dur, fps: f, frame: fr, marks: mk } = stateRef.current;
    const dark = document.documentElement.dataset.theme === 'dark';
    /* 主题色板：canvas 画不了 CSS 变量，只能手动对齐两套 */
    const C = dark ? {
      bg: 'rgba(22, 26, 33, 0.72)', grid: '#1f242d', ruler: '#5d6878', tick: '#232a34',
      blockFill: '#1b2840', blockStroke: '#2b4570', blockText: '#b8cdf2',
      frameTick: 'rgba(106, 161, 255, 0.22)', mark: '#6aa1ff', head: '#f0686d'
    } : {
      bg: 'rgba(251, 252, 254, 0.66)', grid: '#eef2f8', ruler: '#9aa4b2', tick: '#e4eaf3',
      blockFill: '#dcebfe', blockStroke: '#a9c9f8', blockText: '#1a3f77',
      frameTick: 'rgba(31, 111, 235, 0.2)', mark: '#1f6feb', head: '#e5484d'
    };
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (W === 0 || H === 0) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const pxf = pxPerFrameRef.current;
    const totalPx = dur * pxf;
    const trackY = 40, trackH = 46;

    // 背景（半透明，让磨砂玻璃透出环境光）
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // 背景网格（每 1 秒）
    const secPx = f * pxf;
    if (secPx > 6) {
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -scrollRef.current * pxf % secPx; x < W; x += secPx) {
        ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, H);
      }
      ctx.stroke();
    }

    // 标尺
    ctx.fillStyle = C.ruler;
    ctx.font = '10px Consolas, monospace';
    ctx.textBaseline = 'middle';
    const stepSec = secPx < 34 ? (secPx < 14 ? 10 : 5) : 1;
    for (let sec = 0; sec * f <= dur; sec += stepSec) {
      const x = sec * f * pxf - scrollRef.current * pxf;
      if (x < -60 || x > W + 60) continue;
      ctx.fillText(`${sec}s`, x + 4, 12);
      ctx.strokeStyle = C.tick;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, 4); ctx.lineTo(Math.round(x) + .5, H); ctx.stroke();
    }

    // 合成主块
    const x0 = -scrollRef.current * pxf;
    const bx = x0, bw = totalPx;
    ctx.fillStyle = C.blockFill;
    roundRect(ctx, bx, trackY, bw, trackH, 9);
    ctx.fill();
    ctx.strokeStyle = C.blockStroke;
    ctx.lineWidth = 1;
    roundRect(ctx, bx, trackY, bw, trackH, 9);
    ctx.stroke();
    ctx.fillStyle = C.blockText;
    ctx.font = '600 12px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.save();
    ctx.beginPath(); ctx.rect(bx, trackY, bw, trackH); ctx.clip();
    ctx.fillText(`主合成 · ${dur} 帧 · ${(dur / f).toFixed(1)} 秒`, bx + 13, trackY + 15);
    // 帧刻度纹理
    if (pxf > 2.5) {
      ctx.strokeStyle = C.frameTick;
      ctx.beginPath();
      for (let i = 0; i <= dur; i += 5) {
        const x = x0 + i * pxf;
        ctx.moveTo(Math.round(x) + .5, trackY + trackH - 12); ctx.lineTo(Math.round(x) + .5, trackY + trackH);
      }
      ctx.stroke();
    }
    ctx.restore();

    // 标记旗
    ctx.font = '10px "Segoe UI", "Microsoft YaHei", sans-serif';
    for (const m of mk) {
      const x = x0 + m.t * pxf;
      if (x < -80 || x > W + 80) continue;
      ctx.strokeStyle = C.mark;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, 20); ctx.lineTo(Math.round(x) + .5, H); ctx.stroke();
      ctx.fillStyle = C.mark;
      ctx.beginPath();
      ctx.moveTo(x, 8); ctx.lineTo(x + 7, 12.5); ctx.lineTo(x, 17);
      ctx.closePath(); ctx.fill();
      const tw = ctx.measureText(m.label).width;
      ctx.fillStyle = dark ? 'rgba(106, 161, 255, 0.94)' : 'rgba(31, 111, 235, 0.92)';
      roundRect(ctx, x + 9, 5, tw + 12, 16, 5);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(m.label, x + 15, 13.5);
    }

    // 播放头
    const px = x0 + fr * pxf;
    ctx.strokeStyle = C.head;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(Math.round(px) + .5, 0); ctx.lineTo(Math.round(px) + .5, H); ctx.stroke();
    ctx.fillStyle = C.head;
    ctx.beginPath();
    ctx.moveTo(px - 6, 0); ctx.lineTo(px + 6, 0); ctx.lineTo(px, 9);
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = 1;
  }, []);

  /* 帧 / 标记 / 合成变化 → 重绘 */
  useEffect(() => { draw(); }, [draw, duration, fps, frame, marks]);

  /* 尺寸变化 → 重绘 */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  /* 主题切换 → 时间轴是 canvas，得重画一遍 */
  useEffect(() => onSettings(() => draw()), [draw]);

  const frameFromEvent = (e: React.PointerEvent): number => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return (e.clientX - rect.left) / pxPerFrameRef.current + scrollRef.current;
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    dragRef.current = true;
    canvasRef.current!.setPointerCapture(e.pointerId);
    onSeek(frameFromEvent(e));
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    if (dragRef.current) onSeek(frameFromEvent(e));
  };
  const onPointerUp = (e: React.PointerEvent): void => {
    dragRef.current = false;
    canvasRef.current!.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: React.WheelEvent): void => {
    e.preventDefault();
    const before = frameFromEvent(e as unknown as React.PointerEvent);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    pxPerFrameRef.current = Math.max(0.25, Math.min(24, pxPerFrameRef.current * factor));
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    scrollRef.current = Math.max(0, before - x / pxPerFrameRef.current);
    draw();
  };

  const zoomBy = (factor: number): void => {
    const W = canvasRef.current?.clientWidth ?? 800;
    const centerFrame = scrollRef.current + (W / 2) / pxPerFrameRef.current;
    pxPerFrameRef.current = Math.max(0.25, Math.min(24, pxPerFrameRef.current * factor));
    scrollRef.current = Math.max(0, centerFrame - (W / 2) / pxPerFrameRef.current);
    draw();
  };
  const zoomFit = (): void => {
    const W = canvasRef.current?.clientWidth ?? 800;
    pxPerFrameRef.current = Math.max(0.25, Math.min(24, (W - 24) / Math.max(1, stateRef.current.duration)));
    scrollRef.current = 0;
    draw();
  };

  const { frame: fr, fps: f } = stateRef.current;
  const totalSec = fr / f;
  const tc = `${String(Math.floor(totalSec / 60)).padStart(2, '0')}:${String(Math.floor(totalSec % 60)).padStart(2, '0')}:${String(fr % f).padStart(2, '0')}`;

  return (
    <div className="tl-root">
      <div className="tl-head">
        <span className="tl-label">时间轴</span>
        <span>拖动定位 · 滚轮缩放 · 空格播放</span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ color: 'var(--txt2)' }}>{tc}</span>
        <div className="vline" />
        <div className="tl-zoom">
          <button className="icon-btn" style={{ width: 24, height: 24 }} title="缩小" onClick={() => zoomBy(1 / 1.3)}><IconZoomOut size={14} /></button>
          <button className="icon-btn" style={{ width: 24, height: 24 }} title="适配全长" onClick={zoomFit}><IconFit size={13} /></button>
          <button className="icon-btn" style={{ width: 24, height: 24 }} title="放大" onClick={() => zoomBy(1.3)}><IconZoomIn size={14} /></button>
        </div>
        <div className="vline" />
        <span className="mono">{fps} fps</span>
      </div>
      <canvas
        ref={canvasRef}
        className="tl-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      />
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
