# 数据动效（data-viz）

数字、进度、图表动起来的核心不是"炫"，是**让观众跟得上**。
三条原则：**先出轴与底、数值跟随、收尾留白 12 帧以上**。

## 通用节奏

| 阶段 | 帧数（30fps） | 做什么 |
|---|---|---|
| 骨架 | 0~12 | 轴线、底衬、标签先淡入 |
| 生长 | 12~50 | 数值从 0 长到目标（`Easing.outCubic`） |
| 读数 | 50~70 | 数字滚动到位，稍微回弹一下 |
| 留白 | 结尾 ≥12 帧 | 不再变化，让人看清 |

## 数字滚动（带千分位）

```tsx
import { useFrame, interpolate, spring, Easing } from 'tempus';

function Counter({ value, from = 0, suffix = '' }: { value: number; from?: number; suffix?: string }) {
  const frame = useFrame();
  const t = interpolate(frame, [from, from + 38], [0, 1], { easing: Easing.outCubic });
  const n = Math.round(value * t);
  const bump = spring({ frame: frame - (from + 38), fps: 30, config: { damping: 14, stiffness: 200 } });
  return (
    <span style={{
      fontVariantNumeric: 'tabular-nums',           // 数字等宽，滚动时不跳动
      transform: `scale(${1 + (1 - Math.min(1, bump)) * 0.04})`,
      display: 'inline-block'
    }}>
      {n.toLocaleString('zh-CN')}{suffix}
    </span>
  );
}
```

`font-variant-numeric: tabular-nums` 是必须的，否则数字滚动时宽度乱抖。

## 条形图（逐条错开生长）

```tsx
import React from 'react';
import { useFrame, interpolate, Easing } from 'tempus';

const DATA = [
  { label: '一季度', value: 62, color: '#4f7cff' },
  { label: '二季度', value: 78, color: '#57a5ff' },
  { label: '三季度', value: 91, color: '#7c5cf0' },
  { label: '四季度', value: 84, color: '#3ecfd6' }
];

export function Bars() {
  const frame = useFrame();
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 28, height: 360 }}>
      {DATA.map((d, i) => {
        const start = 10 + i * 6;                    // 逐条错开 6 帧
        const t = interpolate(frame, [start, start + 32], [0, 1], {
          easing: Easing.outCubic, extrapolateLeft: 'clamp'
        });
        const y = interpolate(frame, [start, start + 32], [0, 1], {
          easing: Easing.outBack, extrapolateLeft: 'clamp'
        });
        return (
          <div key={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 26, color: '#e8ecf5', fontVariantNumeric: 'tabular-nums', opacity: t }}>
              {Math.round(d.value * y)}
            </div>
            <div style={{
              width: 96, height: 280 * t, background: d.color,
              borderRadius: '6px 6px 0 0',
              boxShadow: `0 -8px 24px ${d.color}55`
            }} />
            <div style={{ fontSize: 20, color: '#8a94a8', opacity: interpolate(frame, [0, 12], [0, 1]) }}>
              {d.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

## 环形进度（SVG，最稳）

```tsx
export function Ring({ value, size = 220, stroke = 16, color = '#4f7cff' }: {
  value: number; size?: number; stroke?: number; color?: string;
}) {
  const frame = useFrame();
  const t = interpolate(frame, [8, 48], [0, 1], { easing: Easing.outCubic });
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#232a36" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - (value / 100) * t)}
      />
    </svg>
  );
}
```

## 折线 / 面积图（SVG path 按帧截断）

```tsx
const pts = [[0,220],[1,180],[2,196],[3,140],[4,150],[5,96],[6,70]];
const W = 720, H = 260;
const path = pts.map(([x, y], i) =>
  `${i ? 'L' : 'M'}${x * (W / 6)} ${y}`).join(' ');

// 生长：用 strokeDasharray 截断，比逐点重算简单且平滑
const len = 1600;                       // 用 getTotalLength() 实测更准，这里给近似
const grow = interpolate(frame, [10, 46], [0, 1], { easing: Easing.outCubic });

<svg width={W} height={H}>
  <path d={path} fill="none" stroke="#4f7cff" strokeWidth={4}
        strokeDasharray={len} strokeDashoffset={len * (1 - grow)} strokeLinecap="round" />
</svg>
```

## 自检

- [ ] 数字用了 `tabular-nums`？
- [ ] 生长用 `outCubic`，不是 linear（linear 显得没重量）？
- [ ] 多条目错开 ≥4 帧？
- [ ] 结尾留白 ≥12 帧让人读数？
- [ ] 颜色 ≤4 种，且只有一个强调色？
