import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { waveform, type WavePeaks } from '../core/audio';
import { mediaUrl } from '../core/media';
import { IconMusic, IconRefresh, IconPlay, IconPause } from '../ui/icons';

/* 音频监视器（第二个监视器）。
 *
 * 它是"长条"：没有画幅比例，横铺满、按真实时间轴对齐当前合成时长。
 * 波形不是装饰 —— 是浏览器把音频文件真解码后的峰值；多条音频会叠着画。
 * 右侧电平表读的是同一份峰值数据在"当前帧"处的真实振幅，不是随机跑的动画。
 *
 * 这个组件的目标是「不打开文件也能判断声音对不对」：
 *   有没有文件、文件能不能解码、在时间轴的哪个位置有声、某个时刻有多响。 */

export type ScopeFile = { rel: string; abs: string };

type Props = {
  files: ScopeFile[];
  fps: number;
  durationFrames: number;
  frame: number;
  onSeek?: (f: number) => void;
  /** 预览里音频加载失败的路径（来自 iframe 上报），用于显式告警 */
  failed?: string[];
};

const peakCache = new Map<string, WavePeaks>();
const COLORS = ['#1f6feb', '#0fa3a3', '#7a5af5', '#e0723c', '#3a9b52', '#c0399b'];
const BUCKETS = 1600;

export function AudioScope({ files, fps, durationFrames, frame, onSeek, failed }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<Record<string, WavePeaks>>({});
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [trial, setTrial] = useState<'idle' | 'playing'>('idle');
  const dragRef = useRef(false);
  const trialRef = useRef<HTMLAudioElement | null>(null);
  const holdRef = useRef(0);
  const holdTickRef = useRef(0);

  /* 全部文件并行解码；已缓存的直接命中 */
  useEffect(() => {
    let alive = true;
    const missing = files.filter((f) => !peakCache.has(f.abs));
    const cached: Record<string, WavePeaks> = {};
    for (const f of files) {
      const hit = peakCache.get(f.abs);
      if (hit) cached[f.abs] = hit;
    }
    if (Object.keys(cached).length) setPeaks((p) => ({ ...p, ...cached }));
    if (!missing.length) return;

    setLoading(true);
    void Promise.all(missing.map(async (f) => {
      const w = await waveform(f.abs, BUCKETS);
      peakCache.set(f.abs, w);
      return [f.abs, w] as const;
    })).then((arr) => {
      if (!alive) return;
      setPeaks((p) => {
        const next = { ...p };
        for (const [k, v] of arr) next[k] = v;
        return next;
      });
    }).finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [files]);

  const tracks = useMemo(
    () => files.map((f, i) => ({
      ...f,
      i,
      color: COLORS[i % COLORS.length],
      data: peaks[f.abs] ?? null,
      on: !muted[f.abs]
    })),
    [files, peaks, muted]
  );

  const totalSec = Math.max(0.001, durationFrames / fps);
  const curSec = frame / fps;

  /* 当前帧的真实振幅（多轨取最大，视觉上等价于混合后的包络） */
  const level = useMemo(() => {
    let m = 0;
    for (const t of tracks) {
      if (!t.on || !t.data?.ok) continue;
      const p = t.data.peaks;
      const idx = Math.round((curSec / Math.max(0.001, t.data.durationSec)) * p.length);
      const i0 = Math.max(0, Math.min(p.length - 1, idx - 2));
      const i1 = Math.max(0, Math.min(p.length - 1, idx + 2));
      for (let i = i0; i <= i1; i++) if (p[i] > m) m = p[i];
    }
    return m;
  }, [tracks, curSec]);

  const draw = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (W === 0 || H === 0) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const dark = document.documentElement.dataset.theme === 'dark';
    const meterW = 26;
    const plotW = Math.max(10, W - meterW);
    const pxPerSec = plotW / totalSec;
    const mid = H / 2;
    const pad = 6;
    const half = (H - pad * 2) / 2;

    /* 底纹：每秒/每 5 秒的竖线 */
    ctx.strokeStyle = dark ? 'rgba(255,255,255,.05)' : 'rgba(24,34,48,.05)';
    const stepSec = pxPerSec > 110 ? 1 : pxPerSec > 46 ? 2 : pxPerSec > 18 ? 5 : 10;
    for (let s = 0; s <= totalSec; s += stepSec) {
      const x = Math.round(s * pxPerSec) + .5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }

    /* 零线 */
    ctx.strokeStyle = dark ? 'rgba(255,255,255,.10)' : 'rgba(24,34,48,.10)';
    ctx.beginPath(); ctx.moveTo(0, Math.round(mid) + .5); ctx.lineTo(plotW, Math.round(mid) + .5); ctx.stroke();

    const usable = tracks.filter((t) => t.on && t.data?.ok);
    if (!usable.length) {
      ctx.fillStyle = dark ? 'rgba(160,172,190,.75)' : 'rgba(110,124,140,.85)';
      ctx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.textBaseline = 'middle';
      const msg = files.length === 0
        ? '工程里还没有音频 —— 把 mp3 / wav 放进工程目录（assets/），或在资源管理器里拖进来'
        : loading ? '正在解码波形……' : '音频解码失败（格式不被浏览器支持？）';
      ctx.fillText(msg, 12, mid - 10);
      return;
    }

    /* 多轨叠加：每条轨用不同色，半透明叠加，越叠越亮 */
    for (const t of usable) {
      const data = t.data!;
      const audioW = Math.min(plotW, data.durationSec * pxPerSec);
      const n = data.peaks.length;
      const bars = Math.max(1, Math.floor(audioW));

      const grad = ctx.createLinearGradient(0, pad, 0, H - pad);
      grad.addColorStop(0, `${t.color}66`);
      grad.addColorStop(0.5, `${t.color}dd`);
      grad.addColorStop(1, `${t.color}66`);
      ctx.fillStyle = grad;

      for (let x = 0; x < bars; x++) {
        const i0 = Math.floor((x / bars) * n);
        const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / bars) * n));
        let m = 0;
        for (let i = i0; i < i1 && i < n; i++) if (data.peaks[i] > m) m = data.peaks[i];
        const h = Math.max(1, m * half * 2 * 0.94);
        ctx.fillRect(x, mid - h / 2, 1, h);
      }

      /* 音频没铺满整条时间线的尾段：淡色标出来 */
      if (audioW < plotW - 1) {
        ctx.fillStyle = dark ? 'rgba(255,255,255,.03)' : 'rgba(24,34,48,.025)';
        ctx.fillRect(audioW, 0, plotW - audioW, H);
      }
    }

    /* 播放头（带光晕） */
    const px = curSec * pxPerSec;
    const head = dark ? '#ff7b80' : '#e5484d';
    const glow = ctx.createLinearGradient(px - 10, 0, px + 10, 0);
    glow.addColorStop(0, 'rgba(229,72,77,0)');
    glow.addColorStop(0.5, dark ? 'rgba(255,123,128,.22)' : 'rgba(229,72,77,.16)');
    glow.addColorStop(1, 'rgba(229,72,77,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(px - 10, 0, 20, H);
    ctx.strokeStyle = head;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(Math.round(px) + .5, 0); ctx.lineTo(Math.round(px) + .5, H); ctx.stroke();
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 8);
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = 1;

    /* 右侧电平表：当前帧的真实振幅 + 峰值保持 */
    const holdDecay = 0.015;
    const prevHold = holdRef.current;
    holdRef.current = Math.max(level, prevHold - holdDecay);
    holdTickRef.current = 0;

    const mx = plotW + 8;
    const mw = 10;
    ctx.fillStyle = dark ? 'rgba(255,255,255,.06)' : 'rgba(24,34,48,.06)';
    ctx.fillRect(mx, pad, mw, H - pad * 2);
    const lvH = Math.max(0, Math.min(1, level)) * (H - pad * 2);
    const lvGrad = ctx.createLinearGradient(0, H - pad, 0, pad);
    lvGrad.addColorStop(0, '#3fbe76');
    lvGrad.addColorStop(0.62, '#e0a54a');
    lvGrad.addColorStop(1, '#f0686d');
    ctx.fillStyle = lvGrad;
    ctx.fillRect(mx, H - pad - lvH, mw, lvH);
    const hd = Math.max(0, Math.min(1, holdRef.current)) * (H - pad * 2);
    if (hd > 1) {
      ctx.fillStyle = dark ? 'rgba(255,255,255,.7)' : 'rgba(24,34,48,.55)';
      ctx.fillRect(mx, H - pad - hd - 1, mw, 1.5);
    }

    /* 时间刻度（放最上层，避免被波形盖住） */
    ctx.fillStyle = dark ? 'rgba(160,172,190,.55)' : 'rgba(110,124,140,.7)';
    ctx.font = '10px Consolas, monospace';
    ctx.textBaseline = 'top';
    for (let s = 0; s <= totalSec; s += stepSec) {
      const x = s * pxPerSec;
      if (x < plotW - 30) ctx.fillText(`${s}s`, x + 4, H - 13);
    }
  }, [tracks, totalSec, curSec, level, loading, files.length]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  /* 卸下时停掉试听 */
  useEffect(() => () => {
    trialRef.current?.pause();
    trialRef.current = null;
  }, []);

  const seekAt = (clientX: number): void => {
    if (!onSeek) return;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const meterW = 26;
    const plotW = Math.max(10, rect.width - meterW);
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / plotW));
    onSeek(Math.round(ratio * durationFrames));
  };

  /* 试听：不经过时间线，直接播选中文件（或第一条），用于确认"这个文件本身对不对" */
  const toggleTrial = async (): Promise<void> => {
    if (trial === 'playing') {
      trialRef.current?.pause();
      trialRef.current = null;
      setTrial('idle');
      return;
    }
    const target = files.find((f) => !muted[f.abs]) ?? files[0];
    if (!target) return;
    try {
      const url = await mediaUrl(target.abs);
      const a = new Audio(url);
      a.volume = 0.9;
      a.onended = () => { setTrial('idle'); trialRef.current = null; };
      trialRef.current = a;
      await a.play();
      setTrial('playing');
    } catch {
      setTrial('idle');
    }
  };

  const okCount = tracks.filter((t) => t.data?.ok).length;
  const failedSet = new Set((failed ?? []).map((s) => s.replace(/\\/g, '/').toLowerCase()));
  const failCount = files.filter((f) => failedSet.has(f.abs.replace(/\\/g, '/').toLowerCase())
    || failedSet.has(f.rel.toLowerCase())).length;

  return (
    <div className="scope-wrap">
      <div className="scope-head">
        <IconMusic size={13} />
        <span className="scope-title">音频监视</span>

        <div className="scope-chips">
          {tracks.map((t) => (
            <button
              key={t.abs}
              type="button"
              className={`scope-chip ${t.on ? 'on' : ''} ${t.data && !t.data.ok ? 'bad' : ''}`}
              title={`${t.rel}${t.data?.ok ? ` · ${t.data.durationSec.toFixed(2)}s` : '（解码失败）'}· 点击显示/隐藏`}
              onClick={() => setMuted((m) => ({ ...m, [t.abs]: !m[t.abs] }))}
              style={{ ['--chip' as string]: t.color }}
            >
              <i />
              {t.rel.split('/').pop()}
            </button>
          ))}
          {files.length === 0 && <span className="scope-none">未检测到音频文件</span>}
        </div>

        <div style={{ flex: 1 }} />

        {loading && <span className="scope-meta">解码中…</span>}
        {!loading && files.length > 0 && (
          <span className="scope-meta mono">{okCount}/{files.length} 可用 · 时间轴 {totalSec.toFixed(1)}s</span>
        )}
        {failCount > 0 && <span className="scope-warn" title="预览里这些音频没有加载成功">{failCount} 个加载失败</span>}

        {files.length > 0 && (
          <button className="icon-btn" style={{ width: 22, height: 22 }} title="试听（直接播文件本身）" onClick={() => void toggleTrial()}>
            {trial === 'playing' ? <IconPause size={12} /> : <IconPlay size={12} />}
          </button>
        )}
        {files.length > 0 && (
          <button className="icon-btn" style={{ width: 22, height: 22 }} title="重新解码全部波形"
            onClick={() => { for (const f of files) peakCache.delete(f.abs); setPeaks({}); }}>
            <IconRefresh size={12} />
          </button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className="scope-canvas"
        onPointerDown={(e) => { dragRef.current = true; e.currentTarget.setPointerCapture(e.pointerId); seekAt(e.clientX); }}
        onPointerMove={(e) => { if (dragRef.current) seekAt(e.clientX); }}
        onPointerUp={(e) => { dragRef.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }}
      />
    </div>
  );
}
