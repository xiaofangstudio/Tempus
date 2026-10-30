import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import { api } from '../core/tauri';
import { setupMonacoTypes, TEMPUS_THEME, TEMPUS_THEME_DARK } from './dts';
import { loadSettings, onSettings, type Settings } from '../core/settings';
import {
  IconClose, IconUndo, IconRedo, IconFormat, IconSave
} from '../ui/icons';

/* 编辑器核心：多标签 + Monaco（TS/JSX 完整补全）+ diff 视图 + Ctrl+S 保存全部。
 * 文件树、Git、搜索、大纲面板通过 bus.editor 调用本组件。
 *
 * 稳定性设计：
 * - 保存串行、失败逐个上报，不中断其余文件
 * - 自动保存按文件防抖，避免高频写盘
 * - 历史状态（撤销/重做可用性）实时同步到工具栏 */

(self as any).MonacoEnvironment = {
  getWorker(_mid: string, label: string): Worker {
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'json') return new jsonWorker();
    return new editorWorker();
  }
};

setupMonacoTypes();

export type DiffSpec = { title: string; base: string; current: string; lang: string };
export type OutlineItem = { name: string; kind: string; line: number };

export type EditorHandle = {
  openFile: (path: string) => Promise<void>;
  closeTab: (path: string) => void;
  saveAll: () => Promise<number>;
  openDiff: (spec: DiffSpec) => void;
  closeDiff: () => void;
  dirtyCount: () => number;
  undo: () => void;
  redo: () => void;
  format: () => void;
  find: () => void;
  replace: () => void;
  gotoLine: (line: number, col?: number) => void;
  getActiveFile: () => string | null;
  getActiveText: () => string;
  getOutline: () => OutlineItem[];
  /** 从磁盘重读文件内容（外部工具如 MCP 改写文件后调用） */
  reloadFile: (path: string) => Promise<void>;
  /** 把焦点交还编辑器（菜单栏 / 工具栏点击后用） */
  focus: () => void;
  /** 全选当前文件 */
  selectAll: () => void;
  /** 扩大选区（智能选择，等同 Shift+Alt+→） */
  expandSelection: () => void;
};

type Props = {
  projectDir: string;
  onSaved: () => void;
  onDirtyChange?: (n: number) => void;
  onActiveChange?: (path: string | null) => void;
  onCursorChange?: (pos: { line: number; col: number; sel: number } | null) => void;
  bus: React.MutableRefObject<{ editor?: EditorHandle }>;
};

function langOf(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith('.tsx') || p.endsWith('.ts')) return 'typescript';
  if (p.endsWith('.jsx') || p.endsWith('.js') || p.endsWith('.mjs')) return 'javascript';
  if (p.endsWith('.css')) return 'css';
  if (p.endsWith('.json')) return 'json';
  if (p.endsWith('.html')) return 'html';
  if (p.endsWith('.md')) return 'markdown';
  return 'plaintext';
}

/* 大纲解析：按行扫描声明，首个命中的模式决定类型 */
const OUTLINE_RULES: { re: RegExp; kind: string }[] = [
  { re: /^\s*export\s+default\s+function\s+([A-Za-z_$][\w$]*)/, kind: '组件' },
  { re: /^\s*export\s+function\s+([A-Za-z_$][\w$]*)/, kind: '函数' },
  { re: /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*[:=]/, kind: '常量' },
  { re: /^\s*function\s+([A-Za-z_$][\w$]*)/, kind: '函数' },
  { re: /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(|async|function)/, kind: '函数' },
  { re: /^\s*class\s+([A-Za-z_$][\w$]*)/, kind: '类' },
  { re: /^\s*interface\s+([A-Za-z_$][\w$]*)/, kind: '类型' },
  { re: /^\s*type\s+([A-Za-z_$][\w$]*)\s*=/, kind: '类型' }
];

function parseOutline(text: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  const seen = new Set<string>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > 220) continue;
    for (const r of OUTLINE_RULES) {
      const m = r.re.exec(line);
      if (m) {
        const name = m[1];
        if (!seen.has(name)) {
          seen.add(name);
          out.push({ name, kind: r.kind, line: i + 1 });
        }
        break;
      }
    }
    if (out.length >= 200) break;
  }
  return out;
}

function EditorPaneImpl({ projectDir, onSaved, onDirtyChange, onActiveChange, onCursorChange, bus }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const diffHostRef = useRef<HTMLDivElement>(null);
  const edRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  /* 光标回调放 ref：Monaco 只初始化一次，不能因为 props 换了回调就重建编辑器 */
  const onCursorRef = useRef(onCursorChange);
  onCursorRef.current = onCursorChange;
  const diffEdRef = useRef<monaco.editor.IDiffEditor | null>(null);
  const modelsRef = useRef<Map<string, monaco.editor.ITextModel>>(new Map());
  const modelPathRef = useRef<Map<monaco.editor.ITextModel, string>>(new Map());
  const saveTimers = useRef<Map<string, number>>(new Map());
  const autoSaveRef = useRef(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const [tabs, setTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [diffSpec, setDiffSpec] = useState<DiffSpec | null>(null);
  const [status, setStatus] = useState('');
  const [hist, setHist] = useState({ undo: false, redo: false });

  const dirtyRef = useRef<Set<string>>(dirty);
  dirtyRef.current = dirty;
  const activeTabRef = useRef<string | null>(activeTab);
  activeTabRef.current = activeTab;

  const relOf = useCallback((p: string) => {
    const norm = p.replace(/\\/g, '/').replace(/\/+$/, '');
    const root = projectDir.replace(/\\/g, '/').replace(/\/+$/, '');
    return norm.startsWith(root + '/') ? norm.slice(root.length + 1) : norm;
  }, [projectDir]);

  const bumpDirty = useCallback((path: string, on: boolean) => {
    setDirty((s) => {
      const n = new Set(s);
      if (on) n.add(path); else n.delete(path);
      return n;
    });
  }, []);

  useEffect(() => { onDirtyChange?.(dirty.size); }, [dirty, onDirtyChange]);
  useEffect(() => { onActiveChange?.(diffSpec ? null : activeTab); }, [activeTab, diffSpec, onActiveChange]);

  const uriOf = useCallback((path: string) =>
    monaco.Uri.parse('file:///project/' + relOf(path)), [relOf]);

  /* 历史状态同步 */
  const syncHist = useCallback(() => {
    const m = edRef.current?.getModel();
    if (!m) { setHist({ undo: false, redo: false }); return; }
    const canUndo = typeof (m as any).canUndo === 'function' ? (m as any).canUndo() : true;
    const canRedo = typeof (m as any).canRedo === 'function' ? (m as any).canRedo() : true;
    setHist({ undo: !!canUndo, redo: !!canRedo });
  }, []);

  /* Monaco 初始化 */
  useEffect(() => {
    if (!hostRef.current || !diffHostRef.current) return;
    const st = loadSettings();
    autoSaveRef.current = st.autoSave;
    const ed = monaco.editor.create(hostRef.current, {
      theme: st.theme === 'dark' ? TEMPUS_THEME_DARK : TEMPUS_THEME,
      automaticLayout: true,
      fontSize: st.fontSize,
      fontFamily: 'Consolas, "Courier New", monospace',
      minimap: { enabled: st.minimap },
      scrollBeyondLastLine: false,
      tabSize: 2,
      wordWrap: st.wordWrap ? 'on' : 'off',
      padding: { top: 10 },
      renderLineHighlight: 'all',
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      suggestSelection: 'first',
      bracketPairColorization: { enabled: true }
    });
    edRef.current = ed;
    const sub = ed.onDidChangeModelContent(() => syncHist());
    const sub2 = ed.onDidChangeModel(() => {
      syncHist();
      if (!ed.getModel()) onCursorRef.current?.(null);
    });
    /* 光标位置 → 状态栏「行/列/选中」 */
    const sub3 = ed.onDidChangeCursorPosition((e) => {
      const sel = ed.getSelection();
      const selected = sel && !sel.isEmpty() ? ed.getModel()?.getValueInRange(sel).length ?? 0 : 0;
      onCursorRef.current?.({ line: e.position.lineNumber, col: e.position.column, sel: selected });
    });

    const diffEd = monaco.editor.createDiffEditor(diffHostRef.current, {
      theme: st.theme === 'dark' ? TEMPUS_THEME_DARK : TEMPUS_THEME,
      automaticLayout: true,
      readOnly: true,
      fontSize: 13,
      renderSideBySide: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false
    });
    diffEdRef.current = diffEd;
    return () => {
      sub.dispose();
      sub2.dispose();
      sub3.dispose();
      ed.dispose();
      diffEd.dispose();
      edRef.current = null;
      diffEdRef.current = null;
    };
  }, [syncHist]);

  /* 设置热更新 */
  useEffect(() => onSettings((s: Settings) => {
    autoSaveRef.current = s.autoSave;
    edRef.current?.updateOptions({
      fontSize: s.fontSize,
      wordWrap: s.wordWrap ? 'on' : 'off',
      minimap: { enabled: s.minimap }
    });
    /* 主题跟随（Monaco 是独立渲染层，不吃 CSS 变量） */
    monaco.editor.setTheme(s.theme === 'dark' ? TEMPUS_THEME_DARK : TEMPUS_THEME);
  }), []);

  const saveOne = useCallback(async (path: string): Promise<boolean> => {
    const m = modelsRef.current.get(path);
    if (!m) return false;
    try {
      await api.fsWrite(path, m.getValue());
      bumpDirty(path, false);
      return true;
    } catch (e) {
      setStatus('保存失败：' + String(e));
      return false;
    }
  }, [bumpDirty]);

  const saveAll = useCallback(async (): Promise<number> => {
    const paths = [...dirtyRef.current];
    let ok = 0;
    for (const p of paths) {
      if (await saveOne(p)) ok += 1;
    }
    if (ok > 0) {
      setStatus(`已保存 ${ok} 个文件`);
      onSaved();
      window.setTimeout(() => setStatus((s) => (s.startsWith('已保存') ? '' : s)), 2600);
    }
    return ok;
  }, [saveOne, onSaved]);

  const saveAllRef = useRef(saveAll);
  saveAllRef.current = saveAll;

  /* 标签与保存类快捷键（捕获阶段，编辑器内外都生效）：
   * Ctrl+S 保存全部 / Ctrl+W 关闭当前标签 / Ctrl+Tab 切下一个标签 */
  const kbRef = useRef({
    tabs: [] as string[],
    active: null as string | null,
    close: (_p: string) => {},
    open: (_p: string) => {}
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.code === 'KeyS') {
        e.preventDefault();
        void saveAllRef.current();
        return;
      }
      if (e.ctrlKey && !e.shiftKey && e.code === 'KeyW') {
        const p = kbRef.current.active;
        if (p) { e.preventDefault(); kbRef.current.close(p); }
        return;
      }
      if (e.ctrlKey && e.code === 'Tab') {
        const { tabs, active } = kbRef.current;
        if (tabs.length > 1) {
          e.preventDefault();
          const i = tabs.indexOf(active ?? '');
          const next = tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
          if (next) kbRef.current.open(next);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const openFile = useCallback(async (path: string): Promise<void> => {
    if (diffSpec) setDiffSpec(null);
    let model = modelsRef.current.get(path);
    if (!model) {
      try {
        const text = await api.fsRead(path);
        /* 等待期间可能已被并发打开，二次确认，避免重复 createModel 同 URI */
        model = modelsRef.current.get(path) ?? monaco.editor.getModel(uriOf(path)) ?? undefined;
        if (!model) {
          model = monaco.editor.createModel(text, langOf(path), uriOf(path));
          modelsRef.current.set(path, model);
          modelPathRef.current.set(model, path);
          model.onDidChangeContent(() => {
            bumpDirty(path, true);
            if (autoSaveRef.current) {
              const t = saveTimers.current.get(path);
              if (t) window.clearTimeout(t);
              saveTimers.current.set(path, window.setTimeout(() => {
                saveTimers.current.delete(path);
                void saveOne(path).then((ok) => { if (ok) onSavedRef.current(); });
              }, 700));
            }
          });
          model.onWillDispose(() => {
            modelsRef.current.delete(path);
            modelPathRef.current.delete(model!);
          });
        }
      } catch (e) {
        setStatus('打开失败：' + String(e));
        return;
      }
    }
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
    setActiveTab(path);
    edRef.current?.setModel(model);
    edRef.current?.focus();
  }, [bumpDirty, diffSpec, uriOf, saveOne]);

  const openDiff = useCallback((spec: DiffSpec): void => {
    const original = monaco.editor.createModel(spec.base, spec.lang);
    const modified = monaco.editor.createModel(spec.current, spec.lang);
    const d = diffEdRef.current;
    if (!d) return;
    const prev = d.getModel();
    setDiffSpec(spec);
    d.setModel({ original, modified });
    if (prev) {
      prev.original.dispose();
      prev.modified.dispose();
    }
  }, []);

  const closeDiff = useCallback((): void => {
    const d = diffEdRef.current;
    if (d) {
      const prev = d.getModel();
      if (prev) { prev.original.dispose(); prev.modified.dispose(); }
      d.setModel(null);
    }
    setDiffSpec(null);
  }, []);

  const closeTab = useCallback((path: string): void => {
    setTabs((t) => {
      const next = t.filter((p) => p !== path);
      if (activeTab === path) {
        const n = next[next.length - 1] ?? null;
        setActiveTab(n);
        if (n && !diffSpec) {
          const m = modelsRef.current.get(n);
          if (m) edRef.current?.setModel(m);
        } else if (!n && !diffSpec) {
          edRef.current?.setModel(null);
        }
      }
      return next;
    });
  }, [activeTab, diffSpec]);

  /* 打开工程后自动打开入口文件 */
  useEffect(() => {
    (async () => {
      try {
        const raw = await api.fsRead(projectDir + '/project.json');
        const entry = (JSON.parse(raw) as any).entry as string;
        if (entry) void openFile(projectDir + '/' + entry.replace(/\\/g, '/'));
      } catch { /* 无 project.json 时静默 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectDir]);

  /* 工具栏动作 */
  const undo = useCallback(() => { edRef.current?.trigger('toolbar', 'undo', null); }, []);
  const redo = useCallback(() => { edRef.current?.trigger('toolbar', 'redo', null); }, []);
  const format = useCallback(() => { void edRef.current?.getAction('editor.action.formatDocument')?.run(); }, []);
  const find = useCallback(() => { edRef.current?.getAction('actions.find')?.run(); }, []);
  const replace = useCallback(() => { edRef.current?.getAction('editor.action.startFindReplaceAction')?.run(); }, []);

  const gotoLine = useCallback((line: number, col = 1) => {
    const ed = edRef.current;
    const m = ed?.getModel();
    if (!ed || !m) return;
    const ln = Math.max(1, Math.min(m.getLineCount(), Math.round(line)));
    const pos = { lineNumber: ln, column: Math.max(1, col) };
    ed.revealPositionInCenter(pos);
    ed.setPosition(pos);
    ed.focus();
  }, []);

  const getActiveText = useCallback(() => edRef.current?.getModel()?.getValue() ?? '', []);
  const getOutline = useCallback((): OutlineItem[] => {
    const m = edRef.current?.getModel();
    if (!m) return [];
    return parseOutline(m.getValue());
  }, []);
  const getActiveFile = useCallback(() => activeTabRef.current, []);

  const reloadFile = useCallback(async (path: string): Promise<void> => {
    const model = modelsRef.current.get(path);
    if (!model) return;
    try {
      const text = await api.fsRead(path);
      if (model.getValue() !== text) {
        model.setValue(text);
        bumpDirty(path, false);
      }
    } catch { /* 文件可能已被删除，保留缓冲内容 */ }
  }, [bumpDirty]);

  /* 供文件树 / Git / 搜索 / 大纲面板调用 */
  useEffect(() => {
    bus.current.editor = {
      openFile,
      closeTab,
      saveAll,
      openDiff,
      closeDiff,
      reloadFile,
      focus: () => edRef.current?.focus(),
      selectAll: () => { edRef.current?.focus(); edRef.current?.trigger('menu', 'editor.action.selectAll', null); },
      expandSelection: () => { edRef.current?.focus(); edRef.current?.trigger('menu', 'editor.action.smartSelect.expand', null); },
      dirtyCount: () => dirtyRef.current.size,
      undo, redo, format, find, replace, gotoLine,
      getActiveFile, getActiveText, getOutline
    };
    return () => { delete bus.current.editor; };
  }, [bus, openFile, closeTab, saveAll, openDiff, closeDiff, reloadFile,
      undo, redo, format, find, replace, gotoLine, getActiveFile, getActiveText, getOutline]);

  const hasDirty = dirty.size > 0;

  /* 供上面的快捷键 effect 读取最新标签状态 */
  kbRef.current = {
    tabs,
    active: activeTab,
    close: (p) => { void closeTab(p); },
    open: (p) => { void openFile(p); }
  };

  /* 面包屑：相对工程根拆段，最后一段是文件名 */
  const rootNorm = projectDir.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  const activeRel = activeTab ? activeTab.replace(/\\/g, '/').replace(rootNorm, '') : '';
  const crumbs = activeRel ? activeRel.split('/').filter(Boolean) : [];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      <div className="ed-bar">
        <div className="tree-tabs">
          {tabs.map((t) => (
            <div key={t} className={`tree-tab ${activeTab === t && !diffSpec ? 'active' : ''}`} onClick={() => { setDiffSpec(null); void openFile(t); }} title={t}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); void closeTab(t); } }}>
              {dirty.has(t) && <span className="dirty-dot" />}
              {t.split(/[\\/]/).pop()}
              <span className="tab-x"
                onClick={(e) => { e.stopPropagation(); closeTab(t); }}>
                <IconClose size={11} />
              </span>
            </div>
          ))}
          {diffSpec && (
            <div className="tree-tab active diff-tab">
              {diffSpec.title}
              <span className="tab-x"
                onClick={(e) => { e.stopPropagation(); closeDiff(); }}>
                <IconClose size={11} />
              </span>
            </div>
          )}
        </div>
        <div className="ed-actions">
          <button className="icon-btn" title="撤销（Ctrl+Z）" disabled={!hist.undo} onClick={undo}>
            <IconUndo size={15} />
          </button>
          <button className="icon-btn" title="重做（Ctrl+Y）" disabled={!hist.redo} onClick={redo}>
            <IconRedo size={15} />
          </button>
          <span className="ea-sep" />
          <button className="icon-btn" title="格式化文档（Shift+Alt+F）" onClick={format}>
            <IconFormat size={15} />
          </button>
          <button className={`icon-btn ${hasDirty ? 'dirty' : ''}`} title="保存全部（Ctrl+S）" onClick={() => void saveAll()}>
            <IconSave size={15} />
            {hasDirty && <span className="ea-dot" />}
          </button>
        </div>
      </div>
      {crumbs.length > 0 && !diffSpec && (
        <div className="ed-crumbs" title={activeTab ?? ''}>
          {crumbs.map((c, i) => (
            <React.Fragment key={`${c}-${i}`}>
              {i > 0 && <span className="crumb-sep">›</span>}
              <span className={`crumb ${i === crumbs.length - 1 ? 'last' : ''}`}>{c}</span>
            </React.Fragment>
          ))}
        </div>
      )}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {tabs.length === 0 && !diffSpec && (
          <div className="ed-empty">
            <div className="ed-empty-title">还没有打开文件</div>
            <div className="ed-empty-keys">
              <span><kbd>Ctrl</kbd><kbd>P</kbd>快速打开</span>
              <span><kbd>Ctrl</kbd><kbd>N</kbd>新建文件</span>
              <span><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>P</kbd>命令面板</span>
            </div>
            <div className="ed-empty-hint">左侧资源管理器里双击文件也能打开</div>
          </div>
        )}
        <div className="editor-host" ref={hostRef} style={{ display: diffSpec ? 'none' : 'block', height: '100%' }} />
        <div className="editor-host" ref={diffHostRef} style={{ display: diffSpec ? 'block' : 'none', height: '100%' }} />
        {diffSpec && (
          <div className="diff-hint">对比视图（只读）：左侧基线，右侧当前内容。关闭标签返回编辑。</div>
        )}
      </div>
      {(status || hasDirty) && (
        <div className={`editor-status ${status.startsWith('保存失败') ? 'err' : 'ok'}`}>
          {status || `未保存的更改：${dirty.size} 个文件`}
        </div>
      )}
    </div>
  );
}

/* memo：播放时（父组件随帧重渲染）不连坐重渲染 Monaco 子树 */
export const EditorPane = React.memo(EditorPaneImpl);
