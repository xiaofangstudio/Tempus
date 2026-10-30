# Tempus 运行时 API

Tempus 的每一段动画都是「时间的纯函数」：给定帧号，画面唯一确定。
这是逐帧导出可复现、可并行的根基。写代码前先读本文。

> 本文列出的就是**运行时真实存在的全部 API**。用这里没写的东西，
> 编辑器里不会有补全、运行起来也会报错。

## 注册合成（入口文件 src/index.tsx）

```tsx
import React from 'react';
import { registerComposition } from 'tempus';
import { Main } from './scenes/main';

registerComposition({
  id: 'main',            // 合成标识（导出文件名、MCP render_video 用）
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 150, // 时长（帧）；150 帧 @30fps = 5 秒
  component: Main
});
```

可注册多个合成，界面右侧「工程」面板可切换；`listCompositions()` 取回全部。

## 读时间

```tsx
import { useFrame, useCurrentFrame, useVideoConfig } from 'tempus';

function Main() {
  const frame = useFrame();          // 当前帧号（整数）——与 useCurrentFrame 等价
  const { fps, width, height, durationInFrames } = useVideoConfig();
  // 一切动画都从 frame 推导，禁止 setState / Math.random / Date.now
}
```

`useCurrentFrame` 是与 Remotion 对齐的别名，搬 Remotion 代码时可直接沿用。

## 插值：interpolate

```tsx
interpolate(frame, [0, 30], [0, 1])
interpolate(frame, [0, 30], [100, 900], { easing: Easing.outCubic })
interpolate(frame, [0, 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
interpolate(frame, [0, 60], [0, 360], { posterize: 4 })      // 每 4 帧跳一次（定格/卡帧风）
```

- 默认左侧 extend、右侧 clamp —— 结尾不会过冲，需要首尾都夹紧请显式写 `clamp`。
- `extrapolateLeft/Right: 'identity'` 越界时直接返回输入值本身。
- `posterize: n` 让数值每 n 帧才更新一次，做机械感、故障风、低帧率质感很好用。

## 弹簧：spring

默认值与 Remotion 一致：`damping 10 / mass 1 / stiffness 100`。

```tsx
spring({ frame: frame - 10, fps })                          // 第 10 帧起弹 0→1
spring({ frame, fps, from: 0, to: 720 })                    // 弹到 720
spring({ frame, fps, durationInFrames: 30 })                // 压缩到 30 帧内走完
spring({ frame, fps, delay: 24 })                           // 24 帧后才开始
spring({ frame, fps, reverse: true, durationInFrames: 40 }) // 反向播放
spring({ frame, fps, config: { damping: 100 } })            // 阻尼拉高 → 不回弹，稳
```

执行顺序与 Remotion 一致：**先按 durationInFrames 拉伸 → 再 reverse → 最后 delay 位移**。

手感速查：

| 想要 | 配置 |
|---|---|
| 轻快带一点回弹 | `{ damping: 10, stiffness: 100 }`（默认） |
| 稳、不回弹 | `{ damping: 100 }` |
| 明显 Q 弹 | `{ damping: 8, stiffness: 180 }` |
| 厚重缓慢 | `{ mass: 2, damping: 14 }` |

## 缓动：Easing

`linear / step0 / step1 / inQuad / outQuad / inOutQuad / inCubic / outCubic / inOutCubic /
outExpo / inOutExpo / inBack / outBack / inOutBack / outCirc / inOutQuart / outBounce / outElastic`

```tsx
Easing.bezier(0.42, 0, 0.58, 1)      // 与 CSS cubic-bezier 参数同序
Easing.out(Easing.outCubic)          // 组合器：in / out / inOut
```

## 确定性随机与噪声

```tsx
import { random, noise1D } from 'tempus';

const r = random('star#3');            // 同一 seed 永远同一结果（0~1）
const y = noise1D(frame / 20) * 12;    // 一维平滑噪声：漂浮、抖动、有机感
```

**禁止 `Math.random()`**：每帧都会变，导出时画面会闪。需要随机感一律用 `random(seed)`。

## 结构容器

```tsx
<AbsoluteFill style={{ background: '#101318' }}>…</AbsoluteFill>   // 铺满画布

<Sequence from={60} durationInFrames={90}>    // 第 60 帧进场，占 90 帧
  <Intro />                                  // 内部 useFrame 从 0 重新计数
</Sequence>

<Series>                                     // 子片段按各自 durationInFrames 首尾相接
  <A durationInFrames={45} />
  <B durationInFrames={75} />
</Series>

<Freeze frame={30}>…</Freeze>                // 把时间钉在第 30 帧，之后静止
```

## 标记：mark（时间轴会显示）

```tsx
mark(90, '副歌');     // 组件体内每帧执行是安全的，相同标记只登记一次
```

## 确定性渲染纪律（违反 = 导出画面错乱）

1. 每帧画面只是 frame 的函数。
2. 禁止：`Math.random`、`Date.now`、`requestAnimationFrame` 自驱动状态、跨帧可变量。
3. 需要随机感：`random('seed')` / `noise1D(t)`。
4. 布尔开关（如是否已出现）用 `frame >= t` 推导，不要存状态。
5. **禁止 CSS transition / animation 做主动画** —— 逐帧截图时它们不按帧推进，必然闪烁。
   一切位移透明度都由 `interpolate` / `spring` 直接算出来。
6. React 状态只用于组织结构，不用于动画时间。

## 内置依赖与限制

- 可用依赖：`react`、`react-dom`、`tempus`（运行时）、`three`，以及工程内相对路径文件（.tsx/.ts/.jsx/.js/.css）。
- 其余 npm 包未内置。css 直接 `import './x.css'` 会注入页面。
- 导出：无头浏览器逐帧截图 + ffmpeg 编码 H.264 MP4；音频轨在路线图中。
