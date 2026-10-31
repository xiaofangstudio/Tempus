import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { api, listen } from '../core/tauri';
import { compileProject, buildDocumentCached } from '../core/compile';
import { buildMediaTable, AUDIO_EXT, MEDIA_EXT } from '../core/media';
import { mixTimelineWav, bytesToBase64, type AudioClip } from '../core/audio';
import type { ScopeFile } from './AudioScope';
import type { CompInfo, Mark, ProjectMeta, RenderProgress } from '../core/types';
import type { EditorHandle, DiffSpec } from '../ide/EditorPane';
import { GitPanel } from '../ide/GitPanel';
import { CommandPalette, type Command } from '../ide/CommandPalette';
import { QuickOpen } from '../ide/QuickOpen';
import { NewFileDialog } from '../ide/NewFileDialog';
import { Sequencer } from './Sequencer';
import { MenuBar, type MenuGroup } from '../ide/MenuBar';
import { askText, askAlert } from '../ui/dialog';
import { FramePicker } from '../ui/FramePicker';
import { buildVisualFile, buildAudioFile, compIdFromPath } from '../core/newfile';
import { Splitter, remember } from '../ui/Splitter';
import { PreviewPane, type PreviewHandle } from './PreviewPane';
import { Timeline } from './Timeline';
import { ExportDialog } from './ExportDialog';
import { RightPanels } from './RightPanels';
import {
  Logo, IconBranch, IconExport, IconFile, IconRefresh, IconTerminal, IconPlus,
  IconSearch, IconOutline, IconSettings, IconSave, IconUpload, IconSun, IconMoon
} from '../ui/icons';
import { loadSettings, saveSettings, onSettings, type Theme } from '../core/settings';

/* 工作区编排：
 * 左侧活动栏（资源管理器 / 搜索 / 源代码管理 / 大纲 / 设置）+ 编辑器 → 增量编译 → 注入预览
 * 右侧监视器与时间轴；底部状态栏 + 真终端；Ctrl+Shift+P 命令面板。
 *
 * 性能设计：
 * - Monaco / xterm / 面板懒加载（欢迎页与加载页不再为编辑器买单）
 * - 播放时每帧 setState 只让顶栏 / 监视器 / 时间轴重渲染，
 *   编辑器、文件树、Git、右侧面板全部 memo 隔离。
 * - 编译重入保护：编译进行中再次触发只记一次 pending，结束后补跑一次。 */

const EditorPane = React.memo(lazy(() =>
  import('../ide/EditorPane').then((m) => ({ default: m.EditorPane }))));
const TerminalPane = lazy(() =>
  import('../ide/TerminalPane').then((m) => ({ default: m.TerminalPane })));
const FileTree = React.memo(lazy(() =>
  import('../ide/FileTree').then((m) => ({ default: m.FileTree }))));
const SearchPanel = React.memo(lazy(() =>
  import('../ide/SearchPanel').then((m) => ({ default: m.SearchPanel }))));
const OutlinePanel = React.memo(lazy(() =>
  import('../ide/OutlinePanel').then((m) => ({ default: m.OutlinePanel }))));
const SettingsPanel = React.memo(lazy(() =>
  import('../ide/SettingsPanel').then((m) => ({ default: m.SettingsPanel }))));
const MemoGitPanel = React.memo(GitPanel);

type Props = { projectDir: string; onExit: () => void };
type SideTab = 'files' | 'search' | 'git' | 'outline' | 'settings';

/* 布局尺寸的持久化句柄（模块级常量：放进组件里每次渲染都是新对象，会打爆 useEffect） */
const MEM_RIGHT = remember('tempus.rightW');
const MEM_RP = remember('tempus.rightPanelsW');
const MEM_TL = remember('tempus.timelineH');

function langOfReal(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith('.tsx') || p.endsWith('.ts')) return 'typescript';
  if (p.endsWith('.jsx') || p.endsWith('.js') || p.endsWith('.mjs')) return 'javascript';
  if (p.endsWith('.css')) return 'css';
  if (p.endsWith('.json')) return 'json';
  if (p.endsWith('.html')) return 'html';
  if (p.endsWith('.md')) return 'markdown';
  return 'plaintext';
}

const PaneSkeleton = ({ text }: { text: string }) => (
  <div className="pane-skeleton">
    <div className="sk-bar" />
    <span>{text}</span>
  </div>
);

export function Workspace({ projectDir, onExit }: Props) {
  const [meta, setMeta] = useState<ProjectMeta | null>(null);
  const [srcDoc, setSrcDoc] = useState('');
  const [comps, setComps] = useState<CompInfo[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [activeComp, setActiveComp] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [compileMsg, setCompileMsg] = useState<{ kind: 'ok' | 'err' | 'busy'; text: string }>({ kind: 'busy', text: '正在编译……' });
  const [exportOpen, setExportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [sideTab, setSideTab] = useState<SideTab>('files');
  const [termOpen, setTermOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [sideW, setSideW] = useState<number | null>(null);
  /* 主题：顶栏一键切换是主入口（设置面板里那个太深，用户找不到） */
  const [theme, setTheme] = useState<Theme>(() => loadSettings().theme);
  useEffect(() => onSettings((s) => setTheme(s.theme)), []);
  const setThemeNow = useCallback((t: Theme): void => {
    setTheme(t);
    saveSettings({ theme: t });
  }, []);
  const toggleTheme = useCallback((): void => {
    setThemeNow(loadSettings().theme === 'dark' ? 'light' : 'dark');
  }, [setThemeNow]);

  /* ---- 布局尺寸：全部可拖，全部记忆 ----
   * 用户原话"整个模块都是可以自由拖动的" —— 写死的 flex 比例必须让位。
   * 没拖过的值保持 null（用 CSS 默认），拖过才变成固定像素并落盘。 */
  const rightRef = useRef<HTMLDivElement>(null);
  const rpRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<HTMLDivElement>(null);
  const [rightW, setRightW] = useState<number | null>(null);
  const [rpW, setRpW] = useState<number | null>(null);
  const [tlH, setTlH] = useState<number | null>(null);
  const memRight = MEM_RIGHT;
  const memRp = MEM_RP;
  const memTl = MEM_TL;

  useEffect(() => {
    setRightW(memRight.load(360, 2400));
    setRpW(memRp.load(180, 560));
    setTlH(memTl.load(96, 460));
  }, [memRight, memRp, memTl]);

  /* 窗口变小后固定宽度不能把代码区挤到看不见 */
  useEffect(() => {
    const onR = (): void => {
      const lim = Math.max(360, window.innerWidth - 440);
      setRightW((w) => (w == null ? w : Math.min(w, lim)));
    };
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);
  const [cursor, setCursor] = useState<{ line: number; col: number; sel: number } | null>(null);
  const [toast, setToast] = useState('');
  const [audioFiles, setAudioFiles] = useState<ScopeFile[]>([]);
  /* 预览 iframe 上报的音频加载失败（静默无声是最难查的故障，必须显式化） */
  const [audioFailed, setAudioFailed] = useState<string[]>([]);
  /* 素材表：相对路径 → blob URL，注入预览 iframe 给 Audio/staticFile 用 */
  const mediaRef = useRef<Record<string, string>>({});
  const lastBuildRef = useRef<{ userJs: string; userCss: string } | null>(null);

  const onDirtyTree = useCallback(() => {}, []);

  const bus = useRef<{ editor?: EditorHandle; refreshTree?: () => void }>({});

  /* 状态栏提示：3.2 秒自动消失 */
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  /* 侧栏宽度：可拖拽，记忆到 localStorage。
   * 拖动期间给 body 加 col-resizing，CSS 关掉 width 过渡，避免跟手感变黏。 */
  useEffect(() => {
    const saved = Number(localStorage.getItem('tempus.sideW'));
    if (Number.isFinite(saved) && saved >= 180 && saved <= 760) setSideW(saved);
  }, []);

  const startResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const wrap = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null;
    const startW = wrap?.getBoundingClientRect().width ?? 224;
    document.body.classList.add('col-resizing');
    const onMove = (ev: MouseEvent) => {
      const w = Math.round(Math.min(760, Math.max(180, startW + ev.clientX - startX)));
      setSideW(w);
    };
    const onUp = () => {
      document.body.classList.remove('col-resizing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (wrap) {
        try { localStorage.setItem('tempus.sideW', String(Math.round(wrap.getBoundingClientRect().width))); }
        catch { /* 隐私模式下写入可能失败，忽略 */ }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const vendorRef = useRef<string>('');
  const previewRef = useRef<PreviewHandle>(null);
  const frameRef = useRef(0);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const compsRef = useRef<CompInfo[]>([]);
  const activeRef = useRef<string | null>(null);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const accRef = useRef(0);
  const compilingRef = useRef(false);
  const pendingRef = useRef(false);

  compsRef.current = comps;
  activeRef.current = activeComp;

  /* 项目元信息 */
  useEffect(() => {
    (async () => {
      try {
        const raw = await api.fsRead(projectDir + '/project.json');
        const m = JSON.parse(raw) as ProjectMeta & { frame?: string };
        setMeta(m);
        document.title = `Tempus — ${m.name}`;
        /* 没定过画幅就先问一次（选择结果写回 project.json，之后不再打扰） */
        if (!m.frame) setFramePick(true);
      } catch (e) {
        setCompileMsg({ kind: 'err', text: '工程缺少 project.json，无法加载：' + String(e) });
      }
    })();
  }, [projectDir]);

  const pickFrame = useCallback(async (w: number, h: number, id: string): Promise<void> => {
    setFramePick(false);
    const next = { ...(meta ?? ({} as ProjectMeta)), width: w, height: h, frame: id };
    try {
      await api.fsWrite(projectDir + '/project.json', JSON.stringify(next, null, 2));
      setMeta(next as ProjectMeta);
      setToast(`画幅已设为 ${id} · ${w}×${h}`);
    } catch (e) {
      setToast('保存画幅失败：' + String(e));
    }
  }, [meta, projectDir]);

  /* vendor 预取 */
  useEffect(() => {
    fetch('/render/vendor.js').then((r) => r.text()).then((t) => { vendorRef.current = t; }).catch(() => {});
  }, []);

  /* 素材表：扫描工程里的音频/图片 → blob URL。
   * 建表是 IO，不阻塞首屏编译；完成后若有产物就静默重注入一次。 */
  const refreshMedia = useCallback(async (): Promise<void> => {
    try {
      const table = await buildMediaTable(projectDir);
      const changed = Object.keys(table).length !== Object.keys(mediaRef.current).length
        || Object.keys(table).some((k) => mediaRef.current[k] !== table[k]);
      mediaRef.current = table;
      const root = projectDir.replace(/[\\/]+$/, '');
      const auds = Object.keys(table).filter((k) => AUDIO_EXT.test(k));
      setAudioFiles(auds.map((rel) => ({ rel, abs: root + '/' + rel })));
      if (changed && lastBuildRef.current && vendorRef.current) {
        const b = lastBuildRef.current;
        setSrcDoc(buildDocumentCached(vendorRef.current, b.userJs, b.userCss, activeRef.current, table));
        setAudioFailed([]);
      }
    } catch { /* 素材扫描失败不影响编译 */ }
  }, [projectDir]);

  useEffect(() => { void refreshMedia(); }, [refreshMedia]);

  /* 预览 iframe 里的 <Audio> 加载失败 → 收上来在监视器与状态栏显式提示 */
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      const d = e.data as { __tempus?: string; src?: string } | null;
      if (!d || d.__tempus !== 'audio-error') return;
      const src = String(d.src ?? '');
      if (!src) return;
      setAudioFailed((prev) => (prev.includes(src) ? prev : [...prev, src]));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  /* 从系统拖文件进来 → 拷到工程的 assets/（省掉「先复制到别处再找路径」） */
  const [dragOver, setDragOver] = useState(false);
  const importDropped = useCallback(async (paths: string[]): Promise<void> => {
    const media = paths.filter((p) => MEDIA_EXT.test(p));
    if (!media.length) {
      setToast('拖进来的不是媒体文件（支持 mp3 / wav / png / jpg / mp4 等）');
      return;
    }
    const destDir = projectDir.replace(/[\\/]+$/, '') + '/assets';
    const exists = async (p: string): Promise<boolean> => {
      try { await api.fsRead(p); return true; } catch { return false; }
    };
    let ok = 0;
    for (const src of media) {
      const baseName = src.split(/[\\/]/).pop() ?? 'asset';
      let name = baseName;
      let i = 1;
      while (await exists(destDir + '/' + name)) {
        name = baseName.replace(/(\.[^.]+)$/, `-${i}$1`);
        i++;
      }
      try {
        const b64 = await api.fsReadBytes(src);
        await api.fsWriteBytes(destDir + '/' + name, b64);
        ok++;
      } catch { /* 单个失败不影响其它 */ }
    }
    if (ok > 0) {
      await refreshMedia();
      bus.current.refreshTree?.();
      void compileNowRef.current();
      setToast(`已导入 ${ok} 个素材到 assets/`);
    } else {
      setToast('导入失败（文件被占用或没有权限）');
    }
  }, [projectDir, refreshMedia]);

  useEffect(() => {
    let alive = true;
    let un: (() => void) | null = null;
    void (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const off = await getCurrentWebview().onDragDropEvent((e) => {
          if (e.payload.type === 'over') { setDragOver(true); return; }
          if (e.payload.type === 'leave') { setDragOver(false); return; }
          if (e.payload.type === 'drop') {
            setDragOver(false);
            void importDropped(e.payload.paths);
          }
        });
        if (alive) un = off; else off();
      } catch { /* 非 Tauri 环境（浏览器调试）忽略 */ }
    })();
    return () => { alive = false; un?.(); };
  }, [importDropped]);

  /* 编译循环：src 变化 → esbuild → srcdoc（带重入保护） */
  const compileNowRef = useRef<() => Promise<void>>(async () => {});
  const mediaReadyRef = useRef(false);
  const compileNow = useCallback(async () => {
    if (!meta || !vendorRef.current) return;
    if (compilingRef.current) { pendingRef.current = true; return; }
    compilingRef.current = true;
    /* 首次编译前等素材表就绪：否则 Audio 拿到的是相对路径，会白报一次加载失败 */
    if (!mediaReadyRef.current) {
      try { await refreshMedia(); } catch { /* 素材缺失不该挡住编译 */ }
      mediaReadyRef.current = true;
    }
    setCompileMsg({ kind: 'busy', text: '正在编译……' });
    try {
      const res = await compileProject(projectDir, meta.entry);
      if (!res.ok || !res.userJs) {
        setCompileMsg({ kind: 'err', text: '编译失败 · ' + (res.error ?? '').split('\n')[0] });
        return;
      }
      /* 产物未变化时跳过 iframe 重载（无谓的整页刷新是卡顿大户） */
      const prev = lastBuildRef.current;
      if (prev && prev.userJs === res.userJs && prev.userCss === (res.userCss ?? '')) {
        setCompileMsg({ kind: 'ok', text: '编译通过（内容未变）' });
        return;
      }
      lastBuildRef.current = { userJs: res.userJs, userCss: res.userCss ?? '' };
      const doc = buildDocumentCached(vendorRef.current, res.userJs, res.userCss ?? '', activeRef.current, mediaRef.current);
      setSrcDoc(doc);
      setAudioFailed([]);
      setCompileMsg({ kind: 'ok', text: '编译通过' });
    } catch (e) {
      setCompileMsg({ kind: 'err', text: '编译异常：' + String(e) });
    } finally {
      compilingRef.current = false;
      if (pendingRef.current) { pendingRef.current = false; void compileNowRef.current(); }
    }
  }, [meta, projectDir, refreshMedia]);
  compileNowRef.current = compileNow;

  /* iframe 挂载/更新后：读取注册的合成，并缓存每种合成的导出文档（供 MCP 渲染） */
  const handlePreviewReady = useCallback(() => {
    try {
      const w = (previewRef.current?.getWindow() ?? null) as any;
      if (!w || !w.__comp) return;
      const list: CompInfo[] = w.__comps ?? [];
      const mk: Mark[] = w.KR ? w.KR.getMarks() : [];
      setComps(list);
      setMarks(mk);
      if (!activeRef.current && list.length > 0) {
        activeRef.current = list[0].id;
        setActiveComp(list[0].id);
      }
      // 为每种合成生成导出文档并推给后端（MCP 的 render_video 使用）——走缓存
      if (vendorRef.current && lastBuildRef.current) {
        const docs: Record<string, string> = {};
        for (const c of list) {
          docs[c.id] = buildDocumentCached(vendorRef.current, lastBuildRef.current.userJs, lastBuildRef.current.userCss, c.id);
        }
        api.setCompositions(list, mk, docs, projectDir).catch(() => {});
      }
      const dur = w.__comp.durationInFrames;
      if (typeof dur === 'number' && frameRef.current >= dur) { frameRef.current = 0; setFrame(0); }
      previewRef.current?.seek(frameRef.current);
      /* iframe 重载后新窗口没有播放状态，重设一次（否则音频不会自动播/停） */
      previewRef.current?.setPlaying(playingRef.current);
    } catch { /* 预览未就绪时忽略 */ }
  }, [projectDir]);

  useEffect(() => {
    if (meta) void compileNow();
  }, [meta, compileNow]);

  /* 播放时钟：rAF 按帧率推进 */
  useEffect(() => {
    if (!playing) { cancelAnimationFrame(rafRef.current); return; }
    const fps = compsRef.current.find((c) => c.id === activeRef.current)?.fps ?? 30;
    const step = (ts: number): void => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      accRef.current += (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      const frameDur = 1 / fps;
      let advanced = false;
      while (accRef.current >= frameDur) {
        accRef.current -= frameDur;
        frameRef.current += 1;
        advanced = true;
      }
      const dur = compsRef.current.find((c) => c.id === activeRef.current)?.durationInFrames ?? Infinity;
      if (frameRef.current >= dur) {
        if (loop) { frameRef.current = 0; } else { frameRef.current = Math.max(0, dur - 1); setPlaying(false); }
      }
      if (advanced) {
        setFrame(frameRef.current);
        previewRef.current?.seek(frameRef.current);
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(rafRef.current); lastTsRef.current = 0; accRef.current = 0; };
  }, [playing, loop]);

  const seekRafRef = useRef(0);
  useEffect(() => () => cancelAnimationFrame(seekRafRef.current), []);
  const seek = useCallback((f: number) => {
    const dur = compsRef.current.find((c) => c.id === activeRef.current)?.durationInFrames ?? 0;
    if (dur <= 0) return;
    const clamped = Math.max(0, Math.min(dur - 1, Math.round(f)));
    /* 拖拽时间轴会高频触发：合并到 rAF，一帧最多提交一次 */
    if (seekRafRef.current) cancelAnimationFrame(seekRafRef.current);
    seekRafRef.current = requestAnimationFrame(() => {
      seekRafRef.current = 0;
      frameRef.current = clamped;
      setFrame(clamped);
      previewRef.current?.seek(clamped);
    });
  }, []);

  /* 渲染进度事件 */
  const [renderProg, setRenderProg] = useState<RenderProgress | null>(null);
  useEffect(() => {
    const un = listen<RenderProgress>('render-progress', (p) => setRenderProg(p));
    return () => { un.then((f) => f()).catch(() => {}); };
  }, []);

  /* MCP write_file → 热刷新打开的标签并重编译预览（Rust 端发 mcp-file-changed） */
  useEffect(() => {
    const un = listen<string>('mcp-file-changed', (rel) => {
      const root = projectDir.replace(/[\\/]+$/, '');
      const full = root + '/' + String(rel).replace(/\\/g, '/');
      void bus.current.editor?.reloadFile(full);
      void compileNow();
    });
    return () => { un.then((f) => f()).catch(() => {}); };
  }, [projectDir, compileNow]);

  /* MCP set_frame：后端改完 project.json 发事件，这里把界面刷成新画幅 */
  useEffect(() => {
    const un = listen<{ width: number; height: number }>('mcp-frame-changed', (p) => {
      setMeta((m) => (m ? { ...m, width: p.width, height: p.height } : m));
      setToast(`画幅已改为 ${p.width}×${p.height}`);
    });
    return () => { un.then((f) => f()).catch(() => {}); };
  }, []);

  /* Git diff：按 kind 取基线与当前内容，喂给编辑器 diff 视图 */
  const openGitDiff = useCallback(async (rel: string, kind: 'worktree' | 'index'): Promise<void> => {
    const root = projectDir.replace(/[\\/]+$/, '');
    const real = root + '\\' + rel.replace(/\//g, '\\');
    let base = '';
    let current = '';
    try {
      if (kind === 'worktree') {
        const idx = await api.gitRun(projectDir, ['show', ':' + rel]);
        base = idx.code === 0 ? idx.stdout : '';
        try { current = await api.fsRead(real); } catch { current = ''; }
      } else {
        const head = await api.gitRun(projectDir, ['show', 'HEAD:' + rel]);
        base = head.code === 0 ? head.stdout : '';
        const idx = await api.gitRun(projectDir, ['show', ':' + rel]);
        current = idx.code === 0 ? idx.stdout : '';
      }
    } catch { /* 显示空基线 */ }
    const spec: DiffSpec = {
      title: `${rel}（${kind === 'index' ? '已暂存' : '工作区改动'}）`,
      base, current, lang: langOfReal(rel)
    };
    bus.current.editor?.openDiff(spec);
  }, [projectDir]);

  const onSelectComp = useCallback((id: string) => {
    activeRef.current = id;
    setActiveComp(id);
  }, []);

  /* 切换合成需要重建注入文档（compId 变了） */
  useEffect(() => {
    if (!meta || !vendorRef.current || !lastBuildRef.current) return;
    const doc = buildDocumentCached(vendorRef.current, lastBuildRef.current.userJs, lastBuildRef.current.userCss, activeComp, mediaRef.current);
    setSrcDoc(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeComp]);

  const saveAllNow = useCallback(() => { void bus.current.editor?.saveAll(); }, []);

  /* 新建文件：先选类型（画面 / 音频），两类文件写法不同 */
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [seqOpen, setSeqOpen] = useState(false);
  /* 首次进入工程时先定画幅（写进 project.json 的 frame 字段后不再弹） */
  const [framePick, setFramePick] = useState(false);

  const createFile = useCallback(async (kind: 'visual' | 'audio', name: string): Promise<string> => {
    setNewFileOpen(false);
    const rel = name.replace(/\\/g, '/').replace(/^\/+/, '');
    const withExt = /\.[a-z0-9]+$/i.test(rel) ? rel : rel + '.tsx';
    const full = projectDir.replace(/[\\/]+$/, '') + '/' + withExt;
    const w = meta?.width ?? 1920;
    const h = meta?.height ?? 1080;
    const fps = meta?.fps ?? 30;

    const src = kind === 'visual'
      ? buildVisualFile({ width: w, height: h, fps, id: compIdFromPath(withExt) })
      : buildAudioFile();

    try {
      await api.fsWrite(full, src);
      bus.current.refreshTree?.();
      await bus.current.editor?.openFile(full);
      setToast(`已创建 ${withExt}`);
      return withExt;
    } catch (e) {
      const msg = '创建失败：' + String(e);
      setToast(msg);
      throw new Error(msg);
    }
  }, [projectDir, meta]);

  const newFile = useCallback(async (): Promise<void> => {
    setNewFileOpen(true);
  }, []);

  /* MCP 请求桥：create_file（模板在前端）、set_theme（存在 localStorage）
   * 只有前端能做 —— 后端发事件等回话，这里处理完把结果送回去。 */
  useEffect(() => {
    const un = listen<{ reqId: number; kind: string; args: Record<string, string> }>('mcp-request', (p) => {
      const { reqId, kind, args } = p;
      void (async () => {
        try {
          let res: Record<string, unknown> = { ok: true };
          if (kind === 'create_file') {
            const k: 'visual' | 'audio' = args.kind === 'audio' ? 'audio' : 'visual';
            const path = await createFile(k, args.path ?? 'untitled.tsx');
            res = { ok: true, path, kind: k };
          } else if (kind === 'set_theme') {
            const cur = loadSettings().theme;
            const next: Theme = args.theme === 'toggle'
              ? (cur === 'dark' ? 'light' : 'dark')
              : (args.theme === 'dark' ? 'dark' : 'light');
            setThemeNow(next);
            setToast(`AI 把主题切成了${next === 'dark' ? '暗色' : '浅色'}`);
            res = { ok: true, theme: next, previous: cur };
          } else {
            setToast(`AI 发来一个不认识的请求：${kind}`);
            res = { ok: false, error: `前端不认识这个请求：${kind}` };
          }
          await api.mcpRespond(reqId, JSON.stringify(res));
        } catch (err) {
          setToast('AI 的这次操作失败了，详见错误条');
          await api.mcpRespond(reqId, JSON.stringify({ ok: false, error: String(err) })).catch(() => {});
        }
      })();
    });
    return () => { un.then((f) => f()).catch(() => {}); };
  }, [createFile, setThemeNow]);
  const handleSearchChanged = useCallback(() => { void compileNow(); }, [compileNow]);
  const handleOpenDiff = useCallback((rel: string, kind: 'worktree' | 'index') => {
    void openGitDiff(rel, kind);
  }, [openGitDiff]);

  /* 命令面板 */
  const commands: Command[] = [
    { id: 'newfile', title: '新建文件（画面 / 音频）', hint: 'Ctrl+N', run: () => void newFile() },
    { id: 'theme', title: theme === 'dark' ? '切换为浅色主题' : '切换为暗色主题', hint: 'Ctrl+Shift+L', run: toggleTheme },
    { id: 'frame', title: '画幅设置…', run: () => setFramePick(true) },
    { id: 'quickopen', title: '转到文件', hint: 'Ctrl+P', run: () => setQuickOpen(true) },
    { id: 'save', title: '保存全部文件', hint: 'Ctrl+S', run: saveAllNow },
    { id: 'compile', title: '编译并刷新预览', hint: 'Ctrl+R', run: () => void compileNow() },
    { id: 'search', title: '在工程中搜索', hint: 'Ctrl+Shift+F', run: () => setSideTab('search') },
    { id: 'outline', title: '打开大纲', run: () => setSideTab('outline') },
    { id: 'settings', title: '打开设置', hint: 'Ctrl+,', run: () => setSideTab('settings') },
    { id: 'undo', title: '撤销', hint: 'Ctrl+Z', run: () => bus.current.editor?.undo() },
    { id: 'redo', title: '重做', hint: 'Ctrl+Y', run: () => bus.current.editor?.redo() },
    { id: 'format', title: '格式化当前文档', hint: 'Shift+Alt+F', run: () => bus.current.editor?.format() },
    { id: 'find', title: '在当前文件中查找', hint: 'Ctrl+F', run: () => bus.current.editor?.find() },
    { id: 'replace', title: '在当前文件中替换', hint: 'Ctrl+H', run: () => bus.current.editor?.replace() },
    { id: 'export', title: '导出视频（MP4）', hint: 'Ctrl+E', run: () => setExportOpen(true) },
    { id: 'term', title: '切换终端', hint: 'Ctrl+`', run: () => setTermOpen((v) => !v) },
    { id: 'git', title: '源代码管理：打开 Git 面板', run: () => setSideTab('git') },
    { id: 'files', title: '资源管理器：打开文件面板', run: () => setSideTab('files') },
    { id: 'reveal', title: '在文件资源管理器中显示工程目录', run: () => void api.openPath(projectDir).catch(() => {}) },
    { id: 'exit', title: '关闭工程，返回欢迎页', run: () => onExit() }
  ];

  /* 全局快捷键（编辑器内的 Ctrl+S 由 EditorPane 捕获处理） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isField = tag === 'INPUT' || tag === 'TEXTAREA';

      /* 面板类快捷键在输入框内也生效 */
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') { e.preventDefault(); setSideTab('search'); return; }
      if (e.ctrlKey && !e.shiftKey && e.code === 'KeyP') { e.preventDefault(); setPaletteOpen(false); setQuickOpen(true); return; }
      if (e.ctrlKey && !e.shiftKey && e.code === 'Comma') { e.preventDefault(); setSideTab('settings'); return; }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyP') { e.preventDefault(); setQuickOpen(false); setPaletteOpen(true); return; }
      if (e.ctrlKey && !e.shiftKey && e.code === 'KeyN') { e.preventDefault(); void newFile(); return; }
      /* 明暗切换：Ctrl+Shift+L（VSCode 里 L 常被占用，这里作为专用入口） */
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyL') { e.preventDefault(); toggleTheme(); return; }

      if (isField) {
        if (e.ctrlKey && e.code === 'KeyE') { e.preventDefault(); setExportOpen(true); }
        return;
      }
      if (e.ctrlKey && e.code === 'Backquote') { e.preventDefault(); setTermOpen((v) => !v); }
      else if (e.ctrlKey && e.code === 'KeyR') { e.preventDefault(); void compileNow(); }
      else if (e.code === 'Space') { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); seek(frameRef.current - 1); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); seek(frameRef.current + 1); }
      else if (e.ctrlKey && e.code === 'KeyE') { e.preventDefault(); setExportOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seek, compileNow, newFile, toggleTheme]);

  const cur = comps.find((c) => c.id === activeComp) ?? comps[0] ?? null;
  const projName = meta?.name ?? projectDir.split(/[\\/]/).pop() ?? '工程';
  const fileName = activeFile ? activeFile.split(/[\\/]/).pop() : '';

  /* ---------------- 菜单栏 ---------------- */
  const edCmd = (fn: (h: EditorHandle) => void) => (): void => {
    const h = bus.current.editor;
    if (h) fn(h);
  };

  const stepComp = (dir: 1 | -1): void => {
    if (comps.length < 2) return;
    const i = comps.findIndex((c) => c.id === activeComp);
    const next = comps[((i < 0 ? 0 : i) + dir + comps.length) % comps.length];
    if (next) onSelectComp(next.id);
  };

  const gotoCmd = (): void => {
    void (async () => {
      const v = await askText({ title: '转到行', label: '行号', placeholder: '1', okText: '跳转' });
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) bus.current.editor?.gotoLine(Math.floor(n));
    })();
  };

  const menus: MenuGroup[] = [
    {
      id: 'file', label: '文件', items: [
        { id: 'new', label: '新建文件…', hint: 'Ctrl+N', run: () => void newFile() },
        { id: 'save', label: '保存全部', hint: 'Ctrl+S', run: saveAllNow },
        { id: 'f-s1', sep: true },
        { id: 'open', label: '转到文件…', hint: 'Ctrl+P', run: () => { setPaletteOpen(false); setQuickOpen(true); } },
        { id: 'f-s2', sep: true },
        { id: 'export', label: '导出视频（MP4）…', hint: 'Ctrl+E', disabled: !cur, run: () => setExportOpen(true) },
        { id: 'reveal', label: '在资源管理器中打开工程目录', run: () => { void api.openPath(projectDir).catch(() => {}); } },
        { id: 'f-s3', sep: true },
        { id: 'exit', label: '关闭工程，返回欢迎页', run: () => onExit() }
      ]
    },
    {
      id: 'edit', label: '编辑', items: [
        { id: 'undo', label: '撤销', hint: 'Ctrl+Z', run: edCmd((h) => h.undo()) },
        { id: 'redo', label: '重做', hint: 'Ctrl+Y', run: edCmd((h) => h.redo()) },
        { id: 'e-s1', sep: true },
        { id: 'format', label: '格式化文档', hint: 'Shift+Alt+F', run: edCmd((h) => h.format()) },
        { id: 'e-s2', sep: true },
        { id: 'find', label: '查找', hint: 'Ctrl+F', run: edCmd((h) => h.find()) },
        { id: 'replace', label: '替换', hint: 'Ctrl+H', run: edCmd((h) => h.replace()) },
        { id: 'e-s3', sep: true },
        { id: 'palette', label: '命令面板…', hint: 'Ctrl+Shift+P', run: () => { setQuickOpen(false); setPaletteOpen(true); } }
      ]
    },
    {
      id: 'select', label: '选择', items: [
        { id: 'all', label: '全选', hint: 'Ctrl+A', run: edCmd((h) => h.selectAll()) },
        { id: 'expand', label: '扩大选区', hint: 'Shift+Alt+→', run: edCmd((h) => h.expandSelection()) }
      ]
    },
    {
      id: 'view', label: '查看', items: [
        { id: 'files', label: '资源管理器', checked: sideTab === 'files', run: () => setSideTab('files') },
        { id: 'search', label: '在工程中搜索', hint: 'Ctrl+Shift+F', checked: sideTab === 'search', run: () => setSideTab('search') },
        { id: 'git', label: '源代码管理', checked: sideTab === 'git', run: () => setSideTab('git') },
        { id: 'outline', label: '大纲', checked: sideTab === 'outline', run: () => setSideTab('outline') },
        { id: 'v-s1', sep: true },
        { id: 'term', label: '终端面板', hint: 'Ctrl+`', checked: termOpen, run: () => setTermOpen((v) => !v) },
        { id: 'v-s2', sep: true },
        { id: 'v-theme', label: '主题：暗色', hint: 'Ctrl+Shift+L', checked: theme === 'dark', run: () => setThemeNow('dark') },
        { id: 'v-light', label: '主题：浅色', checked: theme === 'light', run: () => setThemeNow('light') },
        { id: 'v-frame', label: '画幅设置…', run: () => setFramePick(true) },
        { id: 'v-s3', sep: true },
        { id: 'settings', label: '设置', hint: 'Ctrl+,', checked: sideTab === 'settings', run: () => setSideTab('settings') }
      ]
    },
    {
      id: 'go', label: '转到', items: [
        { id: 'gofile', label: '转到文件…', hint: 'Ctrl+P', run: () => { setPaletteOpen(false); setQuickOpen(true); } },
        { id: 'goline', label: '转到行…', hint: 'Ctrl+G', run: gotoCmd },
        { id: 'g-s1', sep: true },
        { id: 'nextcomp', label: '下一个动效组件', disabled: comps.length < 2, run: () => stepComp(1) },
        { id: 'prevcomp', label: '上一个动效组件', disabled: comps.length < 2, run: () => stepComp(-1) }
      ]
    },
    {
      id: 'run', label: '运行', items: [
        { id: 'compile', label: '编译并刷新预览', hint: 'Ctrl+R', run: () => { void compileNow(); } },
        { id: 'play', label: playing ? '暂停' : '播放', hint: 'Space', disabled: !cur, run: () => setPlaying((p) => !p) },
        { id: 'first', label: '回到首帧', disabled: !cur, run: () => { setPlaying(false); seek(0); } },
        { id: 'r-s1', sep: true },
        { id: 'seq', label: '序列器：多文件合并渲染…', disabled: comps.length === 0, run: () => setSeqOpen(true) },
        { id: 'export2', label: '导出视频（MP4）…', hint: 'Ctrl+E', disabled: !cur, run: () => setExportOpen(true) }
      ]
    },
    {
      id: 'term', label: '终端', items: [
        { id: 'toggle', label: termOpen ? '隐藏终端' : '显示终端', hint: 'Ctrl+`', run: () => setTermOpen((v) => !v) },
        { id: 'newterm', label: '新开一个终端', run: () => { setTermOpen(false); window.setTimeout(() => setTermOpen(true), 0); } }
      ]
    },
    {
      id: 'help', label: '帮助', items: [
        {
          id: 'keys', label: '快捷键一览', run: () => void askAlert({
            title: '快捷键一览',
            wide: true,
            mono: true,
            message: [
              '编辑器',
              '  Ctrl+S           保存全部          Shift+Alt+F     格式化',
              '  Ctrl+Z / Ctrl+Y  撤销 / 重做       Ctrl+F / Ctrl+H 查找 / 替换',
              '  Ctrl+W           关闭当前标签      Ctrl+Tab        下一个标签',
              '',
              '导航',
              '  Ctrl+P           快速打开文件      Ctrl+Shift+P    命令面板',
              '  Ctrl+Shift+F     工程内搜索        Ctrl+G          转到行',
              '  Ctrl+N           新建文件',
              '',
              '外观',
              '  Ctrl+Shift+L     浅色 / 暗色切换',
              '',
              '预览与运行',
              '  Ctrl+R           编译并刷新预览    Space           播放 / 暂停',
              '  ← / →            上一帧 / 下一帧   Ctrl+滚轮       缩放预览',
              '  Ctrl+E           导出 MP4',
              '',
              '面板',
              '  Ctrl+`           终端              Ctrl+,          设置'
            ].join('\n')
          })
        },
        { id: 'h-s1', sep: true },
        {
          id: 'about', label: '关于 Tempus', run: () => void askAlert({
            title: '关于 Tempus',
            message: 'Tempus — 编码动效工作室\n人写代码，实时渲染成片。\n\n版本 0.1.0 · 小方工作室\n2026'
          })
        }
      ]
    }
  ];

  return (
    <div className="ws">
      <div className="ws-top">
        <span className="ws-brand" title="Tempus · 小方工作室"><Logo size={24} /></span>
        <span className="ws-title" title={projectDir}>{projName}</span>
        <span className={`ws-dot ${compileMsg.kind}`} title={compileMsg.text} />
        <span className="tb-sep" />
        <MenuBar menus={menus} />
        <span className="tb-sep" />

        <div className="ws-actions">
          {/* 新建文件：Ctrl+N 记不住，给一个能点的加号（首选入口） */}
          <button className="icon-btn tb accent" title="新建文件（Ctrl+N）" onClick={() => void newFile()}>
            <IconPlus size={15} />
          </button>
          <span className="tb-sep" />
          <button className="icon-btn tb" title="保存全部（Ctrl+S）" onClick={saveAllNow}>
            <IconSave size={15} />
          </button>
          <button
            className={`icon-btn tb ${sideTab === 'search' ? 'active' : ''}`}
            title="在工程中搜索（Ctrl+Shift+F）"
            onClick={() => setSideTab((t) => (t === 'search' ? 'files' : 'search'))}
          >
            <IconSearch size={15} />
          </button>
          <span className="tb-sep" />
          <button className="icon-btn tb" title="编译并刷新预览（Ctrl+R）" onClick={() => void compileNow()}>
            <IconRefresh size={15} />
          </button>
          <button className="icon-btn tb" title="导出 MP4（Ctrl+E）" onClick={() => setExportOpen(true)}>
            <IconExport size={15} />
          </button>
          <button
            className={`icon-btn tb ${termOpen ? 'active' : ''}`}
            title="终端（Ctrl+`）"
            onClick={() => setTermOpen((v) => !v)}
          >
            <IconTerminal size={15} />
          </button>
          <span className="tb-sep" />
          <button
            className="icon-btn tb"
            title={theme === 'dark' ? '切换到浅色主题（Ctrl+Shift+L）' : '切换到暗色主题（Ctrl+Shift+L）'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />}
          </button>
          <button className="btn ghost small" onClick={() => setPaletteOpen(true)} title="命令面板（Ctrl+Shift+P）">命令</button>
        </div>

        <div style={{ flex: 1 }} />
        {renderProg && !renderProg.done && renderProg.total > 0 && (
          <span className="ws-render">渲染中 {renderProg.frame}/{renderProg.total}</span>
        )}
        {cur && <span className="ws-dim mono">{cur.width}×{cur.height} · {cur.fps}fps · {cur.durationInFrames}帧</span>}
        <button className="btn ghost small" onClick={onExit} title="关闭工程">返回</button>
      </div>

      <div className="ws-main">
        <div className="ws-left">
          <div className="rail">
            <button
              className={`rail-btn ${sideTab === 'files' ? 'active' : ''}`}
              title="资源管理器" onClick={() => setSideTab('files')}
            >
              <IconFile size={17} />
            </button>
            <button
              className={`rail-btn ${sideTab === 'search' ? 'active' : ''}`}
              title="搜索（Ctrl+Shift+F）" onClick={() => setSideTab('search')}
            >
              <IconSearch size={17} />
            </button>
            <button
              className={`rail-btn ${sideTab === 'git' ? 'active' : ''}`}
              title="源代码管理（Git）" onClick={() => setSideTab('git')}
            >
              <IconBranch size={17} />
            </button>
            <button
              className={`rail-btn ${sideTab === 'outline' ? 'active' : ''}`}
              title="大纲" onClick={() => setSideTab('outline')}
            >
              <IconOutline size={17} />
            </button>
            <div className="rail-spacer" />
            <button
              className={`rail-btn ${sideTab === 'settings' ? 'active' : ''}`}
              title="设置（Ctrl+,）" onClick={() => setSideTab('settings')}
            >
              <IconSettings size={17} />
            </button>
          </div>
          <div
            className={`side-wrap ${sideTab === 'settings' || sideTab === 'search' ? 'wide' : ''}`}
            style={sideW != null ? { width: Math.max(sideW, sideTab === 'settings' || sideTab === 'search' ? 302 : 0) } : undefined}
          >
            {sideTab === 'files' && (
              <Suspense fallback={<PaneSkeleton text="正在装载文件面板……" />}>
                <FileTree projectDir={projectDir} bus={bus} onDirtyTree={onDirtyTree} />
              </Suspense>
            )}
            {sideTab === 'search' && (
              <Suspense fallback={<PaneSkeleton text="正在装载搜索……" />}>
                <SearchPanel projectDir={projectDir} bus={bus} onChanged={handleSearchChanged} />
              </Suspense>
            )}
            {sideTab === 'git' && (
              <MemoGitPanel projectDir={projectDir} onOpenDiff={handleOpenDiff} />
            )}
            {sideTab === 'outline' && (
              <Suspense fallback={<PaneSkeleton text="正在装载大纲……" />}>
                <OutlinePanel activeFile={activeFile} bus={bus} />
              </Suspense>
            )}
            {sideTab === 'settings' && (
              <Suspense fallback={<PaneSkeleton text="正在装载设置……" />}>
                <SettingsPanel />
              </Suspense>
            )}
          </div>
          <div
            className="side-resizer"
            role="separator"
            aria-orientation="vertical"
            title="拖动调整侧栏宽度（双击复位）"
            onMouseDown={startResize}
            onDoubleClick={() => { setSideW(null); try { localStorage.removeItem('tempus.sideW'); } catch { /* 忽略 */ } }}
          />
          <Suspense fallback={<PaneSkeleton text="正在装载编辑器……" />}>
            <EditorPane
              projectDir={projectDir}
              onSaved={compileNow}
              onDirtyChange={setDirtyCount}
              onActiveChange={setActiveFile}
              onCursorChange={setCursor}
              onNewFile={() => void newFile()}
              bus={bus}
            />
          </Suspense>
        </div>
        {/* 左（代码区）↔ 右（监视器栏）：拖这一条就能决定两边各占多少 */}
        <Splitter
          dir="col"
          targetRef={rightRef}
          invert
          min={360}
          max={Math.max(480, window.innerWidth - 440)}
          onSize={setRightW}
          onCommit={(v) => memRight.save(v)}
          onReset={() => { setRightW(null); memRight.clear(); }}
          title="拖动调整监视器栏宽度（双击复位）"
        />
        <div className="ws-right" ref={rightRef} style={rightW != null ? { flex: 'none', width: rightW } : undefined}>
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <div className="preview-wrap" style={{ flex: 1 }}>
              <PreviewPane
                ref={previewRef}
                srcDoc={srcDoc}
                reloadKey={reloadKey}
                onReady={handlePreviewReady}
                frame={frame}
                playing={playing}
                loop={loop}
                comp={cur}
                audioFiles={audioFiles}
                audioFailed={audioFailed}
                onTogglePlay={() => setPlaying((p) => !p)}
                onStep={(d) => seek(frameRef.current + d)}
                onSeek={seek}
                onToggleLoop={() => setLoop((l) => !l)}
              />
            </div>
            {/* 监视器 ↔ 右侧面板：面板里有合成列表等，也能拖宽拖窄 */}
            <Splitter
              dir="col"
              targetRef={rpRef}
              invert
              min={180}
              max={560}
              onSize={setRpW}
              onCommit={(v) => memRp.save(v)}
              onReset={() => { setRpW(null); memRp.clear(); }}
              title="拖动调整右侧面板宽度（双击复位）"
            />
            <div className="rp-wrap" ref={rpRef} style={rpW != null ? { width: rpW } : undefined}>
              <RightPanels
                comps={comps}
                activeComp={activeComp}
                onSelectComp={onSelectComp}
                projectDir={projectDir}
              />
            </div>
          </div>
          {/* 时间轴高度也能拖：长片需要更高的一条来看清标记 */}
          <Splitter
            dir="row"
            targetRef={tlRef}
            invert
            min={96}
            max={460}
            onSize={setTlH}
            onCommit={(v) => memTl.save(v)}
            onReset={() => { setTlH(null); memTl.clear(); }}
            title="拖动调整时间轴高度（双击复位）"
          />
          <div className="ws-timeline" ref={tlRef} style={tlH != null ? { height: tlH } : undefined}>
            <Timeline
              duration={cur?.durationInFrames ?? 0}
              fps={cur?.fps ?? 30}
              frame={frame}
              marks={marks}
              onSeek={seek}
            />
          </div>
        </div>
      </div>

      <div className="statusbar">
        <span className={`sb-msg ${compileMsg.kind === 'err' ? 'err' : compileMsg.kind === 'ok' ? 'ok' : ''}`} title={compileMsg.text}>
          {compileMsg.kind === 'err' ? '✕' : compileMsg.kind === 'ok' ? '✓' : '◌'} {compileMsg.text}
        </span>
        {toast && <span className="sb-item sb-toast">{toast}</span>}
        {audioFailed.length > 0 && (
          <span className="sb-item sb-warn" title={audioFailed.join('\n')}>
            音频加载失败 {audioFailed.length} 个：{audioFailed[0].split('/').pop()}
          </span>
        )}
        {dirtyCount > 0 && <span className="sb-item sb-warn">未保存 {dirtyCount} 个文件（Ctrl+S 保存全部并编译）</span>}
        <span className="sb-spacer" />
        {fileName && <span className="sb-item mono" title={activeFile ?? ''}>{fileName}</span>}
        {cursor && (
          <span className="sb-item mono sb-cursor">
            行 {cursor.line}，列 {cursor.col}
            {cursor.sel > 0 ? `（已选 ${cursor.sel}）` : ''}
          </span>
        )}
        {activeFile && <span className="sb-item mono">{activeFile.split('.').pop()?.toUpperCase() ?? 'TXT'}</span>}
        <span className="sb-item mono">{frame} / {cur?.durationInFrames ?? 0} 帧</span>
      </div>

      {termOpen && (
        <Suspense fallback={null}>
          <TerminalPane projectDir={projectDir} />
        </Suspense>
      )}

      {paletteOpen && (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      )}

      {quickOpen && (
        <QuickOpen
          projectDir={projectDir}
          onOpen={(p) => { setQuickOpen(false); void bus.current.editor?.openFile(p); }}
          onClose={() => setQuickOpen(false)}
        />
      )}

      {newFileOpen && (
        <NewFileDialog
          onPick={(kind, name) => void createFile(kind, name)}
          onClose={() => setNewFileOpen(false)}
        />
      )}

      {framePick && (
        <FramePicker
          current={meta ? { width: meta.width, height: meta.height } : null}
          onPick={(w, h, id) => void pickFrame(w, h, id)}
          onSkip={() => setFramePick(false)}
        />
      )}

      {seqOpen && (
        <Sequencer
          comps={comps}
          projectDir={projectDir}
          audioFiles={audioFiles}
          onClose={() => setSeqOpen(false)}
          buildHtml={async (compId: string) => {
            if (!vendorRef.current) return '';
            const res = await compileProject(projectDir, meta!.entry);
            if (!res.ok || !res.userJs) throw new Error(res.error ?? '编译失败');
            return buildDocumentCached(vendorRef.current, res.userJs, res.userCss ?? '', compId);
          }}
        />
      )}

      {exportOpen && cur && (
        <ExportDialog
          comp={cur}
          projectDir={projectDir}
          hasAudio={audioFiles.length > 0}
          getPreviewWindow={() => previewRef.current?.getWindow() ?? null}
          buildHtml={async (compId: string) => {
            if (!vendorRef.current) return '';
            const res = await compileProject(projectDir, meta!.entry);
            if (!res.ok || !res.userJs) throw new Error(res.error ?? '编译失败');
            return buildDocumentCached(vendorRef.current, res.userJs, res.userCss ?? '', compId);
          }}
          progress={renderProg}
          onClose={() => setExportOpen(false)}
        />
      )}
      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-card">
            <IconUpload size={26} />
            <b>松手导入素材</b>
            <span>会复制到工程的 assets/ 目录，音频立刻出现在监视器里</span>
          </div>
        </div>
      )}
    </div>
  );
}
