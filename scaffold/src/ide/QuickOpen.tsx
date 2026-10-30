import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../core/tauri';

/* 快速打开文件（Ctrl+P）：模糊过滤工程内文本文件，回车即开。 */

const TEXT_EXT = /\.(tsx?|jsx?|mjs|cjs|css|scss|json|md|html|htm|svg|txt|yml|yaml|toml)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'target', '.tempus', '.cache']);
const MAX_FILES = 500;
const MAX_DEPTH = 6;

type Props = {
  projectDir: string;
  onOpen: (path: string) => void;
  onClose: () => void;
};

export function QuickOpen({ projectDir, onOpen, onClose }: Props) {
  const [q, setQ] = useState('');
  const [files, setFiles] = useState<{ path: string; name: string; rel: string }[]>([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const root = projectDir.replace(/[\\/]+$/, '').replace(/\\/g, '/');
      const out: { path: string; name: string; rel: string }[] = [];
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
        let list: { name: string; isDir: boolean }[];
        try { list = await api.fsList(dir); } catch { return; }
        for (const e of list) {
          if (out.length >= MAX_FILES) return;
          if (e.isDir) {
            if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
            await walk(dir + '/' + e.name, depth + 1);
          } else if (TEXT_EXT.test(e.name)) {
            const p = dir + '/' + e.name;
            const norm = p.replace(/\\/g, '/');
            out.push({
              path: p,
              name: e.name,
              rel: norm.startsWith(root + '/') ? norm.slice(root.length + 1) : norm
            });
          }
        }
      };
      await walk(projectDir, 0);
      if (alive) setFiles(out);
    })();
    return () => { alive = false; };
  }, [projectDir]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return files.slice(0, 80);
    const scored = files
      .map((f) => {
        const name = f.name.toLowerCase();
        const rel = f.rel.toLowerCase();
        let score = -1;
        if (name === s) score = 100;
        else if (name.startsWith(s)) score = 80;
        else if (name.includes(s)) score = 60;
        else if (rel.includes(s)) score = 40;
        return { f, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 80);
    return scored.map((x) => x.f);
  }, [q, files]);

  useEffect(() => { setIdx(0); }, [q]);
  useEffect(() => {
    const el = listRef.current?.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  const pick = (path: string): void => {
    onClose();
    window.setTimeout(() => onOpen(path), 0);
  };

  return (
    <div className="modal-mask palette-mask" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="转到文件……（输入文件名，↑↓ 选择，回车打开）"
          value={q}
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter' && filtered[idx]) pick(filtered[idx].path);
          }}
        />
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && <div className="palette-item muted">{files.length === 0 ? '正在索引工程文件……' : '没有匹配的文件'}</div>}
          {filtered.map((f, i) => (
            <div
              key={f.path}
              className={`palette-item ${i === idx ? 'active' : ''}`}
              onClick={() => pick(f.path)}
              onMouseEnter={() => setIdx(i)}
              title={f.path}
            >
              <span>{f.name}</span>
              <span className="palette-hint">{f.rel}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
