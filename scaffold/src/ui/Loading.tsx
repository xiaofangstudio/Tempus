import React, { useEffect, useState } from 'react';
import { Logo } from './icons';

const TIPS = [
  '正在准备运行时……',
  '正在装载编辑器……',
  '马上就好……'
];

export function Loading({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState(0);

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (): void => {
      const el = performance.now() - t0;
      // 预加载越快走得越快，最少 900ms，最多 2s
      setP(Math.min(1, el / 1400));
      if (el < 1400) raf = requestAnimationFrame(tick);
      else onDone();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onDone]);

  const tip = TIPS[Math.min(TIPS.length - 1, Math.floor(p * TIPS.length))];

  return (
    <div className="loading-wrap">
      <div className="loading-logo"><Logo size={92} clap /></div>
      <div className="loading-title">Tempus</div>
      <div className="loading-sub">编码动效工作室</div>
      <div className="loading-bar"><div style={{ width: `${p * 100}%` }} /></div>
      <div className="loading-tip">{tip}</div>
    </div>
  );
}
