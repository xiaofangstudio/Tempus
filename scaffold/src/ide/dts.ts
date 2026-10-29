import * as monaco from 'monaco-editor';
import reactDts from '../typelib/react.dts.txt?raw';
import csstypeDts from '../typelib/csstype.dts.txt?raw';

/* Monaco TypeScript 语言服务基建：
 * 给工程里的虚拟依赖（react / react-dom / tempus / three）挂上真实类型，
 * 编辑 .tsx / .ts 时获得与真实 npm 项目一致的补全、悬停与诊断。 */

export const TEMPUS_THEME = 'tempus-light';

export function defineTempusTheme(): void {
  monaco.editor.defineTheme(TEMPUS_THEME, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '94a0af', fontStyle: 'italic' },
      { token: 'keyword', foreground: '1f6feb' },
      { token: 'keyword.json', foreground: '1f6feb' },
      { token: 'string', foreground: '157a5b' },
      { token: 'string.key.json', foreground: '1f6feb' },
      { token: 'string.value.json', foreground: '157a5b' },
      { token: 'number', foreground: 'b05a12' },
      { token: 'regexp', foreground: '8a4fb8' },
      { token: 'type', foreground: '0b62f4' },
      { token: 'type.identifier', foreground: '0b62f4' },
      { token: 'identifier', foreground: '1e3348' },
      { token: 'function', foreground: '1a5fd6' },
      { token: 'delimiter', foreground: '6b7a8c' },
      { token: 'operator', foreground: '46617f' },
      { token: 'tag', foreground: '1f6feb' },
      { token: 'attribute.name', foreground: '7a4fd0' },
      { token: 'attribute.value', foreground: '157a5b' },
      { token: 'variable', foreground: '1e3348' },
      { token: 'variable.predefined', foreground: '0b62f4' }
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#1e3348',
      'editorLineNumber.foreground': '#aab6c6',
      'editorLineNumber.activeForeground': '#1f6feb',
      'editor.lineHighlightBackground': '#f2f6fd',
      'editor.selectionBackground': '#cfe0fb',
      'editor.inactiveSelectionBackground': '#e3eefc',
      'editorCursor.foreground': '#1f6feb',
      'editorIndentGuide.background1': '#e9edf4',
      'editorIndentGuide.activeBackground1': '#c9d4e2',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#dbe2ec',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.selectedBackground': '#e9f1fe',
      'editorHoverWidget.background': '#ffffff',
      'scrollbarSlider.background': '#ccd6e499',
      'scrollbarSlider.hoverBackground': '#b3c2d6aa',
      'diffEditor.insertedTextBackground': '#23a55a30',
      'diffEditor.removedTextBackground': '#e5484d30',
      'minimap.background': '#ffffff'
    }
  });
}

const PROP_TYPES_STUB = `declare namespace PropTypes {
  type Validator<T> = any;
  type Requireable<T> = any;
  type ValidationMap<T> = any;
  type InferProps<T> = any;
  const any: any; const array: any; const bool: any; const func: any;
  const number: any; const object: any; const string: any; const node: any;
  const element: any; const instanceOf: any; const oneOf: any; const oneOfType: any;
  const arrayOf: any; const objectOf: any; const shape: any; const exact: any;
}
export = PropTypes;
`;

const REACT_DOM_DTS = `import type * as React from 'react';
export function render(node: React.ReactNode, container: Element): void;
export function createPortal(node: React.ReactNode, container: Element): React.ReactNode;
export const version: string;
export default { render, createPortal, version };
`;

const REACT_DOM_CLIENT_DTS = `import type * as React from 'react';
export interface Root {
  render(node: React.ReactNode): void;
  unmount(): void;
}
export function createRoot(container: Element | DocumentFragment, options?: any): Root;
export function hydrateRoot(container: Element, node: React.ReactNode, options?: any): Root;
export function flushSync(fn?: () => void): void;
`;

const TEMPUS_DTS = `/** Tempus 运行时类型声明：与注入层 window.KR 完全对应。 */
import * as React from 'react';

export interface CompInfo {
  id: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  component?: React.ComponentType;
}

export interface InterpolateOptions {
  easing?: (t: number) => number;
  extrapolateLeft?: 'extend' | 'clamp' | 'identity';
  extrapolateRight?: 'extend' | 'clamp' | 'identity';
}

export interface SpringConfig {
  damping?: number;
  mass?: number;
  stiffness?: number;
  overshootClamping?: boolean;
}

export interface SpringOptions {
  frame: number;
  fps?: number;
  from?: number;
  to?: number;
  durationInFrames?: number;
  config?: SpringConfig;
}

/** 注册一个合成：工作台右侧监视器与导出面板按 id 列出。 */
export function registerComposition(comp: CompInfo): void;
/** 当前文档里注册的全部合成。 */
export function listCompositions(): CompInfo[];
/** 打时间标记，会出现在时间轴上。 */
export function mark(t: number, label: string): void;
/** 帧数映射：把 frame 从 inputRange 线性（或缓动）映射到 outputRange。 */
export function interpolate(
  frame: number,
  inputRange: number[],
  outputRange: number[],
  options?: InterpolateOptions
): number;
/** 弹性插值。 */
export function spring(options: SpringOptions): number;
/** 缓动函数集合（与 d3-ease 同名）。 */
export const Easing: {
  linear: (t: number) => number;
  quadratic: (t: number) => number;
  cubic: (t: number) => number;
  sin: (t: number) => number;
  exp: (t: number) => number;
  circle: (t: number) => number;
  elastic: (t: number) => number;
  back: (t: number) => number;
  bounce: (t: number) => number;
  step0: (t: number) => number;
  step1: (t: number) => number;
  bezier: (x1: number, y1: number, x2: number, y2: number) => (t: number) => number;
  in: (e: (t: number) => number) => (t: number) => number;
  out: (e: (t: number) => number) => (t: number) => number;
  inOut: (e: (t: number) => number) => (t: number) => number;
  [name: string]: ((t: number) => number) | any;
};
/** 当前帧号。 */
export function useFrame(): number;
/** 当前合成配置。 */
export function useVideoConfig(): { width: number; height: number; fps: number; durationInFrames: number };
/** 分段容器：from 起始帧、durationInFrames 持续帧数，子内容只在区间内可见。 */
export const Sequence: React.FC<{
  from?: number;
  durationInFrames?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}>;
/** 全屏容器（画布尺寸）。 */
export const AbsoluteFill: React.FC<{
  style?: React.CSSProperties;
  children?: React.ReactNode;
}>;
`;

const THREE_DTS = `/** three 以注入层（window.KV.Three）形式提供，类型按宽松处理。 */
declare const Three: any;
export default Three;
export const Scene: any;
export const PerspectiveCamera: any;
export const OrthographicCamera: any;
export const WebGLRenderer: any;
export const Object3D: any;
export const Group: any;
export const Mesh: any;
export const Line: any;
export const LineSegments: any;
export const Points: any;
export const BufferGeometry: any;
export const BufferAttribute: any;
export const Float32BufferAttribute: any;
export const MeshBasicMaterial: any;
export const MeshStandardMaterial: any;
export const MeshNormalMaterial: any;
export const PointsMaterial: any;
export const LineBasicMaterial: any;
export const Color: any;
export const Vector2: any;
export const Vector3: any;
export const Fog: any;
export const AmbientLight: any;
export const DirectionalLight: any;
export const PointLight: any;
export const BoxGeometry: any;
export const SphereGeometry: any;
export const PlaneGeometry: any;
export const TorusGeometry: any;
export const CylinderGeometry: any;
export const RingGeometry: any;
export const EdgesGeometry: any;
export const WireframeGeometry: any;
export const ShapeGeometry: any;
export const IcosahedronGeometry: any;
export const TetrahedronGeometry: any;
export const OctahedronGeometry: any;
export const Clock: any;
export const Raycaster: any;
export const MathUtils: any;
`;

let inited = false;

/** 只需调用一次：注册主题 + 类型库。 */
export function setupMonacoTypes(): void {
  defineTempusTheme();
  if (inited) return;
  inited = true;

  const ts = monaco.languages.typescript;
  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.React,
    allowNonTsExtensions: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    allowJs: false,
    strict: false,
    noEmit: true,
    skipLibCheck: true,
    baseUrl: '/',
    paths: {
      react: ['/project/typelib/react.d.ts'],
      csstype: ['/project/typelib/csstype.d.ts'],
      'prop-types': ['/project/typelib/prop-types.d.ts'],
      'react-dom': ['/project/typelib/react-dom.d.ts'],
      'react-dom/client': ['/project/typelib/react-dom-client.d.ts'],
      tempus: ['/project/typelib/tempus.d.ts'],
      three: ['/project/typelib/three.d.ts']
    }
  });
  ts.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    diagnosticCodesToIgnore: [
      6133, // 声明未使用
      6192, // 枚举成员未使用
      2695, // 未使用的 import React 提示
      7016  // 隐式 any（宽松处理用户手写 JS 风格）
    ]
  });

  // @types/react 顶部的 reference 指向 experimental 说明文件，剥离避免找不到
  const reactLib = reactDts.replace(/\/\/\/\s*<reference[^>]*\/>/g, '');
  const libs: [string, string][] = [
    ['/project/typelib/react.d.ts', reactLib],
    ['/project/typelib/csstype.d.ts', csstypeDts],
    ['/project/typelib/prop-types.d.ts', PROP_TYPES_STUB],
    ['/project/typelib/react-dom.d.ts', REACT_DOM_DTS],
    ['/project/typelib/react-dom-client.d.ts', REACT_DOM_CLIENT_DTS],
    ['/project/typelib/tempus.d.ts', TEMPUS_DTS],
    ['/project/typelib/three.d.ts', THREE_DTS]
  ];
  for (const [path, content] of libs) {
    ts.typescriptDefaults.addExtraLib(content, path);
  }
}
