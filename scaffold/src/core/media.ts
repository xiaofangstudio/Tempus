import { api } from './tauri';

/* 工程素材（音频/图片/字体/视频）→ blob URL。
 *
 * 为什么这么做：用户代码在预览 iframe（srcdoc）里跑，iframe 内没有 Tauri API，
 * 拿不到磁盘文件。srcdoc 继承父文档的 origin，所以父窗口创建的 blob: URL 在 iframe 里
 * 可以直接 <audio src> / <img src> 使用。文档里只注入「路径 → blob URL」这张小表，
 * 素材本身按需加载，不会把 10MB 的音频塞进 srcdoc 字符串。
 *
 * 导出走的是 file:// 页面（无头 Edge），blob URL 在那里不成立 —— 所以导出时音频由
 * OfflineAudioContext 单独离线混音成 WAV，见 audio.ts。 */

export const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac|opus|weba|aiff?)$/i;
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
export const MEDIA_EXT = /\.(mp3|wav|ogg|m4a|aac|flac|opus|weba|aiff?|png|jpe?g|gif|webp|avif|bmp|svg|mp4|webm|woff2?|ttf|otf)$/i;

const MAX_FILE = 64 * 1024 * 1024;   // 单素材上限 64MB
const MAX_FILES = 80;                // 单工程最多挂 80 个素材

const urlCache = new Map<string, string>();

function mimeOf(p: string): string {
  const e = p.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const map: Record<string, string> = {
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
    aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus', weba: 'audio/webm',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
    mp4: 'video/mp4', webm: 'video/webm',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf'
  };
  return map[e] ?? 'application/octet-stream';
}

function b64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

/** 单个素材 → blob URL（带缓存） */
export async function mediaUrl(absPath: string): Promise<string> {
  const hit = urlCache.get(absPath);
  if (hit) return hit;
  const b64 = await api.fsReadBytes(absPath);
  const blob = new Blob([b64ToBytes(b64)], { type: mimeOf(absPath) });
  const url = URL.createObjectURL(blob);
  urlCache.set(absPath, url);
  return url;
}

/** 素材 Blob 本体（波形解码 / 离线混音要用） */
export async function mediaBlob(absPath: string): Promise<Blob> {
  const b64 = await api.fsReadBytes(absPath);
  return new Blob([b64ToBytes(b64)], { type: mimeOf(absPath) });
}

/** 已缓存的 blob URL（没有就返回空串，不触发 IO） */
export function peekUrl(absPath: string): string {
  return urlCache.get(absPath) ?? '';
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'target', '.tempus', '.cache', 'public', 'src-tauri']);

/** 递归扫描工程里的素材文件，返回相对路径列表（正斜杠） */
export async function listMedia(projectDir: string, maxDepth = 4): Promise<string[]> {
  const root = projectDir.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth || out.length >= MAX_FILES) return;
    let list: { name: string; isDir: boolean; size: number }[];
    try { list = await api.fsList(dir); } catch { return; }
    for (const e of list) {
      if (out.length >= MAX_FILES) return;
      if (e.isDir) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        await walk(dir + '/' + e.name, depth + 1);
      } else if (MEDIA_EXT.test(e.name) && (e.size || 0) <= MAX_FILE) {
        const full = dir + '/' + e.name;
        out.push(full.replace(root + '/', ''));
      }
    }
  };
  await walk(root, 0);
  return out;
}

/** 一次性把所有素材转成 blob URL，返回「相对路径 → URL」表（注入 iframe 用） */
export async function buildMediaTable(
  projectDir: string,
  onProgress?: (done: number, total: number) => void
): Promise<Record<string, string>> {
  const rels = await listMedia(projectDir);
  const table: Record<string, string> = {};
  let done = 0;
  for (const rel of rels) {
    try {
      const abs = projectDir.replace(/[\\/]+$/, '') + '/' + rel;
      table[rel] = await mediaUrl(abs);
    } catch { /* 读不了就跳过，运行时回落成原路径 */ }
    done++;
    if (done % 4 === 0 || done === rels.length) onProgress?.(done, rels.length);
  }
  return table;
}

export function revokeAll(): void {
  for (const u of urlCache.values()) URL.revokeObjectURL(u);
  urlCache.clear();
}
