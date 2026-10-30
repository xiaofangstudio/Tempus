import React from 'react';

/* 画幅选择：新建/首次进入工程时先定"片子是多大"。
 * 监视器随后就是这个尺寸 —— 它不是一个装饰性设置，而是合成画布的真实分辨率。 */

export type FramePreset = { id: string; w: number; h: number; name: string; use: string };

export const FRAME_PRESETS: FramePreset[] = [
  { id: '16:9', w: 1920, h: 1080, name: '横屏 16:9', use: 'B 站 / YouTube' },
  { id: '9:16', w: 1080, h: 1920, name: '竖屏 9:16', use: '抖音 / 视频号' },
  { id: '1:1', w: 1080, h: 1080, name: '方形 1:1', use: '朋友圈 / Instagram' },
  { id: '4:5', w: 1080, h: 1350, name: '竖版 4:5', use: '小红书' },
  { id: '2.39:1', w: 1920, h: 804, name: '宽银幕 2.39:1', use: '电影感' },
  { id: '4:3', w: 1440, h: 1080, name: '复古 4:3', use: '老片质感' }
];

type Props = {
  onPick: (w: number, h: number, id: string) => void;
  onSkip: () => void;
  current?: { width: number; height: number } | null;
};

export function FramePicker({ onPick, onSkip, current }: Props) {
  /* 卡片里的比例示意：限制最长边 46px */
  const box = (w: number, h: number): React.CSSProperties => {
    const k = 46 / Math.max(w, h);
    return { width: Math.round(w * k), height: Math.round(h * k) };
  };

  return (
    <div className="modal-mask dialog-mask">
      <div className="dialog wide frame-picker" role="dialog" aria-modal="true">
        <div className="dialog-title">这条片子是多大？</div>
        <div className="fp-sub">
          选好画幅，监视器、新建文件模板、导出尺寸都会用它。已有合成里写死的 width/height 不会被改。
        </div>
        <div className="fp-grid">
          {FRAME_PRESETS.map((p) => {
            const active = current && current.width === p.w && current.height === p.h;
            return (
              <button
                key={p.id}
                type="button"
                className={`fp-card ${active ? 'active' : ''}`}
                onClick={() => onPick(p.w, p.h, p.id)}
              >
                <span className="fp-thumb"><i style={box(p.w, p.h)} /></span>
                <span className="fp-name">{p.name}</span>
                <span className="fp-dim mono">{p.w} × {p.h}</span>
                <span className="fp-use">{p.use}</span>
              </button>
            );
          })}
        </div>
        <div className="dialog-actions">
          <button className="btn ghost small" onClick={onSkip}>稍后再说</button>
        </div>
      </div>
    </div>
  );
}
