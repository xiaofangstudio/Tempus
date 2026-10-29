import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../core/tauri';
import { IconFile, IconFolder, IconPlus, IconTrash, IconRefresh } from '../ui/icons';
import type { FileEntry } from '../core/types';

/* 资源管理器：工程文件树（懒加载展开）、右键菜单、新建/重命名/删除。 */

type TreeNode = { name: string; path: string; isDir: boolean };

type Props = {
  projectDir: string;
  bus: React.MutableRefObject<{ editor?: { openFile: (p: string) => Promise<void>; closeTab: (p: string) => void } }>;
  onDirtyTree?: () => void;
};

type Menu = { x: number; y: number; node: TreeNode | null } | null;

function FileTreeImpl({ projectDir, bus, onDirtyTree }: Props) {
  const [children, setChildren] = useState<Map<string, TreeNode[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<Menu>(null);
  const [err, setErr] = useState('');
  const refreshRef = useRef<() => void>(() => {});

  const sortNodes = (list: FileEntry[], base: string): TreeNode[] =>
    list
      .map((e) => ({ name: e.name, path: base + '/' + e.name, isDir: e.isDir }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh') : a.isDir ? -1 : 1));

  const loadDir = useCallback(async (dir: string): Promise<TreeNode[]> => {
    try {
      const entries = await api.fsList(dir);
      return sortNodes(entries, dir);
    } catch (e) {
      setErr(String(e));
      return [];
    }
  }, []);

  const refresh = useCallback((): void => {
    void (async () => {
      const rootNodes = await loadDir(projectDir);
      setChildren((m) => {
        const n = new Map(m);
        n.set(projectDir, rootNodes);
        return n;
      });
      onDirtyTree?.();
    })();
  }, [projectDir, loadDir, onDirtyTree]);

  refreshRef.current = refresh;
  useEffect(() => { refresh(); }, [refresh]);

  const toggleDir = async (node: TreeNode): Promise<void> => {
    const wasOpen = expanded.has(node.path);
    setExpanded((s) => {
      const n = new Set(s);
      if (wasOpen) n.delete(node.path); else n.add(node.path);
      return n;
    });
    if (!wasOpen && !children.has(node.path)) {
      const list = await loadDir(node.path);
      setChildren((m) => {
        const n = new Map(m);
        n.set(node.path, list);
        return n;
      });
    }
  };

  const newFileIn = async (dir: string, isDir: boolean): Promise<void> => {
    const name = window.prompt(isDir ? '新文件夹名：' : '新文件名（如 scene2.tsx）：');
    if (!name) return;
    const p = dir + '/' + name;
    try {
      if (isDir) await api.fsMkdir(p);
      else {
        await api.fsWrite(
          p,
          /\.(tsx|jsx)$/i.test(name)
            ? `import React from 'react';\nimport { useFrame, AbsoluteFill } from 'tempus';\n\nexport default function Scene() {\n  const frame = useFrame();\n  return <AbsoluteFill style={{ background: '#081427' }} />;\n}\n`
            : ''
        );
      }
      if (dir !== projectDir && !expanded.has(dir)) {
        setExpanded((s) => new Set(s).add(dir));
        const list = await loadDir(dir);
        setChildren((m) => { const n = new Map(m); n.set(dir, list); return n; });
      }
      refresh();
      if (!isDir) void bus.current.editor?.openFile(p);
    } catch (e) { setErr('创建失败：' + String(e)); }
  };

  const renameEntry = async (node: TreeNode): Promise<void> => {
    const name = window.prompt('重命名为：', node.name);
    if (!name || name === node.name) return;
    const to = node.path.slice(0, node.path.length - node.name.length) + name;
    try {
      await api.fsRename(node.path, to);
      bus.current.editor?.closeTab(node.path);
      refresh();
    } catch (e) { setErr('重命名失败：' + String(e)); }
  };

  const deleteEntry = async (node: TreeNode): Promise<void> => {
    if (!window.confirm(`删除 ${node.name}？（目录将连同内容一起删除，不可恢复）`)) return;
    try {
      await api.fsDelete(node.path);
      bus.current.editor?.closeTab(node.path);
      refresh();
    } catch (e) { setErr('删除失败：' + String(e)); }
  };

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const isOpen = expanded.has(node.path);
    return (
      <React.Fragment key={node.path}>
        <div
          className={`tree-item ${depth === 0 && node.isDir ? 'root' : ''}`}
          style={{ paddingLeft: 6 + depth * 13 }}
          onClick={() => (node.isDir ? void toggleDir(node) : void bus.current.editor?.openFile(node.path))}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, node }); }}
        >
          {node.isDir ? <IconFolder size={13} /> : <IconFile size={13} />}
          <span>{node.name}</span>
        </div>
        {node.isDir && isOpen && (children.get(node.path) ?? []).map((c) => renderNode(c, depth + 1))}
      </React.Fragment>
    );
  };

  const rootNodes = children.get(projectDir) ?? [];

  return (
    <div className="explorer" onClick={() => menu && setMenu(null)}>
      <div className="explorer-head">
        <span>资源管理器</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" style={{ width: 22, height: 22 }} title="刷新" onClick={() => refreshRef.current()}>
          <IconRefresh size={12} />
        </button>
        <button className="icon-btn" style={{ width: 22, height: 22 }} title="新建文件" onClick={() => void newFileIn(projectDir, false)}>
          <IconPlus size={12} />
        </button>
        <button className="icon-btn" style={{ width: 22, height: 22 }} title="新建文件夹" onClick={() => void newFileIn(projectDir, true)}>
          <IconFolder size={12} />
        </button>
      </div>
      <div className="explorer-body">
        {rootNodes.map((n) => renderNode(n, 0))}
      </div>
      {err && <div className="editor-status err">{err}</div>}
      {menu?.node && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={() => setMenu(null)}>
          {!menu.node.isDir && (
            <div className="ctx-item" onClick={() => void bus.current.editor?.openFile(menu.node!.path)}>打开</div>
          )}
          {menu.node.isDir && (
            <>
              <div className="ctx-item" onClick={() => void newFileIn(menu.node!.path, false)}>新建文件</div>
              <div className="ctx-item" onClick={() => void newFileIn(menu.node!.path, true)}>新建文件夹</div>
            </>
          )}
          <div className="ctx-item" onClick={() => void renameEntry(menu.node!)}>重命名</div>
          <div className="ctx-item danger" onClick={() => void deleteEntry(menu.node!)}>删除</div>
        </div>
      )}
    </div>
  );
}

/* memo：播放时不随帧重渲染 */
export const FileTree = React.memo(FileTreeImpl);
