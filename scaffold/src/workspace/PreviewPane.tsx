import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { CompInfo } from '../core/types';
import { AudioScope, type ScopeFile } from './AudioScope';
import { IconPlay, IconPause, IconLoop, IconStepBack, IconStepFwd, IconPrev, IconNext, IconZoomIn, IconZoomOut, IconFit, IconFocus, IconClose, IconVolume, IconVolumeMute } from '../ui/icons';

/* 双监视器：上面是画面监视器（iframe srcdoc 实时渲染，尺寸随合成画幅），
 * 下面是音频示波器（长条、无画幅比例、真实波形）。两者共用同一个播放头。 */

export type PreviewHandle = {
  seek: (frame: number) => void;
  getWindow: () => Window | null;
  setPlaying: (p: boolean) => void;
};

type Props = {
  srcDoc: string;
  reloadKey: number;
  onReady: () => void;
  frame: number;
  playing: boolean;
  loop: boolean;
  comp: CompInfo | null;
  audioFiles: ScopeFile[];
  /** 预览里加载失败的音频路径（iframe 上报） */
  audioFailed?: string[];
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
  { srcDoc, onReady, frame, playing, loop, comp, audioFiles, audioFailed, onTogglePlay, onStep, onSeek, onToggleLoop }, ref
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState<'fit' | 'manual'>('fit');
  const [manual, setManual] = useState(1);
  const [focus, setFocus] = useState(false);
  const srcDocRef = useRef(srcDoc);
  srcDocRef.current = srcDoc;

  /* 预览主音量：存本地，重载后自动重放（用户代码里的 volume 是相对值，不受影响） */
  const [vol, setVol] = useState(() => {
    const v = Number(localStorage.getItem('tempus.masterVol') ?? '1');
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  });
  const volRef = useRef(vol);
  volRef.current = vol;

  const applyVol = (): void => {
    try {
      const w = iframeRef.current?.contentWindow as any;
      w?.__setMasterVolume?.(volRef.current);
    } catch { /* 未就绪 */ }
  };

  useEffect(() => {
    applyVol();
    try { localStorage.setItem('tempus.masterVol', String(vol)); } catch { /* 忽略 */ }
  }, [vol]);

  useImperativeHandle(ref, () => ({
    seek: (f: number) => {
      try {
        const w = iframeRef.current?.contentWindow as any;
        if (w && typeof w.__seek === 'function') w.__seek(f);
      } catch { /* 未就绪 */ }
    },
    getWindow: () => iframeRef.current?.contentWindow ?? null,
    setPlaying: (p: boolean) => {
      try {
        const w = iframeRef.current?.contentWindow as any;
        if (w && typeof w.__setPlaying === 'function') w.__setPlaying(p);
      } catch { /* 未就绪 */ }
    }
  }));

  /* 播放状态透传给运行时，音频据此决定「自己走」还是「跟随 seek」 */
  useEffect(() => {
    const w = iframeRef.current?.contentWindow as any;
    try {
      if (w && typeof w.__setPlaying === 'function') w.__setPlaying(playing);
    } catch { /* 未就绪 */ }
  }, [playing]);

  useEffect(() => {
    // srcDoc 变化 → iframe 重载 → load 后回调
    const ifr = iframeRef.current;
    if (!ifr) return;
    const onLoad = (): void => { onReady(); applyVol(); };
    ifr.addEventListener('load', onLoad);
    return () => ifr.removeEventListener('load', onLoad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /* M = 预览静音 / 取消静音（在编辑器里打字时不抢） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'KeyM' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (t?.closest?.('.monaco-editor')) return;
      e.preventDefault();
      setVol((v) => (v === 0 ? 1 : 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  /* Ctrl/⌘ + 滚轮缩放：必须用原生监听（React 的 onWheel 是 passive，preventDefault 无效）。
   * 缩放基准放进 ref，避免每次缩放都重挂监听器。 */
  const zoomRef = useRef({ fit: fitScale, manual, mode });
  zoomRef.current = { fit: fitScale, manual, mode };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const st = zoomRef.current;
      const cur = st.mode === 'fit' ? st.fit : st.manual;
      const dir = e.deltaY < 0 ? 1 : -1;
      const next = Math.min(4, Math.max(0.05,
        Math.round(cur * (dir > 0 ? 1.12 : 1 / 1.12) * 100) / 100));
      setManual(next);
      setMode('manual');
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

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
        <button
          className={`icon-btn ${vol === 0 ? 'active' : ''}`}
          title={vol === 0 ? '取消静音（M）' : '静音预览（M）'}
          onClick={() => setVol(vol === 0 ? 1 : 0)}
        >
          {vol === 0 ? <IconVolumeMute size={15} /> : <IconVolume size={15} />}
        </button>
        <input
          type="range" className="vol-slider" min={0} max={100} step={1}
          value={Math.round(vol * 100)}
          title={`预览音量 ${Math.round(vol * 100)}%`}
          onChange={(e) => setVol(Number(e.target.value) / 100)}
        />
        <div className="vline" />
        <span className="tc mono">帧 {frame} / {comp?.durationInFrames ?? 0} · {timecode(frame, comp?.fps ?? 30)}</span>
      </div>
      {/* 第二个监视器：音频示波器（长条，始终可见） */}
      <AudioScope
        files={audioFiles}
        failed={audioFailed}
        fps={comp?.fps ?? 30}
        durationFrames={comp?.durationInFrames ?? 0}
        frame={frame}
        onSeek={onSeek}
      />
    </div>
  );
});
