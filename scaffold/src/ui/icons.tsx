import React from 'react';

/* 内联 SVG 图标集：全站图标统一出处，禁止 emoji。
 * Logo 为场记板（与应用图标同款）：蓝渐变底 + 白色场记板 + 黑色条纹与细节。 */

type P = { size?: number; style?: React.CSSProperties };

const s = (size?: number) => ({ width: size ?? 16, height: size ?? 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const });

export const IconPlay = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M7 4.8v14.4l12-7.2z" fill="currentColor" stroke="none" /></svg>
);
export const IconPause = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M7 4.5v15M17 4.5v15" strokeWidth={2.6} /></svg>
);
export const IconPrev = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M18 5.5v13L8.5 12z" fill="currentColor" stroke="none" /><path d="M6 5v14" /></svg>
);
export const IconNext = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M6 5.5v13L15.5 12z" fill="currentColor" stroke="none" /><path d="M18 5v14" /></svg>
);
export const IconStepBack = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6" /></svg>
);
export const IconStepFwd = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M10 6l6 6-6 6" /></svg>
);
export const IconLoop = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M17 3l3 3-3 3" /><path d="M20 6H8a4 4 0 0 0-4 4v1" /><path d="M7 21l-3-3 3-3" /><path d="M4 18h12a4 4 0 0 0 4-4v-1" /></svg>
);
export const IconExport = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 19h16" /></svg>
);
export const IconFolder = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M3 6a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
);
export const IconFile = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></svg>
);
export const IconPlus = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
);
export const IconClose = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconImport = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M12 15V3" /><path d="M7 10l5 5 5-5" /><path d="M4 19h16" /></svg>
);
export const IconSave = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5z" /><path d="M8 3v5h7V3" /><path d="M8 21v-7h8v7" /></svg>
);
export const IconTrash = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></svg>
);
export const IconMcp = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></svg>
);
export const IconBook = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z" /><path d="M4 17a2 2 0 0 1 2-2h13" /></svg>
);
export const IconInfo = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
);
export const IconRefresh = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.5-5.8" /><path d="M20 4v5h-5" /></svg>
);
export const IconTerminal = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3" /><path d="M12 15h5" /></svg>
);
export const IconBranch = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><circle cx="6" cy="5" r="2.2" /><circle cx="6" cy="19" r="2.2" /><circle cx="18" cy="9" r="2.2" /><path d="M6 7.2v9.6" /><path d="M18 11.2c0 3-2.5 4.3-5.5 4.3H9" /></svg>
);
export const IconCloudUp = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M6.5 19a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 17.8 9.1 4.2 4.2 0 0 1 17.5 19z" /><path d="M12 16V9" /><path d="M9 12l3-3 3 3" /></svg>
);
export const IconCloudDown = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M6.5 19a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 17.8 9.1 4.2 4.2 0 0 1 17.5 19z" /><path d="M12 9v7" /><path d="M9 13l3 3 3-3" /></svg>
);
export const IconHistory = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 1 2.3 5.6" /><path d="M4 13v-4h4" /><path d="M12 8v4.5l3 2" /></svg>
);
export const IconEdit = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M14.5 6.5l3 3" /></svg>
);
export const IconCheck = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M4.5 12.5l5 5L19.5 7" /></svg>
);
export const IconZoomIn = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8.5 11h5M11 8.5v5" /></svg>
);
export const IconZoomOut = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8.5 11h5" /></svg>
);
export const IconFit = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
);
export const IconFocus = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" /></svg>
);
export const IconChevron = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
);
export const IconWand = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M5 19L16 8" /><path d="M15 5l1.2 2.3L18.5 8.5 16.2 9.7 15 12l-1.2-2.3L11.5 8.5l2.3-1.2z" /><path d="M19.5 13.5l.7 1.3 1.3.7-1.3.7-.7 1.3-.7-1.3-1.3-.7 1.3-.7z" /></svg>
);

export const IconSearch = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.6-4.6" /></svg>
);
export const IconReplace = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M4 7h10a3 3 0 0 1 3 3v1" /><path d="M14 4l3 3-3 3" /><path d="M20 17H10a3 3 0 0 1-3-3v-1" /><path d="M10 20l-3-3 3-3" /></svg>
);
export const IconOutline = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M4 6h3M10 6h10" /><path d="M7 12h3M13 12h7" /><path d="M10 18h3M16 18h4" /></svg>
);
export const IconSettings = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" /></svg>
);
export const IconUndo = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M9 7L4 12l5 5" /><path d="M4 12h10a5 5 0 0 1 5 5v1" /></svg>
);
export const IconRedo = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M15 7l5 5-5 5" /><path d="M20 12H10a5 5 0 0 0-5 5v1" /></svg>
);
export const IconFormat = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M4 6h16" /><path d="M4 11h10" /><path d="M4 16h13" /><path d="M4 21h7" /></svg>
);
export const IconDots = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></svg>
);
export const IconChevronDown = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
);
export const IconPanel = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
);

/* 应用 Logo：直接使用用户提供的原图（public/icon-source.png），不再自绘矢量。
 * clap：加载页的呼吸动画。 */
export function Logo({ size = 84, clap = false }: { size?: number; clap?: boolean }) {
  return (
    <img
      src="/icon-source.png"
      width={size}
      height={size}
      alt="Tempus"
      draggable={false}
      className={`app-logo${clap ? ' logo-clap' : ''}`}
    />
  );
}

/* ---------- 音频 / 序列 / 设备 ---------- */
export const IconMusic = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24">
    <path d="M9 18V6l10-2v12" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" />
  </svg>
);
export const IconWave = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24">
    <path d="M2 12h2M6 8v8M10 5v14M14 9v6M18 7v10M22 12h-1" />
  </svg>
);
export const IconLayers = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24">
    <path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /><path d="M3 17.5l9 5 9-5" />
  </svg>
);
export const IconCpu = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24">
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3" />
  </svg>
);
export const IconFilm = ({ size, style }: P) => (
  <svg {...s(size)} style={style} viewBox="0 0 24 24">
    <rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M7 5v14M17 5v14M2.5 12h19" />
  </svg>
);
