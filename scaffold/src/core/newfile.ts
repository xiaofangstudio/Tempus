/* 「新建文件」的两个模板。
 *
 * 抽成独立模块的理由不只是整洁：模板是拼字符串生成的，最容易出转义/语法问题，
 * 而且 tsc 只检查生成器、不检查生成物。放在 core 里就能被
 * `npm run check:templates` 用真正的 esbuild 编译一遍
 * （和浏览器内编译走同一个编译器），点「+」之前就知道会不会炸。 */

/** 画面文件：一个合成 + 一个组件，带上工程当前画幅与帧率 */
export function buildVisualFile(opts: { width: number; height: number; fps: number; id: string }): string {
  const { width, height, fps, id } = opts;
  return `import React from 'react';
import { AbsoluteFill, Easing, interpolate, registerComposition, useFrame, useVideoConfig } from 'tempus';

/* 画面文件：返回值就是这一帧要画的东西。
 * 每一帧都是 frame 的纯函数（不用 Math.random / Date.now），导出才可复现。 */

function Scene() {
  const frame = useFrame();
  const { durationInFrames } = useVideoConfig();
  const o = interpolate(frame, [0, 24], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic)
  });
  const out = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp'
  });

  return (
    <AbsoluteFill style={{
      background: '#081427', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"Microsoft YaHei", system-ui, sans-serif'
    }}>
      <div style={{ opacity: o * out, color: '#eaf2ff', fontSize: 72, fontWeight: 800, letterSpacing: 4 }}>
        Hello Tempus
      </div>
    </AbsoluteFill>
  );
}

registerComposition({
  id: '${id}',
  width: ${width},
  height: ${height},
  fps: ${fps},
  durationInFrames: 120,
  component: Scene
});
`;
}

/** 音频文件：不画任何东西，只把声音铺在时间线上，带真实淡入淡出 */
export function buildAudioFile(): string {
  return `import { Audio, interpolate, useFrame, useVideoConfig } from 'tempus';

/* 音频文件：不画任何东西，只把声音铺在时间线上。
 * 在画面文件里 import 它并放进 JSX 即可：
 *     import Sound from './audio/背景音乐';
 *     <AbsoluteFill> ... <Sound /> </AbsoluteFill>
 *
 * volume 每帧求值 —— 下面两行就是真实的淡入 / 淡出。 */

export default function Sound() {
  const frame = useFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, fps], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - fps, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp'
  });

  return (
    <Audio
      src="assets/bgm.mp3"
      volume={Math.min(fadeIn, fadeOut)}
      startFrom={0}
    />
  );
}
`;
}

/** 从相对路径推合成 id：src/scenes/Title.tsx → Title */
export function compIdFromPath(rel: string): string {
  return rel.replace(/^.*\//, '').replace(/\.[a-z0-9]+$/i, '');
}
