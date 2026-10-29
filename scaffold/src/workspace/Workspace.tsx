import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { api, listen } from '../core/tauri';
import { compileProject, buildDocumentCached } from '../core/compile';
import type { CompInfo, Mark, ProjectMeta, RenderProgress } from '../core/types';
import type { EditorHandle, DiffSpec } from '../ide/EditorPane';
import { GitPanel } from '../ide/GitPanel';
import { CommandPalette, type Command } from '../ide/CommandPalette';
import { PreviewPane, type PreviewHandle } from './PreviewPane';
import { Timeline } from './Timeline';
import { ExportDialog } from './ExportDialog';
import { RightPanels } from './RightPanels';
import {
  Logo, IconBranch, IconExport, IconFile, IconRefresh, IconTerminal,
  IconSearch, IconOutline, IconSettings, IconSave
} from '../ui/icons';

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
  const [dirtyCount, setDirtyCount] = useState(0);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const onDirtyTree = useCallback(() => {}, []);

  const bus = useRef<{ editor?: EditorHandle }>({});
  const vendorRef = useRef<string>('');
  const previewRef = useRef<PreviewHandle>(null);
  const frameRef = useRef(0);
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
        const m = JSON.parse(raw) as ProjectMeta;
        setMeta(m);
        document.title = `Tempus — ${m.name}`;
      } catch (e) {
        setCompileMsg({ kind: 'err', text: '工程缺少 project.json，无法加载：' + String(e) });
      }
    })();
  }, [projectDir]);

  /* vendor 预取 */
  useEffect(() => {
    fetch('/render/vendor.js').then((r) => r.text()).then((t) => { vendorRef.current = t; }).catch(() => {});
  }, []);

  /* 编译循环：src 变化 → esbuild → srcdoc（带重入保护） */
  const lastBuildRef = useRef<{ userJs: string; userCss: string } | null>(null);
  const compileNowRef = useRef<() => Promise<void>>(async () => {});
  const compileNow = useCallback(async () => {
    if (!meta || !vendorRef.current) return;
    if (compilingRef.current) { pendingRef.current = true; return; }
    compilingRef.current = true;
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
      const doc = buildDocumentCached(vendorRef.current, res.userJs, res.userCss ?? '', activeRef.current);
      setSrcDoc(doc);
      setCompileMsg({ kind: 'ok', text: '编译通过' });
    } catch (e) {
      setCompileMsg({ kind: 'err', text: '编译异常：' + String(e) });
    } finally {
      compilingRef.current = false;
      if (pendingRef.current) { pendingRef.current = false; void compileNowRef.current(); }
    }
  }, [meta, projectDir]);
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

  const seek = useCallback((f: number) => {
    const dur = compsRef.current.find((c) => c.id === activeRef.current)?.durationInFrames ?? 0;
    if (dur <= 0) return;
    const clamped = Math.max(0, Math.min(dur - 1, Math.round(f)));
    frameRef.current = clamped;
    setFrame(clamped);
    previewRef.current?.seek(clamped);
  }, []);

  /* 渲染进度事件 */
  const [renderProg, setRenderProg] = useState<RenderProgress | null>(null);
  useEffect(() => {
    const un = listen<RenderProgress>('render-progress', (p) => setRenderProg(p));
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
    const doc = buildDocumentCached(vendorRef.current, lastBuildRef.current.userJs, lastBuildRef.current.userCss, activeComp);
    setSrcDoc(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeComp]);

  const saveAllNow = useCallback(() => { void bus.current.editor?.saveAll(); }, []);
  const handleSearchChanged = useCallback(() => { void compileNow(); }, [compileNow]);
  const handleOpenDiff = useCallback((rel: string, kind: 'worktree' | 'index') => {
    void openGitDiff(rel, kind);
  }, [openGitDiff]);

  /* 命令面板 */
  const commands: Command[] = [
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
      if (e.ctrlKey && !e.shiftKey && e.code === 'Comma') { e.preventDefault(); setSideTab('settings'); return; }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyP') { e.preventDefault(); setPaletteOpen(true); return; }

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
  }, [seek, compileNow]);

  const cur = comps.find((c) => c.id === activeComp) ?? comps[0] ?? null;
  const projName = meta?.name ?? projectDir.split(/[\\/]/).pop() ?? '工程';
  const fileName = activeFile ? activeFile.split(/[\\/]/).pop() : '';

  return (
    <div className="ws">
      <div className="ws-top">
        <span className="ws-brand"><Logo size={22} /></span>
        <span className="ws-title" title={projectDir}>{projName}</span>
        <span className={`ws-dot ${compileMsg.kind}`} title={compileMsg.text} />

        <div className="ws-actions">
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
          <div className={`side-wrap ${sideTab === 'settings' || sideTab === 'search' ? 'wide' : ''}`}>
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
          <Suspense fallback={<PaneSkeleton text="正在装载编辑器……" />}>
            <EditorPane
              projectDir={projectDir}
              onSaved={compileNow}
              onDirtyChange={setDirtyCount}
              onActiveChange={setActiveFile}
              bus={bus}
            />
          </Suspense>
        </div>
        <div className="ws-right">
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
                onTogglePlay={() => setPlaying((p) => !p)}
                onStep={(d) => seek(frameRef.current + d)}
                onSeek={seek}
                onToggleLoop={() => setLoop((l) => !l)}
              />
            </div>
            <RightPanels
              comps={comps}
              activeComp={activeComp}
              onSelectComp={onSelectComp}
              projectDir={projectDir}
            />
          </div>
          <div className="ws-timeline">
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
        {dirtyCount > 0 && <span className="sb-item sb-warn">未保存 {dirtyCount} 个文件（Ctrl+S 保存全部并编译）</span>}
        <span className="sb-spacer" />
        {fileName && <span className="sb-item mono">{fileName}</span>}
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

      {exportOpen && cur && (
        <ExportDialog
          comp={cur}
          projectDir={projectDir}
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
    </div>
  );
}
