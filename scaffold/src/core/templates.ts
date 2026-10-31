/* 工程模板：每个模板是一组真实可渲染的源码文件，点一下即生成完整工程。
 * 阵容对齐 Remotion create-video：空白（--blank）、标准正片（--hello-world）、3D（--three）。
 * 气质统一：深底、细字、单一强调色，工程起点而非成品炫技。
 *
 * 画幅参与生成（这是"新建时选 16:9 / 9:16"能真的兑现的前提）：
 *   - project.json 写进 width/height/fps/frame；
 *   - registerComposition 用同一组数；
 *   - 模板内部尺寸按画幅等比缩放（标准工程用 theme.ts 的 S 系数，
 *     空白工程直接生成具体数值），所以竖屏也不会溢出。 */

import { frameIdOf } from './frame';

export type FrameSpec = { width: number; height: number; fps: number };

export type Template = {
  id: string;
  name: string;
  desc: string;
  /** 按画幅生成整组工程文件 */
  build: (f: FrameSpec) => Record<string, string>;
};

/* 内联 style 中的字体片段（对象成员形式，嵌进模板代码的 style 对象） */
const FONT = `fontFamily: '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif'`;

/** 以 1920 宽为基准的等比缩放系数（竖屏 1080 → 0.5625） */
const kOf = (f: FrameSpec): number => Math.max(0.5, Math.min(2, f.width / 1920));
const px = (f: FrameSpec, n: number): number => Math.round(n * kOf(f));

const metaJson = (name: string, entry: string, f: FrameSpec): string =>
  JSON.stringify(
    { name, entry, fps: f.fps, width: f.width, height: f.height, frame: frameIdOf(f.width, f.height) },
    null, 2
  );

/* ---------- 模板一：空白（对标 Remotion --blank） ---------- */

function buildBlank(f: FrameSpec): Record<string, string> {
  const title = px(f, 88);
  const sub = px(f, 28);
  const ruleW = px(f, 520);
  const rise = px(f, 26);
  const gap = px(f, 14);
  const top = px(f, 38);

  return {
    'project.json': metaJson('未命名工程', 'src/index.tsx', f),
    'src/index.tsx': `import React from 'react';
import { registerComposition, useFrame, useVideoConfig, interpolate, AbsoluteFill } from 'tempus';

/* ============ 空白工程 ============
 * 一个合成 + 一个组件，这就是全部骨架。
 *
 * 确定性纪律（导出画面对不对，全看这三条）：
 *   1. 每一帧都是 frame 的纯函数；
 *   2. 不用 Math.random()、不用 Date.now()；
 *   3. 不写跨帧可变量——所有变化都由 frame 推导。
 *
 * 改动保存后监视器立即重渲染。 */

const BG = '#101318';       // 底色
const FG = '#e8ecf5';       // 前景文字
const ACCENT = '#4f7cff';   // 强调色：全片只用这一个

function Main() {
  const frame = useFrame();
  const { durationInFrames } = useVideoConfig();

  const line = interpolate(frame, [10, 90], [0, 1]);   // 细线 0 -> 100%
  const rise = interpolate(frame, [0, 18], [${rise}, 0]);   // 文字轻推入场
  const fade = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0]);

  return (
    <AbsoluteFill style={{ background: BG, alignItems: 'center', justifyContent: 'center', ${FONT} }}>
      <div style={{ opacity: fade, textAlign: 'center' }}>
        <div style={{ transform: \`translateY(\${rise}px)\`, fontSize: ${title}, fontWeight: 600, color: FG, letterSpacing: 4 }}>
          新的工程
        </div>
        <div style={{ transform: \`translateY(\${rise}px)\`, fontSize: ${sub}, color: '#8a94a8', marginTop: ${gap} }}>
          一个组件 + 一个合成，从这里开始
        </div>
        <div style={{ width: ${ruleW}, height: 2, background: '#2a3140', margin: '${top}px auto 0' }}>
          <div style={{ width: \`\${line * 100}%\`, height: 2, background: ACCENT }} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

registerComposition({
  id: 'main',
  width: ${f.width},
  height: ${f.height},
  fps: ${f.fps},
  durationInFrames: 150,
  component: Main
});
`
  };
}

/* ---------- 模板二：标准正片（对标 Remotion --hello-world，多文件） ---------- */

function buildStandard(f: FrameSpec): Record<string, string> {
  const s = Number(kOf(f).toFixed(4));

  const theme = `/* 全片视觉参数：改颜色、字号只动这一个文件。 */
export const theme = {
  bg: '#0e1116',        // 底色
  panel: '#161b23',     // 面板/卡片
  fg: '#e8ecf5',        // 主文字
  muted: '#8a94a8',     // 次文字
  line: '#2a3140',      // 分隔线
  accent: '#4f7cff',    // 强调色（全片唯一彩色）
  font: '"Microsoft YaHei", "PingFang SC", sans-serif'
};

/* 画幅系数：本工程是 ${f.width}×${f.height}，基准按 1920 宽。
 * 全片所有字号、间距、宽度都乘 S —— 换画幅时整片自动等比，不用逐处改。 */
export const S = ${s};
`;

  const data = `/* 正片内容：改文案只动这里，场景代码不用碰——这就是"换片不动代码"。 */
export const film = {
  title: 'Tempus',
  tagline: '写的是组件，出的是成片',
  features: [
    { n: '01', t: '确定性', d: '每一帧都是时间的纯函数，渲染一万次画面不变' },
    { n: '02', t: '实时预览', d: '保存即重渲染，代码与画面同步' },
    { n: '03', t: '可编程', d: 'React 组件加八个 API，动画就是代码' }
  ],
  outro: '现在，写下你的第一帧'
};
`;

  const intro = `import React from 'react';
import { useFrame, interpolate, Easing, AbsoluteFill } from 'tempus';
import { theme, S } from '../theme';
import { film } from '../data';

/* 第一幕：标题入场。克制的位移（outCubic），没有弹跳。
 * 所有尺寸乘 S —— 见 theme.ts 里的说明。 */
export function Intro() {
  const frame = useFrame();

  const up = interpolate(frame, [0, 24], [40 * S, 0], { easing: Easing.outCubic });
  const op = interpolate(frame, [0, 18], [0, 1]);
  const rule = interpolate(frame, [26, 60], [0, 1], { easing: Easing.outCubic });
  const sub = interpolate(frame, [18, 40], [24 * S, 0], { easing: Easing.outCubic });
  const subOp = interpolate(frame, [18, 38], [0, 1]);

  return (
    <AbsoluteFill style={{ background: theme.bg, alignItems: 'center', justifyContent: 'center', ${FONT} }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ transform: \`translateY(\${up}px)\`, opacity: op, fontSize: 150 * S, fontWeight: 700, color: theme.fg, letterSpacing: 10 * S }}>
          {film.title}
        </div>
        <div style={{ transform: \`translateY(\${sub}px)\`, opacity: subOp, fontSize: 34 * S, color: theme.muted, marginTop: 16 * S, letterSpacing: 6 * S }}>
          {film.tagline}
        </div>
        <div style={{ width: 640 * S, height: 1, background: theme.line, margin: \`\${44 * S}px auto 0\`, position: 'relative' }}>
          <div style={{ width: \`\${rule * 100}%\`, height: 1, background: theme.accent }} />
        </div>
      </div>
    </AbsoluteFill>
  );
}
`;

  const feature = `import React from 'react';
import { useFrame, interpolate, Easing, AbsoluteFill } from 'tempus';
import { theme, S } from '../theme';
import { film } from '../data';

/* 第二幕：三条特性，左编号右文案，依次入场。 */
export function Feature() {
  const frame = useFrame();

  return (
    <AbsoluteFill style={{ background: theme.bg, alignItems: 'center', justifyContent: 'center', ${FONT} }}>
      <div style={{ width: 1100 * S }}>
        {film.features.map((f, i) => {
          const p = interpolate(frame, [i * 34, i * 34 + 26], [0, 1], { easing: Easing.outCubic });
          const op = interpolate(frame, [i * 34, i * 34 + 18], [0, 1]);
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'baseline', gap: 46 * S,
              padding: \`\${34 * S}px 0\`,
              borderBottom: '1px solid ' + theme.line,
              opacity: op,
              transform: \`translateY(\${(1 - p) * 34 * S}px)\`
            }}>
              <div style={{ fontSize: 30 * S, color: theme.accent, fontWeight: 700, width: 64 * S }}>{f.n}</div>
              <div style={{ fontSize: 58 * S, color: theme.fg, fontWeight: 600, width: 300 * S }}>{f.t}</div>
              <div style={{ fontSize: 28 * S, color: theme.muted, flex: 1 }}>{f.d}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
`;

  const outro = `import React from 'react';
import { useFrame, interpolate, Easing, AbsoluteFill } from 'tempus';
import { theme, S } from '../theme';
import { film } from '../data';

/* 第三幕：落版。 */
export function Outro() {
  const frame = useFrame();

  const op = interpolate(frame, [0, 22], [0, 1]);
  const up = interpolate(frame, [0, 24], [30 * S, 0], { easing: Easing.outCubic });

  return (
    <AbsoluteFill style={{ background: theme.bg, alignItems: 'center', justifyContent: 'center', ${FONT} }}>
      <div style={{ textAlign: 'center', opacity: op, transform: \`translateY(\${up}px)\` }}>
        <div style={{ fontSize: 92 * S, fontWeight: 700, color: theme.fg, letterSpacing: 6 * S }}>{film.outro}</div>
        <div style={{ width: 96 * S, height: 3, background: theme.accent, margin: \`\${36 * S}px auto 0\` }} />
      </div>
    </AbsoluteFill>
  );
}
`;

  const index = `import React from 'react';
import { registerComposition, Sequence, AbsoluteFill, mark } from 'tempus';
import { theme } from './theme';
import { Intro } from './scenes/Intro';
import { Feature } from './scenes/Feature';
import { Outro } from './scenes/Outro';

/* ============ 标准工程 ============
 * 目录结构：
 *   src/index.tsx        编排（本文件）：三幕如何串
 *   src/scenes/Intro.tsx 第一幕：标题
 *   src/scenes/Feature   第二幕：特性
 *   src/scenes/Outro     第三幕：落版
 *   src/data.ts          全部文案
 *   src/theme.ts         全部颜色 + 画幅系数 S
 *
 * 换片：改 data.ts / theme.ts；改节奏：动下面的 Sequence。 */

mark(0, '第一幕 · 标题');
mark(90, '第二幕 · 特性');
mark(240, '第三幕 · 落版');

function Main() {
  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: theme.font }}>
      <Sequence from={0} durationInFrames={90}><Intro /></Sequence>
      <Sequence from={90} durationInFrames={150}><Feature /></Sequence>
      <Sequence from={240} durationInFrames={90}><Outro /></Sequence>
    </AbsoluteFill>
  );
}

registerComposition({
  id: 'main',
  width: ${f.width},
  height: ${f.height},
  fps: ${f.fps},
  durationInFrames: 330,   // 11 秒
  component: Main
});
`;

  return {
    'project.json': metaJson('标准工程', 'src/index.tsx', f),
    'src/theme.ts': theme,
    'src/data.ts': data,
    'src/scenes/Intro.tsx': intro,
    'src/scenes/Feature.tsx': feature,
    'src/scenes/Outro.tsx': outro,
    'src/index.tsx': index
  };
}

/* ---------- 模板三：3D 工程（对标 Remotion --three） ---------- */

function buildThree(f: FrameSpec): Record<string, string> {
  return {
    'project.json': metaJson('3D 工程', 'src/index.tsx', f),
    'src/index.tsx': `import React, { useRef, useLayoutEffect } from 'react';
import { registerComposition, useFrame, useVideoConfig, interpolate, Easing, AbsoluteFill } from 'tempus';
import * as THREE from 'three';

/* ============ 3D 工程（three.js 已内置）============
 * import * as THREE from 'three' 直接可用，无需安装任何东西。
 *
 * 确定性纪律在 3D 下同样成立：
 *   - 场景只构建一次（模块级），绘制每帧重画；
 *   - 相机与物体的状态全部由 frame 推导；
 *   - 粒子分布用固定公式（黄金角螺旋）而非随机数，
 *     所以每次打开、每台机器，星空完全一致。
 *
 * 试试改：COUNT（粒子数）、转速、camera.position 的运镜曲线。 */

const W = ${f.width}, H = ${f.height};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.setClearColor(0x0b0e14, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b0e14, 240, 1700);

const camera = new THREE.PerspectiveCamera(60, W / H, 1, 4000);

/* --- 星野：9000 颗粒子，黄金角螺旋分布（无随机，绝对确定） --- */
const COUNT = 9000;
const pos = new Float32Array(COUNT * 3);
for (let i = 0; i < COUNT; i++) {
  const t = i / COUNT;
  const r = 320 + 1250 * Math.pow(t, 0.6);
  const theta = i * 2.39996;              // 黄金角
  const y = ((i % 9) - 4) / 4 * r * 0.45;
  const flat = Math.sqrt(Math.max(1, r * r - y * y));
  pos[i * 3] = Math.cos(theta) * flat;
  pos[i * 3 + 1] = y;
  pos[i * 3 + 2] = Math.sin(theta) * flat;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
  color: 0xcfe0ff, size: 2.4, sizeAttenuation: true, transparent: true, opacity: 0.85, fog: true
}));
scene.add(stars);

/* --- 中心体：线框二十面体 --- */
const core = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(150, 1)),
  new THREE.LineBasicMaterial({ color: 0x4f7cff, transparent: true, opacity: 0.65 })
);
scene.add(core);

/* --- 画布挂载：一次即可（useLayoutEffect 保证首帧前就位） --- */
function Stage() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && renderer.domElement.parentElement !== el) el.appendChild(renderer.domElement);
  }, []);
  return <div ref={ref} style={{ position: 'absolute', inset: 0 }} />;
}

function Main() {
  const frame = useFrame();
  const { durationInFrames } = useVideoConfig();

  /* 运镜：匀速推进 + 极缓侧摆；物体：frame 驱动自转 */
  const travel = interpolate(frame, [0, durationInFrames], [0, 640], { easing: Easing.inOutCubic });
  camera.position.set(Math.sin(frame / 260) * 110, Math.cos(frame / 320) * 55, 980 - travel);
  camera.lookAt(0, 0, 0);
  stars.rotation.y = frame / 480;
  core.rotation.y = frame / 130;
  core.rotation.x = frame / 210;

  renderer.render(scene, camera);

  const fade = interpolate(frame, [0, 24], [0, 1]) * interpolate(frame, [durationInFrames - 24, durationInFrames], [1, 0]);

  return (
    <AbsoluteFill style={{ background: '#0b0e14', ${FONT} }}>
      <Stage />
      <div style={{
        position: 'absolute', left: 64, bottom: 52, opacity: fade * 0.75,
        fontSize: 20, color: '#8a94a8', letterSpacing: 2
      }}>
        three.js 已内置 · 试试改 COUNT 与运镜曲线
      </div>
    </AbsoluteFill>
  );
}

registerComposition({
  id: 'main',
  width: ${f.width},
  height: ${f.height},
  fps: ${f.fps},
  durationInFrames: 300,   // 10 秒
  component: Main
});
`
  };
}

/* ---------- 汇总：与 Remotion create-video 三件套对齐 ---------- */

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: '空白工程',
    desc: '最小骨架：一个合成、一个组件、干净注释。对标 Remotion Blank。',
    build: buildBlank
  },
  {
    id: 'standard',
    name: '标准工程',
    desc: '三幕正片 starter：场景拆文件、文案与颜色数据分离。对标 Remotion Video Starter。',
    build: buildStandard
  },
  {
    id: 'three',
    name: '3D 工程',
    desc: 'three.js 星空 starter：粒子星野 + 线框体 + 运镜，确定性 3D。对标 Remotion Three。',
    build: buildThree
  }
];

/** 默认画幅（新建对话框的初始选择） */
export const DEFAULT_FRAME: FrameSpec = { width: 1920, height: 1080, fps: 30 };
