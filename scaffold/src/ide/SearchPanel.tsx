import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../core/tauri';
import type { EditorHandle } from './EditorPane';
import { IconSearch, IconReplace, IconChevronDown } from '../ui/icons';

/* 全局搜索：跨工程文件文本搜索 + 替换。
 * 稳定性：目录深度 / 文件数 / 单文件体积 / 命中数全部设上限，
 * 单文件读取失败直接跳过，绝不因一个坏文件中断整轮搜索。 */

type Hit = { line: number; col: number; text: string };
type FileHits = { path: string; name: string; hits: Hit[] };

const TEXT_EXT = /\.(tsx?|jsx?|mjs|cjs|css|scss|less|json|md|html|htm|svg|txt|yml|yaml|toml)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.tempus', '.cache', '.turbo', 'target']);
const MAX_FILES = 600;
const MAX_DEPTH = 8;
const MAX_BYTES = 400 * 1024;
const MAX_HITS = 400;
const MAX_PER_FILE = 40;

type Props = {
  projectDir: string;
  bus: React.MutableRefObject<{ editor?: EditorHandle }>;
  onChanged?: () => void;
};

function buildSource(q: string, regexMode: boolean, wholeWord: boolean): string {
  let src = regexMode ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) src = `\\b(?:${src})\\b`;
  return src;
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  let list: { name: string; isDir: boolean }[];
  try { list = await api.fsList(dir); } catch { return; }
  for (const e of list) {
    if (out.length >= MAX_FILES) return;
    if (e.isDir) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      await walk(dir + '/' + e.name, depth + 1, out);
    } else if (TEXT_EXT.test(e.name)) {
      out.push(dir + '/' + e.name);
    }
  }
}

export function SearchPanel({ projectDir, bus, onChanged }: Props) {
  const [query, setQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexMode, setRegexMode] = useState(false);
  const [results, setResults] = useState<FileHits[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const run = useCallback(async () => {
    const q = query;
    const my = ++tokenRef.current;
    if (!q.trim()) { setResults([]); setBusy(false); return; }
    setBusy(true);
    setMsg('');
    try {
      let re: RegExp;
      try { re = new RegExp(buildSource(q, regexMode, wholeWord), caseSensitive ? 'g' : 'gi'); }
      catch { setMsg('正则表达式无效'); setBusy(false); return; }

      const files: string[] = [];
      await walk(projectDir, 0, files);
      const out: FileHits[] = [];
      let total = 0;

      for (const f of files) {
        if (total >= MAX_HITS || my !== tokenRef.current) break;
        let text: string;
        try { text = await api.fsRead(f); } catch { continue; }
        if (text.length > MAX_BYTES) continue;
        const lines = text.split('\n');
        const hits: Hit[] = [];
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          if (line.length > 600) continue;
          re.lastIndex = 0;
          const m = re.exec(line);
          if (m) {
            hits.push({ line: i + 1, col: m.index + 1, text: line.trim().slice(0, 220) });
            total += 1;
            if (hits.length >= MAX_PER_FILE || total >= MAX_HITS) break;
          }
        }
        if (hits.length) out.push({ path: f, name: f.split(/[\\/]/).pop() ?? f, hits });
      }

      if (my === tokenRef.current) {
        setResults(out);
        if (out.length === 0) setMsg('没有找到匹配项');
      }
    } catch (e) {
      if (my === tokenRef.current) setMsg('搜索失败：' + String(e));
    } finally {
      if (my === tokenRef.current) setBusy(false);
    }
  }, [query, regexMode, wholeWord, caseSensitive, projectDir]);

  /* 输入防抖 */
  useEffect(() => {
    const t = window.setTimeout(() => { void run(); }, 260);
    return () => window.clearTimeout(t);
  }, [run]);

  const openHit = (path: string, line: number): void => {
    void (async () => {
      await bus.current.editor?.openFile(path);
      bus.current.editor?.gotoLine(line);
    })();
  };

  const replaceAll = (): void => {
    if (!query.trim()) return;
    void (async () => {
      let re: RegExp;
      try { re = new RegExp(buildSource(query, regexMode, wholeWord), caseSensitive ? 'g' : 'gi'); }
      catch { setMsg('正则表达式无效'); return; }
      const files: string[] = [];
      await walk(projectDir, 0, files);
      let changed = 0;
      for (const f of files) {
        let text: string;
        try { text = await api.fsRead(f); } catch { continue; }
        if (text.length > MAX_BYTES) continue;
        let next: string;
        try { next = text.replace(re, replaceText); } catch { continue; }
        if (next !== text) {
          try { await api.fsWrite(f, next); changed += 1; } catch { /* 跳过不可写文件 */ }
        }
      }
      setMsg(changed > 0 ? `已替换 ${changed} 个文件` : '没有可替换的内容');
      onChanged?.();
      void run();
    })();
  };

  const totalHits = results.reduce((n, f) => n + f.hits.length, 0);

  const toggleGroup = (p: string): void => {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p); else n.add(p);
      return n;
    });
  };

  return (
    <div className="explorer search-panel">
      <div className="explorer-head">
        <span>搜索</span>
        <span style={{ flex: 1 }} />
        <button
          className={`icon-btn s-opt ${showReplace ? 'active' : ''}`}
          title="显示替换"
          onClick={() => setShowReplace((v) => !v)}
        >
          <IconReplace size={13} />
        </button>
      </div>

      <div className="search-form">
        <div className="search-field">
          <span className="sf-ico"><IconSearch size={13} /></span>
          <input
            ref={inputRef}
            className="sf-input"
            placeholder="在工程中搜索"
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void run(); }
              if (e.key === 'Escape') setQuery('');
            }}
          />
          <div className="sf-toggles">
            <button className={`s-opt ${caseSensitive ? 'active' : ''}`} title="区分大小写" onClick={() => setCaseSensitive((v) => !v)}>Aa</button>
            <button className={`s-opt ${wholeWord ? 'active' : ''}`} title="全词匹配" onClick={() => setWholeWord((v) => !v)}>ab</button>
            <button className={`s-opt ${regexMode ? 'active' : ''}`} title="正则表达式" onClick={() => setRegexMode((v) => !v)}>.*</button>
          </div>
        </div>

        {showReplace && (
          <div className="search-field">
            <span className="sf-ico"><IconReplace size={13} /></span>
            <input
              className="sf-input"
              placeholder="替换为"
              value={replaceText}
              spellCheck={false}
              onChange={(e) => setReplaceText(e.target.value)}
            />
            <button className="btn small grad" onClick={replaceAll} disabled={!query.trim() || totalHits === 0}>
              全部替换
            </button>
          </div>
        )}
      </div>

      <div className="search-summary">
        {busy ? <span className="muted">搜索中……</span>
          : msg ? <span className="muted">{msg}</span>
          : query.trim() ? <span className="muted">{totalHits} 个结果 · {results.length} 个文件</span>
          : <span className="muted">输入关键字开始搜索</span>}
      </div>

      <div className="search-results">
        {results.map((f) => {
          const open = !collapsed.has(f.path);
          return (
            <div key={f.path} className="sr-file">
              <div className="sr-filehead" onClick={() => toggleGroup(f.path)} title={f.path}>
                <span className={`sr-caret ${open ? 'open' : ''}`}><IconChevronDown size={12} /></span>
                <span className="sr-name">{f.name}</span>
                <span className="sr-count">{f.hits.length}</span>
              </div>
              {open && f.hits.map((h) => (
                <div key={`${f.path}:${h.line}`} className="sr-hit" onClick={() => openHit(f.path, h.line)} title={`${f.path}:${h.line}`}>
                  <span className="sr-line mono">{h.line}</span>
                  <span className="sr-text mono">{h.text}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
