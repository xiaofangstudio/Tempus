export type CompInfo = {
  id: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

export type ProjectMeta = {
  name: string;
  path: string;
  entry: string;
  fps: number;
  width: number;
  height: number;
};

export type FileEntry = {
  name: string;
  relPath: string;
  isDir: boolean;
  size: number;
};

export type RecentItem = {
  name: string;
  path: string;
  lastOpened: string;
};

export type RenderProgress = {
  frame: number;
  total: number;
  stage: string;
  outPath?: string;
  done: boolean;
  error?: string;
};

export type Mark = { t: number; label: string };
