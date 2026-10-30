/* 偏好设置：localStorage 持久化 + 全局事件广播。
 * EditorPane / 工作区通过 onSettings 订阅，设置面板通过 saveSettings 写入。 */

export type Density = 'comfortable' | 'compact';
export type Theme = 'light' | 'dark';

export type Settings = {
  fontSize: number;
  wordWrap: boolean;
  minimap: boolean;
  autoSave: boolean;
  density: Density;
  /** 浅色 / 暗色主题 */
  theme: Theme;
  /** 导出时默认开启分段并行渲染 */
  parallelRender: boolean;
  /** 并行路数（2~8），默认 4 */
  parallelCount: number;
};

const KEY = 'tempus.settings.v1';

const DEFAULTS: Settings = {
  fontSize: 13.5,
  wordWrap: true,
  minimap: false,
  autoSave: false,
  density: 'comfortable',
  theme: 'light',
  parallelRender: false,
  parallelCount: 4
};

let cache: Settings | null = null;

export function loadSettings(): Settings {
  if (cache) return cache;
  let s: Settings = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) s = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { /* 存储不可用时用默认值 */ }
  cache = s;
  return s;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...loadSettings(), ...patch };
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 忽略配额错误 */ }
  try { window.dispatchEvent(new CustomEvent<Settings>('tempus-settings', { detail: next })); } catch { /* 忽略 */ }
  applyDensity(next.density);
  applyTheme(next.theme);
  return next;
}

export function onSettings(cb: (s: Settings) => void): () => void {
  const handler = (e: Event): void => cb((e as CustomEvent<Settings>).detail);
  window.addEventListener('tempus-settings', handler);
  return () => window.removeEventListener('tempus-settings', handler);
}

export function applyDensity(d: Density): void {
  try { document.documentElement.dataset.density = d; } catch { /* 忽略 */ }
}

export function applyTheme(t: Theme): void {
  try {
    document.documentElement.dataset.theme = t;
    /* 让浏览器原生控件（滚动条、select 下拉）也跟着走 */
    document.documentElement.style.colorScheme = t;
  } catch { /* 忽略 */ }
}

/** 跟随系统：用户没手动选过时按 prefers-color-scheme 走 */
export function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch { return 'light'; }
}
