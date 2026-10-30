import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../core/tauri';
import type { CompInfo } from '../core/types';
import type { ScopeFile } from './AudioScope';
import { IconClose, IconFilm, IconMusic, IconLayers, IconPlay } from '../ui/icons';

/* 序列器（多文件合并渲染）：
 *
 * 左轨 = 画面，从上到下就是播放顺序（越靠上越早）
 * 右轨 = 音频，一条配乐铺满整条成片
 * 导出时一段一段渲染，最后 ffmpeg concat 成一条。
 *
 * 这个页面会整块盖住代码区 —— 它是一次性的"排片"操作，不是日常编辑。 */

type Item = { id: string; on: boolean };

type Props = {
  comps: CompInfo[];
  projectDir: string;
  audioFiles: ScopeFile[];
  buildHtml: (compId: string) => Promise<string>;
  onClose: () => void;
};

const TIP_KEY = 'tempus.sequencer.tip.v1';

export function Sequencer({ comps, projectDir, audioFiles, buildHtml, onClose }: Props) {
  const [items, setItems] = useState<Item[]>(() => comps.map((c) => ({ id: c.id, on: true })));
  const [audio, setAudio] = useState<string>(audioFiles[0]?.abs ?? '');
  const [crf, setCrf] = useState(20);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [showTip, setShowTip] = useState(() => {
    try { return localStorage.getItem(TIP_KEY) !== '1'; } catch { return true; }
  });
  const dragIdx = useRef<number>(-1);

  /* 合成列表更新后补进序列（不删用户已有的排序） */
  useEffect(() => {
    setItems((prev) => {
      const known = new Set(prev.map((p) => p.id));
      const add = comps.filter((c) => !known.has(c.id)).map((c) => ({ id: c.id, on: true }));
      return [...prev.filter((p) => comps.some((c) => c.id === p.id)), ...add];
    });
  }, [comps]);

  const dismissTip = (): void => {
    setShowTip(false);
    try { localStorage.setItem(TIP_KEY, '1'); } catch { /* 忽略 */ }
  };

  const move = (from: number, to: number): void => {
    if (to < 0 || to >= items.length || from === to) return;
    setItems((prev) => {
      const next = [...prev];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    });
  };

  const enabled = useMemo(() => items.filter((i) => i.on), [items]);
  const totalFrames = useMemo(
    () => enabled.reduce((s, i) => s + (comps.find((c) => c.id === i.id)?.durationInFrames ?? 0), 0),
    [enabled, comps]
  );
  const fps = comps[0]?.fps ?? 30;
  const totalSec = totalFrames / fps;

  const start = async (): Promise<void> => {
    if (!enabled.length) { setError('至少选一个片段'); return; }
    setBusy(true); setError(''); setDone('');
    const outRoot = projectDir.replace(/[\\/]+$/, '') + '/out';
    const segs: string[] = [];
    try {
      for (let i = 0; i < enabled.length; i++) {
        const comp = comps.find((c) => c.id === enabled[i].id);
        if (!comp) continue;
        setStage(`渲染 ${i + 1}/${enabled.length} · ${comp.id}`);
        const html = await buildHtml(comp.id);
        const seg = `${outRoot}/.seq-${i}.mp4`;
        await api.renderExport({ html, comp, outPath: seg, crf, projectDir });
        segs.push(seg);
      }
      setStage('拼接成片');
      const final = `${outRoot}/sequence-${new Date().toISOString().slice(0, 10)}-${Date.now().toString().slice(-5)}.mp4`;
      await api.videoConcat(segs, final, audio || null);
      setDone(final);
      setStage('');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="seq-root">
      <div className="seq-top">
        <IconLayers size={16} />
        <b>序列器</b>
        <span className="seq-sub">把多个画面文件按顺序拼成一条成片</span>
        <div style={{ flex: 1 }} />
        <span className="mono seq-meta">{enabled.length} 段 · {totalSec.toFixed(1)} 秒 · {fps}fps</span>
        <button className="icon-btn" onClick={onClose} title="关闭（Esc）" disabled={busy}>
          <IconClose size={15} />
        </button>
      </div>

      {showTip && (
        <div className="seq-tip">
          <b>第一次用？</b> 左边是画面轨，从上往下就是播放顺序 —— 拖住任意一段上下拖就能调顺序；
          右边选一条配乐，它会铺满整条成片。点「开始合成」后逐个渲染再拼接。
          <button className="btn ghost small" onClick={dismissTip}>知道了</button>
        </div>
      )}

      <div className="seq-body">
        <div className="seq-track">
          <div className="seq-track-head">
            <IconFilm size={13} />
            <span>画面轨</span>
            <span className="seq-track-hint">拖动排序 · 从上到下依次播放</span>
          </div>
          <div className="seq-list">
            {items.map((it, i) => {
              const c = comps.find((x) => x.id === it.id);
              const idxInEnabled = enabled.findIndex((e) => e.id === it.id);
              return (
                <div
                  key={it.id}
                  className={`seq-item ${it.on ? '' : 'off'} ${dragIdx.current === i ? 'dragging' : ''}`}
                  draggable={!busy}
                  onDragStart={() => { dragIdx.current = i; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragIdx.current >= 0) move(dragIdx.current, i); dragIdx.current = -1; }}
                  onDragEnd={() => { dragIdx.current = -1; }}
                >
                  <span className="seq-grip" title="拖动排序">⋮⋮</span>
                  <span className="seq-order mono">{it.on ? String(idxInEnabled + 1).padStart(2, '0') : '—'}</span>
                  <span className="seq-name" title={it.id}>{it.id}</span>
                  <span className="seq-dim mono">
                    {c ? `${c.width}×${c.height} · ${(c.durationInFrames / c.fps).toFixed(1)}s` : '—'}
                  </span>
                  <label className="switch-row">
                    <input type="checkbox" checked={it.on} disabled={busy}
                      onChange={(e) => setItems((prev) => prev.map((p) => p.id === it.id ? { ...p, on: e.target.checked } : p))} />
                    <span>包含</span>
                  </label>
                </div>
              );
            })}
            {items.length === 0 && (
              <div className="seq-empty">工程里还没有注册任何合成（registerComposition），先去写一个画面文件。</div>
            )}
          </div>
        </div>

        <div className="seq-track seq-audio">
          <div className="seq-track-head">
            <IconMusic size={13} />
            <span>音频轨</span>
          </div>
          <div className="seq-audio-box">
            {audioFiles.length === 0 ? (
              <div className="seq-empty">工程里没有音频文件</div>
            ) : (
              <>
                <select className="scope-select" value={audio} disabled={busy}
                  onChange={(e) => setAudio(e.target.value)} style={{ width: '100%', height: 26 }}>
                  <option value="">（不配音）</option>
                  {audioFiles.map((f) => <option key={f.abs} value={f.abs}>{f.rel}</option>)}
                </select>
                <div className="seq-audio-bar">
                  <div className="seq-audio-fill" style={{ height: `${Math.min(100, totalSec ? 100 : 0)}%` }} />
                  <span className="mono">{totalSec.toFixed(1)}s</span>
                </div>
                <div className="seq-audio-hint">配乐铺满整条成片（不做裁剪）</div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="seq-foot">
        <label className="switch-row">
          画质 CRF
          <input type="range" min={14} max={30} value={crf} disabled={busy}
            onChange={(e) => setCrf(Number(e.target.value))} style={{ width: 120 }} />
          <span className="mono">{crf}</span>
        </label>
        <div style={{ flex: 1 }} />
        {stage && <span className="seq-stage">{stage}</span>}
        {error && <span style={{ color: 'var(--danger)', fontSize: 12, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={error}>{error}</span>}
        {done && <button className="btn small" onClick={() => api.openPath(done.replace(/[\\/][^\\/]+$/, ''))}>打开输出文件夹</button>}
        <button className="btn small" onClick={onClose} disabled={busy}>关闭</button>
        <button className="btn primary small" onClick={() => void start()} disabled={busy || !enabled.length}>
          <IconPlay size={13} /> {busy ? '合成中……' : '开始合成'}
        </button>
      </div>
    </div>
  );
}
