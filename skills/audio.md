# 音频（Audio）—— 用写代码的方式做声音

Tempus 的音频不是"拖一条音轨进去"，而是一个 React 组件：**画面文件 import 它，它就在那条时间线上发声**。

---

## 一、最小的一个音频文件

新建文件时选「音频文件」，得到的就是这个骨架：

```tsx
import { Audio, interpolate, useFrame, useVideoConfig } from 'tempus';

export default function Sound() {
  const frame = useFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, fps], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - fps, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp'
  });

  return <Audio src="assets/bgm.mp3" volume={Math.min(fadeIn, fadeOut)} />;
}
```

然后**在画面文件里用它**（音频文件本身不注册合成）：

```tsx
import Sound from './audio/背景音乐';

export default function Scene() {
  return (
    <AbsoluteFill style={{ background: '#0b1220' }}>
      <h1 style={{ color: '#fff' }}>标题</h1>
      <Sound />
    </AbsoluteFill>
  );
}
```

---

## 二、`<Audio>` 的四个参数

| 参数 | 含义 | 默认 |
|---|---|---|
| `src` | 工程内的相对路径，如 `assets/bgm.mp3` | 必填 |
| `volume` | 0~1，**每一帧都会重新求值** | 1 |
| `startFrom` | 从音频的第几秒开始取 | 0 |
| `durationInFrames` | 在时间线上停留多少帧 | 到合成结束 |
| `playbackRate` | 倍速 | 1 |

支持格式取决于浏览器解码能力：**mp3 / wav / ogg / m4a / aac / flac / opus** 都可以。

---

## 三、音量是逐帧求值的 —— 这就是"做声音"

因为 `volume` 每帧都重新算，你可以像做动画一样做声音：

```tsx
// 1) 打击感：在固定帧位置来一串衰减的"咚"
const hits = [15, 45, 75, 105];
const env = hits.reduce((acc, h) => {
  const d = frame - h;
  if (d < 0 || d > 12) return acc;
  return acc + Math.pow(1 - d / 12, 3);
}, 0);
return <Audio src="assets/kick.wav" volume={Math.min(1, env)} />;
```

```tsx
// 2) 跟着画面节奏自动淡出
const { fps } = useVideoConfig();
const duck = interpolate(frame, [0, fps * 2, fps * 4], [0, 0.25, 1], { extrapolateRight: 'clamp' });
return <Audio src="assets/bgm.mp3" volume={duck} />;
```

```tsx
// 3) 两条声音叠着放（多轨混音）：直接写两个 Audio
return (
  <>
    <Audio src="assets/bgm.mp3" volume={0.4} />
    <Audio src="assets/voice.wav" volume={1} />
  </>
);
```

```tsx
// 4) 只在某一段响：用 Sequence 包起来
import { Sequence, Audio } from 'tempus';

<Sequence from={90} durationInFrames={60}>
  <Audio src="assets/whoosh.wav" volume={0.8} />
</Sequence>
```

---

## 四、预览 / 导出分别怎么走

- **预览**：真实发声。拖动时间轴、逐帧步进都会精确 seek 到对应时刻；播放时音频自己走，只有在漂移超过 0.35 秒时才纠偏（避免每帧 seek 造成的爆音）。
- **导出**：无头浏览器里 blob URL 不成立，所以整条时间线由 `OfflineAudioContext` 离线混成一条 WAV（含逐帧音量包络），再交给 ffmpeg 与逐帧画面合并。**导出的声音和你预览听到的一致。**

---

## 五、三条纪律

1. **不要在组件里开 `new AudioContext()` 或手动 play** —— 播放/暂停/seek 全部由运行时统一驱动，你只管给 `volume`。
2. **不要用 `Date.now()` 或 `Math.random()` 算音量** —— 和画面一样，音频也必须是帧的纯函数，否则导出和预览对不上。
3. **音频文件要放在工程目录里**（如 `assets/`），预览会自动扫描成 blob URL；放在工程外的绝对路径预览能读，但导出会失败。

---

## 六、监视器怎么帮你判断声音对不对

右侧下方那条"音频监视"不是装饰：

- **波形是解码后的真实峰值**，多条音频叠着画，各用一色
- 点上方的**文件 chip** 可以单独显隐某条轨，判断"是哪一条在响"
- 右侧**电平表**读的是当前帧处的真实振幅，带峰值保持；跳到第 N 帧就知道那一刻有多响
- 头部显示每个文件的**时长 / 采样率 / 声道**
- **试听按钮**直接播文件本身（不走时间线），用来确认"这个文件是不是我要的"
- 示波器顶部可以**拖着拉高**，波形太扁时拉大看

**加载失败会显式报出来**：预览里 `<Audio>` 的元素 `error` 事件会上报到父窗口，
监视器 chip 变红虚线、状态栏出现「音频加载失败 N 个」。不会再出现"写了 Audio 却静悄悄"。

---

## 七、导入素材的两种方式

1. **从资源管理器直接把 mp3 / png 拖进窗口** —— 自动复制到工程的 `assets/`，立刻出现在监视器里
2. 手动放进工程目录的 `assets/`，`Ctrl+R` 重新编译即可

**预览主音量**：监视器控制条右侧的喇叭 + 滑块，快捷键 `M` 静音/取消。
它只影响预览响度，不改你代码里的 `volume`，也不影响导出。

---

## 八、常见问题

**没声音？**
1. 确认音频文件确实在工程目录里（资源管理器能看到）。
2. 确认画面文件里 `import` 并渲染了那个 `<Sound />`（音频文件本身不会自动挂上去）。
3. `volume` 是不是算成了 0 —— 淡入曲线的第一帧就是 0，跳到第 20 帧再听。

**声音对不上画面？**
检查是不是在 `Sequence` 里用的：`<Audio>` 的起始时间跟着外层的 `from` 走，`startFrom` 是音频文件内部的偏移，两者不要搞混。

**想听出某一段的波形？** 右侧下方的示波器可以选工程里任意音频文件，实实在在画出峰值，播放头跟时间轴同步。
