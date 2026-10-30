# Remotion → Tempus 迁移对照

Tempus 的 API 刻意与 Remotion 对齐，绝大多数 Remotion 场景代码改几行就能跑。
**搬代码前对照本文**：左边是你会想写的 Remotion 写法，右边是 Tempus 里该怎么写；
标 ❌ 的是运行时不存在的，写了会直接报错。

## 直接可用（改 import 即可）

| Remotion | Tempus | 说明 |
|---|---|---|
| `useCurrentFrame()` | `useFrame()` 或 `useCurrentFrame()` | 两者等价，已内置别名 |
| `useVideoConfig()` | `useVideoConfig()` | 返回 `{width,height,fps,durationInFrames}` |
| `interpolate()` | `interpolate()` | 含 `easing`、`extrapolateLeft/Right`、`posterize` |
| `spring()` | `spring()` | 默认值一致；含 `delay`、`reverse`、`durationInFrames` |
| `<Sequence>` | `<Sequence>` | `from` + `durationInFrames`，内部帧号归零 |
| `<Series>` | `<Series>` | 子片段按 `durationInFrames` 顺序相接 |
| `<Freeze>` | `<Freeze>` | 钉住时间 |
| `<AbsoluteFill>` | `<AbsoluteFill>` | 铺满画布 |
| `Easing.*` | `Easing.*` | 含 `bezier` 与 `in/out/inOut` 组合器 |
| `random(seed)` | `random(seed)` | 同语义，确定性 |

```tsx
// Remotion 写法
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';
// Tempus 写法：只改这一行
import { useFrame, useVideoConfig, spring } from 'tempus';
```

## ❌ 运行时没有的（必须换写法）

| 你想写的 | 换成 |
|---|---|
| `import {Audio} from 'remotion'` | 暂无音频轨，用画面节奏表达；或用 `mark()` 打点提示配乐位置 |
| `import {Video, OffthreadVideo} from 'remotion'` | 不支持视频源。需要动态影像就用 `three` 或 CSS/SVG 现画 |
| `import {Img} from 'remotion'` | 用普通 `<img src="data:image/svg+xml;...">`，或内联 SVG / CSS 图形 |
| `staticFile('logo.png')` | 无资源目录。图标一律内联 SVG，或 `data:` URL |
| `<Composition>` 在 `Root.tsx` 里声明 | 用 `registerComposition({...})` 在入口文件里调用 |
| `@remotion/shapes` `<Circle> <Rect> <Triangle>` | 内联 SVG，或 `div` + `borderRadius` |
| `@remotion/paths` `evolvePath()` | 手写 `interpolate` 驱动 `d` 属性，或改用 `transform` |
| `@remotion/google-fonts` `loadFont()` | 用系统中文字体：`"Microsoft YaHei", "PingFang SC", system-ui` |
| `@remotion/lottie` | 不支持，用 `Sequence` + 关键帧手写等价动画 |
| `@remotion/three` `<ThreeCanvas>` | 直接用 `three` 手建 renderer，配合 `useFrame` 推进（见 three-d-scene） |
| `delayRender() / continueRender()` | 不需要：所有资源都是同步/内置的 |
| `calculateMetadata()` | 不需要：合成参数写在 `registerComposition` 里 |

## 搬运清单（按顺序检查）

1. `import ... from 'remotion'` → `from 'tempus'`。
2. `export const RemotionRoot` / `<Composition>` → 入口文件里 `registerComposition(...)`。
3. 所有 `staticFile(...)`、`<Img>`、`<Audio>`、`<Video>` 替换掉。
4. 字体换成系统字体栈。
5. 检查 CSS：删掉所有 `transition` / `animation` / `@keyframes`，改成 `interpolate` 驱动。
6. 检查随机：所有 `Math.random()` → `random('有意义的 seed')`。
7. 跑一遍「确定性纪律」（见 tempus-api.md 第 5 条）。

## 最常见的两个坑

**坑 1：CSS 动画必崩。**
Remotion 也一样禁止，但很多人习惯性写 `transition: all .3s`。
逐帧截图时浏览器不会按你的帧推进 CSS 动画，导出结果必然闪烁或全静止。
一律改成：`opacity: interpolate(frame, [10, 30], [0, 1])`。

**坑 2：Sequence 里用绝对帧号。**
`<Sequence from={60}>` 内部 `useFrame()` 从 **0** 重新开始。
若在内部还写 `frame > 60` 判断，会永远不成立。用局部帧号思考。
