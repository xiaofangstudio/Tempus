# 字幕条 / 信息条 / 标题板（lower-thirds）

信息类版式是宣传片、访谈、数据片的骨架。这类东西好不好看，
**几乎全部取决于三件事：入场分层、停留呼吸、退场干净**。

## 三条铁律

1. **分层入场，绝不同步**：底衬 → 主标题 → 副标题，依次错开 4~6 帧。
   同一帧一起出现 = 廉价。
2. **停留时必须"活着"**：不要完全静止。给 1~2px 的极缓慢漂移，或让渐变扫过一次。
3. **退场比入场快**：入场 12~18 帧，退场 8~12 帧。收得干脆才专业。

## 版式基准（1920×1080）

- 安全边距：左右 **96px**，下边 **72px**。
- 主标题字号 **56~72**，副标题 **28~34**，字重 600 / 400。
- 强调色块宽度 **6~8px**，高度 = 主标题行高的 1.1 倍。
- 底衬用 `rgba(8,12,20,.55)` + `backdrop-filter: blur(12px)`，别用纯黑实心。

## 可直接粘贴的组件

```tsx
import React from 'react';
import { useFrame, spring, interpolate, Easing } from 'tempus';

type Props = {
  title: string;
  subtitle?: string;
  from?: number;          // 入场帧
  hold?: number;          // 停留帧数
  accent?: string;
};

export function LowerThird({ title, subtitle, from = 0, hold = 90, accent = '#4f7cff' }: Props) {
  const frame = useFrame();

  // 底衬：横向展开（从左侧推出）
  const bar = spring({ frame, fps: 30, from: 0, to: 1, config: { damping: 200, stiffness: 90 } });
  // 主标题：轻微上推 + 淡入，比底衬晚 5 帧
  const t1 = spring({ frame: frame - 5, fps: 30, config: { damping: 200 } });
  // 副标题：再晚 5 帧
  const t2 = spring({ frame: frame - 10, fps: 30, config: { damping: 200 } });
  // 退场：整体左移淡出
  const out = interpolate(frame, [hold, hold + 10], [1, 0], {
    easing: Easing.inCubic, extrapolateRight: 'clamp'
  });

  const w = 820 * bar * out;

  return (
    <div style={{
      position: 'absolute', left: 96, bottom: 72,
      width: 820, height: 132,
      transform: `translateX(${(1 - out) * -40}px)`,
      opacity: out
    }}>
      {/* 底衬 */}
      <div style={{
        position: 'absolute', inset: 0, width: w, overflow: 'hidden',
        background: 'rgba(8,12,20,.55)',
        backdropFilter: 'blur(12px)',
        borderLeft: `6px solid ${accent}`,
        borderRadius: 4
      }}>
        {/* 一次扫光：只在前 40 帧经过 */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, width: 180,
          left: interpolate(frame, [0, 40], [-180, 900], { extrapolateRight: 'clamp' }),
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.10), transparent)',
          pointerEvents: 'none'
        }} />
      </div>

      {/* 文字层：不跟着底衬裁切，避免半截字 */}
      <div style={{
        position: 'absolute', left: 28, top: 24, right: 24,
        opacity: t1, transform: `translateY(${(1 - t1) * 14}px)`
      }}>
        <div style={{
          fontSize: 64, fontWeight: 600, color: '#f2f5fa',
          letterSpacing: 2, lineHeight: 1.15, whiteSpace: 'nowrap'
        }}>{title}</div>
        {subtitle && (
          <div style={{
            fontSize: 30, color: '#96a1b5', marginTop: 8,
            opacity: t2, transform: `translateY(${(1 - t2) * 10}px)`
          }}>{subtitle}</div>
        )}
      </div>
    </div>
  );
}
```

> 关键细节：底衬做裁切展开，但**文字层不裁切**——否则会出现半截字的廉价感。
> 文字用整块的位移淡入，底衬用宽度展开，两者叠加才像"先铺板再落字"。

## 中央标题板（居中大字）

改用 `spring` 的 `scale` 而非 `width`：

```tsx
const s = spring({ frame, fps: 30, from: 0.92, to: 1, config: { damping: 18, stiffness: 140 } });
const fade = interpolate(frame, [0, 14], [0, 1]);
// transform: `scale(${s})`, opacity: fade
```

居中标题的字号可以放到 **96~128**，字重 700，字间距 `-1`（大字号要收紧）。

## 连续多条字幕的编排

用 `Series` 而不是手写绝对帧：

```tsx
<Series>
  <Sequence durationInFrames={60}><LowerThird title="第一章" subtitle="起点" hold={60} /></Sequence>
  <Sequence durationInFrames={75}><LowerThird title="第二章" subtitle="推进" hold={75} /></Sequence>
  <Sequence durationInFrames={65}><LowerThird title="第三章" subtitle="收束" hold={65} /></Sequence>
</Series>
```

每条内部帧号归零，`hold` 用各自的时长即可，不用心算偏移。

## 自检

- [ ] 入场三层错开 ≥4 帧？
- [ ] 停留段有没有"活着"的细节（扫光/微漂移）？
- [ ] 退场比入场短？
- [ ] 文字没有被底衬裁切？
- [ ] 安全边距 ≥ 96 / 72？
