/* 画幅预设：新建工程 / 改画幅时共用同一张表。
 * 每个预设都带「真实像素」而不只是比例 —— 监视器、模板、导出尺寸都用这组数。 */

export type FramePreset = { id: string; w: number; h: number; name: string; use: string };

export const FRAME_PRESETS: FramePreset[] = [
  { id: '16:9', w: 1920, h: 1080, name: '横屏 16:9', use: 'B 站 / YouTube' },
  { id: '9:16', w: 1080, h: 1920, name: '竖屏 9:16', use: '抖音 / 视频号' },
  { id: '1:1', w: 1080, h: 1080, name: '方形 1:1', use: '朋友圈 / Instagram' },
  { id: '4:5', w: 1080, h: 1350, name: '竖版 4:5', use: '小红书' },
  { id: '2.39:1', w: 1920, h: 804, name: '宽银幕 2.39:1', use: '电影感' },
  { id: '4:3', w: 1440, h: 1080, name: '复古 4:3', use: '老片质感' }
];

/** 由宽高反查预设 id（自定义尺寸回落到 W×H 文本） */
export function frameIdOf(w: number, h: number): string {
  const hit = FRAME_PRESETS.find((p) => p.w === w && p.h === h);
  return hit ? hit.id : `${w}x${h}`;
}

/** 由 id 取预设（project.json 的 frame 字段） */
export function frameById(id: string): FramePreset | undefined {
  return FRAME_PRESETS.find((p) => p.id === id);
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** 宽高比文本：1920×1080 → "16:9"；非整比 → "2.39:1" */
export function ratioLabel(w: number, h: number): string {
  if (!w || !h) return '—';
  const g = gcd(w, h);
  const a = w / g;
  const b = h / g;
  if (a > 40 || b > 40) return `${(w / h).toFixed(2)}:1`;
  return `${a}:${b}`;
}
