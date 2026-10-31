import React from 'react';
import { FRAME_PRESETS, type FramePreset } from '../core/frame';

/* 画幅选择：新建/首次进入工程时先定"片子是多大"。
 * 监视器随后就是这个尺寸 —— 它不是一个装饰性设置，而是合成画布的真实分辨率。 */

export { FRAME_PRESETS };
export type { FramePreset };

/** 卡片里的比例示意：限制最长边 46px */
const box = (w: number, h: number, max = 46): React.CSSProperties => {
  const k = max / Math.max(w, h);
  return { width: Math.round(w * k), height: Math.round(h * k) };
};

/** 画幅卡片网格：新建工程对话框与独立弹窗共用同一个选择器 */
export function FrameGrid({ value, onPick, max }: {
  value: { width: number; height: number };
  onPick: (w: number, h: number, id: string) => void;
  max?: number;
}) {
  return (
    <div className="fp-grid">
      {FRAME_PRESETS.map((p) => {
        const active = value.width === p.w && value.height === p.h;
        return (
          <button
            key={p.id}
            type="button"
            className={`fp-card ${active ? 'active' : ''}`}
            onClick={() => onPick(p.w, p.h, p.id)}
          >
            <span className="fp-thumb"><i style={box(p.w, p.h, max)} /></span>
            <span className="fp-name">{p.name}</span>
            <span className="fp-dim mono">{p.w} × {p.h}</span>
            <span className="fp-use">{p.use}</span>
          </button>
        );
      })}
    </div>
  );
}

type Props = {
  onPick: (w: number, h: number, id: string) => void;
  onSkip: () => void;
  current?: { width: number; height: number } | null;
};

export function FramePicker({ onPick, onSkip, current }: Props) {
  return (
    <div className="modal-mask dialog-mask">
      <div className="dialog wide frame-picker" role="dialog" aria-modal="true">
        <div className="dialog-title">这条片子是多大？</div>
        <div className="fp-sub">
          选好画幅，监视器、新建文件模板、导出尺寸都会用它。已有合成里写死的 width/height 不会被改。
        </div>
        <FrameGrid value={current ?? { width: 0, height: 0 }} onPick={onPick} />
        <div className="dialog-actions">
          <button className="btn ghost small" onClick={onSkip}>稍后再说</button>
        </div>
      </div>
    </div>
  );
}
