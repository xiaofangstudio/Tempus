import React, { useState } from 'react';
import { api } from '../core/tauri';
import type { CompInfo, RenderProgress } from '../core/types';
import { IconClose } from '../ui/icons';

/* 导出对话框：合成选择、画质、输出路径；进度走 render-progress 事件 */

type Props = {
  comp: CompInfo;
  projectDir: string;
  buildHtml: (compId: string) => Promise<string>;
  progress: RenderProgress | null;
  onClose: () => void;
};

export function ExportDialog({ comp, projectDir, buildHtml, progress, onClose }: Props) {
  const [crf, setCrf] = useState(20);
  const [outPath, setOutPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const start = async (): Promise<void> => {
    setBusy(true); setError(''); setDone('');
    try {
      let target = outPath;
      if (!target) target = projectDir + '/out/' + comp.id + '.mp4';
      const html = await buildHtml(comp.id);
      const real = await api.renderExport({ html, comp, outPath: target, crf, projectDir });
      setDone(real);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
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
          <label>输出到</label>
          <input type="text" className="grow mono" placeholder={projectDir + '/out/' + comp.id + '.mp4'}
            value={outPath} onChange={(e) => setOutPath(e.target.value)} disabled={rendering} />
          <button className="btn" onClick={chooseFile} disabled={rendering}>浏览</button>
        </div>

        {rendering && progress && progress.total > 0 && (
          <>
            <div className="progress-track"><div style={{ width: `${pct}%` }} /></div>
            <div style={{ fontSize: 12, color: 'var(--txt2)' }}>
              {progress.stage} 第 {progress.frame} / {progress.total} 帧（{pct}%）
            </div>
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
