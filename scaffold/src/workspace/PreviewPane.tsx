import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { CompInfo } from '../core/types';
import { IconPlay, IconPause, IconLoop, IconStepBack, IconStepFwd, IconPrev, IconNext, IconZoomIn, IconZoomOut, IconFit, IconFocus, IconClose } from '../ui/icons';

/* 大监视器：iframe(srcdoc) 实时渲染 + 传输控制 + 缩放 + 专注模式 */

export type PreviewHandle = {
  seek: (frame: number) => void;
  getWindow: () => Window | null;
};

type Props = {
  srcDoc: string;
  reloadKey: number;
  onReady: () => void;
  frame: number;
  playing: boolean;
  loop: boolean;
  comp: CompInfo | null;
  onTogglePlay: () => void;
  onStep: (d: number) => void;
  onSeek: (f: number) => void;
  onToggleLoop: () => void;
};

function timecode(frame: number, fps: number): string {
  const totalSec = frame / fps;
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(Math.floor(totalSec % 60)).padStart(2, '0');
  const ff = String(frame % fps).padStart(2, '0');
  return `${mm}:${ss}:${ff}`;
}

export const PreviewPane = forwardRef<PreviewHandle, Props>(function PreviewPane(
  { srcDoc, onReady, frame, playing, loop, comp, onTogglePlay, onStep, onSeek, onToggleLoop }, ref
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState<'fit' | 'manual'>('fit');
  const [manual, setManual] = useState(1);
  const [focus, setFocus] = useState(false);
  const srcDocRef = useRef(srcDoc);
  srcDocRef.current = srcDoc;

  useImperativeHandle(ref, () => ({
    seek: (f: number) => {
      try {
        const w = iframeRef.current?.contentWindow as any;
        if (w && typeof w.__seek === 'function') w.__seek(f);
      } catch { /* 未就绪 */ }
    },
    getWindow: () => iframeRef.current?.contentWindow ?? null
  }));

  useEffect(() => {
    // srcDoc 变化 → iframe 重载 → load 后回调
    const ifr = iframeRef.current;
    if (!ifr) return;
    const onLoad = (): void => { onReady(); };
    ifr.addEventListener('load', onLoad);
    return () => ifr.removeEventListener('load', onLoad);
  }, [onReady]);

  /* 舞台尺寸跟踪 */
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setStageSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setStageSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /* 专注模式下 Esc 退出 */
  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setFocus(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus]);

  const pad = focus ? 48 : 28;
  const fitScale = comp && stageSize.w > 0
    ? Math.min((stageSize.w - pad) / comp.width, (stageSize.h - pad) / comp.height, 1.5)
    : 1;
  const scale = mode === 'fit' ? Math.max(0.02, fitScale) : manual;

  const zoomStep = (dir: 1 | -1): void => {
    const cur = mode === 'fit' ? fitScale : manual;
    const next = Math.min(4, Math.max(0.05, Math.round(cur * (dir > 0 ? 1.2 : 1 / 1.2) * 100) / 100));
    setManual(next);
    setMode('manual');
  };

  const btn = (el: React.ReactNode, active: boolean, title: string, onClick: () => void, keyName?: string): React.ReactNode => (
    <button className={`icon-btn ${active ? 'active' : ''}`} onClick={onClick} title={title} key={keyName}>
      {el}
    </button>
  );

  return (
    <div className={`preview-wrap ${focus ? 'focus' : ''}`}>
      <div className="preview-stage" ref={stageRef}>
        {srcDoc
          ? <iframe ref={iframeRef} title="预览" style={{
              width: comp?.width ?? 1280, height: comp?.height ?? 720,
              border: 'none', background: '#000',
              transform: `scale(${scale})`, transformOrigin: 'center',
              outline: 'none'
            }} srcDoc={srcDoc} sandbox="allow-scripts allow-same-origin" />
          : <div className="preview-empty">
              <IconPlay size={30} />
              <span>编译完成后在此预览</span>
            </div>}
        {focus && (
          <button className="icon-btn" style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(255,255,255,.08)', color: '#aab4c2' }}
            title="退出专注模式（Esc）" onClick={() => setFocus(false)}>
            <IconClose size={15} />
          </button>
        )}
      </div>
      <div className="preview-controls">
        {btn(<IconPrev size={15} />, false, '回到第一帧', () => onSeek(0), 'first')}
        {btn(<IconStepBack size={16} />, false, '上一帧（←）', () => onStep(-1), 'sb')}
        {btn(playing ? <IconPause size={16} /> : <IconPlay size={16} />, playing, '播放/暂停（空格）', onTogglePlay, 'play')}
        {btn(<IconStepFwd size={16} />, false, '下一帧（→）', () => onStep(1), 'sf')}
        {btn(<IconNext size={15} />, false, '跳到最后一帧', () => onSeek((comp?.durationInFrames ?? 1) - 1), 'last')}
        {btn(<IconLoop size={15} />, loop, '循环播放', onToggleLoop, 'loop')}
        <div className="vline" />
        {btn(<IconZoomOut size={15} />, false, '缩小', () => zoomStep(-1), 'zo')}
        <span className="zoom-label" title="点击恢复适应窗口" style={{ cursor: 'pointer' }}
          onClick={() => setMode('fit')}>{mode === 'fit' ? '适应' : `${Math.round(scale * 100)}%`}</span>
        {btn(<IconZoomIn size={15} />, false, '放大', () => zoomStep(1), 'zi')}
        {btn(<IconFit size={14} />, mode === 'fit', '适应窗口', () => setMode('fit'), 'fit')}
        <div style={{ flex: 1 }} />
        {btn(<IconFocus size={14} />, focus, '专注模式（Esc 退出）', () => setFocus((v) => !v), 'focus')}
        <div className="vline" />
        <span className="tc mono">帧 {frame} / {comp?.durationInFrames ?? 0} · {timecode(frame, comp?.fps ?? 30)}</span>
      </div>
    </div>
  );
});
