import React, { useState } from 'react';
import { api } from '../core/tauri';
import type { CompInfo, RenderProgress } from '../core/types';
import { mixTimelineWav, bytesToBase64, type AudioClip } from '../core/audio';
import { IconClose, IconMusic, IconLayers } from '../ui/icons';

/* 导出对话框：合成选择、画质、输出路径、音频混流、并行渲染。
 * 音频不再"没有"：导出前由 OfflineAudioContext 把整条时间线混成 WAV，
 * 再交给 ffmpeg 与逐帧画面合并。 */

type Props = {
  comp: CompInfo;
  projectDir: string;
  buildHtml: (compId: string) => Promise<string>;
  /** 预览 iframe 的 window（取音频描述 + 采样音量包络） */
  getPreviewWindow: () => Window | null;
  /** 工程里是否存在音频素材 */
  hasAudio: boolean;
  progress: RenderProgress | null;
  onClose: () => void;
};

export function ExportDialog({ comp, projectDir, buildHtml, getPreviewWindow, hasAudio, progress, onClose }: Props) {
  const [crf, setCrf] = useState(20);
  const [outPath, setOutPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [withAudio, setWithAudio] = useState(hasAudio);
  const [parallel, setParallel] = useState(false);
  const [parallelN, setParallelN] = useState(4);
  const [stage, setStage] = useState('');
  const [audioPct, setAudioPct] = useState(0);

  /* 把预览里的音频离线混成 WAV 临时文件，返回路径 */
  const buildAudioTrack = async (): Promise<string | null> => {
    const win = getPreviewWindow() as any;
    if (!win || typeof win.__collectAudio !== 'function') return null;
    win.__setPlaying?.(false);
    const clips: AudioClip[] = (win.__collectAudio() || []).filter((c: AudioClip) => !!c.src);
    if (clips.length === 0) return null;

    setStage('离线混音');
    setAudioPct(0);
    const wav = await mixTimelineWav({
      clips,
      totalFrames: comp.durationInFrames,
      fps: comp.fps,
      sampleStep: 3,
      sampleVolumes: async (f: number) => {
        win.__seek(f);
        return win.__audioVolumes?.() ?? [];
      },
      onProgress: (d, t) => setAudioPct(t ? Math.round((d / t) * 100) : 0)
    });
    const tmp = projectDir.replace(/[\\/]+$/, '') + '/out/.tempus-audio.wav';
    await api.fsWriteBytes(tmp, bytesToBase64(wav));
    setStage('混音完成');
    return tmp;
  };

  const start = async (): Promise<void> => {
    setBusy(true); setError(''); setDone('');
    try {
      let target = outPath;
      if (!target) target = projectDir + '/out/' + comp.id + '.mp4';
      const html = await buildHtml(comp.id);

      let audioPath: string | null = null;
      if (withAudio) {
        try { audioPath = await buildAudioTrack(); }
        catch (e) { setError('音频混流失败，将导出无声视频：' + String(e)); }
      }

      setStage('逐帧渲染');
      const real = await api.renderExport({
        html, comp, outPath: target, crf, projectDir,
        audioPath,
        parallel: parallel ? parallelN : 1
      });
      setDone(real);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setStage('');
    }
  };

  const chooseFile = async (): Promise<void> => {
    const p = await api.pickSaveFile('选择输出位置', comp.id + '.mp4', 'mp4');
    if (p) setOutPath(p);
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.frame / progress.total) * 100) : 0;
  const rendering = busy || (progress != null && !progress.done && !done);

  return (
    <div className="modal-mask" onClick={rendering ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>导出 MP4</h3>
          {!rendering && <button className="icon-btn" onClick={onClose}><IconClose /></button>}
        </div>

        <div className="form-row">
          <label>合成</label>
          <div className="grow"><b>{comp.id}</b> · {comp.width}×{comp.height} · {comp.fps}fps · {comp.durationInFrames} 帧</div>
        </div>
        <div className="form-row">
          <label>画质 CRF</label>
          <input type="range" min={14} max={30} value={crf} onChange={(e) => setCrf(Number(e.target.value))} className="grow" disabled={rendering} />
          <span className="mono" style={{ width: 34, textAlign: 'right' }}>{crf}</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--txt3)', margin: '-6px 0 12px 94px' }}>数值越小画质越高、文件越大（14 近无损，23 常用）</div>

        <div className="form-row">
          <label>音轨</label>
          <label className={`switch-row ${!hasAudio ? 'dis' : ''}`}>
            <input type="checkbox" checked={withAudio} disabled={!hasAudio || rendering} onChange={(e) => setWithAudio(e.target.checked)} />
            <IconMusic size={13} />
            <span>{hasAudio ? '把音频混进视频（离线混音）' : '工程里没有音频素材'}</span>
          </label>
        </div>

        <div className="form-row">
          <label>并行</label>
          <label className="switch-row">
            <input type="checkbox" checked={parallel} disabled={rendering} onChange={(e) => setParallel(e.target.checked)} />
            <IconLayers size={13} />
            <span>分段并行渲染</span>
          </label>
          {parallel && (
            <>
              <input type="number" min={2} max={8} value={parallelN} disabled={rendering}
                onChange={(e) => setParallelN(Math.max(2, Math.min(8, Number(e.target.value) || 4)))}
                style={{ width: 62 }} />
              <span style={{ fontSize: 11.5, color: 'var(--txt3)' }}>路</span>
            </>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--txt3)', margin: '-6px 0 12px 94px' }}>
          并行会同时开多个无头浏览器分段渲染再拼接，吃 CPU；机器弱就关掉
        </div>

        <div className="form-row">
          <label>输出到</label>
          <input type="text" className="grow mono" placeholder={projectDir + '/out/' + comp.id + '.mp4'}
            value={outPath} onChange={(e) => setOutPath(e.target.value)} disabled={rendering} />
          <button className="btn" onClick={chooseFile} disabled={rendering}>浏览</button>
        </div>

        {rendering && (
          <>
            {stage === '离线混音' && (
              <>
                <div className="progress-track"><div style={{ width: `${audioPct}%` }} /></div>
                <div style={{ fontSize: 12, color: 'var(--txt2)' }}>离线混音 {audioPct}%（采样音量包络）</div>
              </>
            )}
            {progress && progress.total > 0 && stage !== '离线混音' && (
              <>
                <div className="progress-track"><div style={{ width: `${pct}%` }} /></div>
                <div style={{ fontSize: 12, color: 'var(--txt2)' }}>
                  {progress.stage} 第 {progress.frame} / {progress.total} 帧（{pct}%）
                </div>
              </>
            )}
          </>
        )}
        {done && <div style={{ color: 'var(--ok)', fontSize: 13, margin: '8px 0' }}>导出完成：{done}</div>}
        {error && <div style={{ color: 'var(--danger)', fontSize: 12.5, margin: '8px 0', whiteSpace: 'pre-wrap' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
          {rendering
            ? <button className="btn" onClick={() => api.renderCancel()}>取消渲染</button>
            : <>
              {done && <button className="btn" onClick={() => api.openPath(done.replace(/[\\/][^\\/]+$/, ''))}>打开所在文件夹</button>}
              <button className="btn" onClick={onClose}>关闭</button>
              <button className="btn primary" onClick={start}>开始导出</button>
            </>}
        </div>
      </div>
    </div>
  );
}
