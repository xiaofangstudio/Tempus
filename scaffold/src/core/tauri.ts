import { invoke } from '@tauri-apps/api/core';
import type { FileEntry, RecentItem, CompInfo, Mark } from './types';

/* 全部后端命令的封装。命名与 Rust 端 #[tauri::command] 一一对应。 */

export const api = {
  fsList: (dir: string) => invoke<FileEntry[]>('fs_list', { dir }),
  fsRead: (path: string) => invoke<string>('fs_read', { path }),
  fsWrite: (path: string, contents: string) => invoke<void>('fs_write', { path, contents }),
  /* 二进制（base64）：素材给预览用 blob URL，离线混音的 WAV 写回磁盘 */
  fsReadBytes: (path: string) => invoke<string>('fs_read_bytes', { path }),
  fsWriteBytes: (path: string, base64Data: string) => invoke<void>('fs_write_bytes', { path, base64Data }),
  sysInfo: () => invoke<{
    cpu: string; cores: number; memGB: number; gpu: string; os: string; suggestParallel: number;
  }>('sys_info'),
  fsMkdir: (path: string) => invoke<void>('fs_mkdir', { path }),
  fsRename: (from: string, to: string) => invoke<void>('fs_rename', { from, to }),
  fsDelete: (path: string) => invoke<void>('fs_delete', { path }),

  projectNew: (dir: string, name: string, files: Record<string, string>) =>
    invoke<string>('project_new', { args: { dir, name, files } }),
  recentGet: () => invoke<RecentItem[]>('recent_get'),
  recentPush: (path: string, name: string) => invoke<void>('recent_push', { path, name }),
  pickFolder: (title: string) => invoke<string | null>('pick_folder', { title }),
  pickSaveFile: (title: string, defaultName: string, ext: string) =>
    invoke<string | null>('pick_save_file', { title, defaultName, ext }),
  projectExportZip: (projectDir: string, outPath: string) => invoke<void>('project_export_zip', { projectDir, outPath }),
  projectImportZip: (zipPath: string, destDir: string) => invoke<string>('project_import_zip', { zipPath, destDir }),

  detectEnv: () => invoke<{ edge: string | null; chrome: string | null; ffmpeg: string | null }>('detect_env'),
  renderExport: (req: {
    html: string;
    comp: CompInfo;
    outPath: string;
    crf: number;
    projectDir: string;
    /** 离线混好的整条音轨（WAV），不传即无声 */
    audioPath?: string | null;
    /** 并行渲染进程数，1 = 串行 */
    parallel?: number;
  }) => invoke<string>('render_export', { req }),
  renderCancel: () => invoke<void>('render_cancel'),
  /** 多段拼接（序列器）：可选的整条配乐 */
  videoConcat: (paths: string[], out: string, audioPath?: string | null) =>
    invoke<void>('video_concat', { paths, out, audioPath: audioPath ?? null }),
  openPath: (path: string) => invoke<void>('open_path', { path }),

  skillsList: () => invoke<{ name: string; file: string; desc: string }[]>('skills_list'),
  skillsRead: (file: string) => invoke<string>('skills_read', { file }),

  mcpStart: (port: number, projectDir: string) => invoke<number>('mcp_start', { port, projectDir }),
  mcpStop: () => invoke<void>('mcp_stop'),
  mcpStatus: () => invoke<{ running: boolean; port: number }>('mcp_status'),
  setCompositions: (comps: CompInfo[], marks: Mark[], docs: Record<string, string>, projectDir: string) =>
    invoke<void>('set_compositions', { args: { comps, marks, docs, projectDir } }),

  /* 终端（ConPTY） */
  ptyCreate: (id: string, cwd: string, rows: number, cols: number) =>
    invoke<void>('pty_create', { id, cwd, rows, cols }),
  ptyWrite: (id: string, data: string) => invoke<void>('pty_write', { id, data }),
  ptyResize: (id: string, cols: number, rows: number) => invoke<void>('pty_resize', { id, cols, rows }),
  ptyClose: (id: string) => invoke<void>('pty_close', { id }),

  /* Git */
  gitAvailable: () => invoke<boolean>('git_available'),
  gitRun: (dir: string, args: string[]) =>
    invoke<{ code: number; stdout: string; stderr: string }>('git_run', { dir, args }),

  recentRemove: (path: string) => invoke<void>('recent_remove', { path })
};

export function listen<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  // 轻封装：动态 import 避免模块级副作用
  return import('@tauri-apps/api/event').then((m) => m.listen<T>(event, (e) => cb(e.payload)));
}
