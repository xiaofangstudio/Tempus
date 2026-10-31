import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loading } from './ui/Loading';
import { Welcome } from './ui/Welcome';
import { Workspace } from './workspace/Workspace';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { DialogHost } from './ui/dialog';
import { applyDensity, applyTheme, loadSettings } from './core/settings';
import { api, listen } from './core/tauri';
import { IconClose, IconInfo } from './ui/icons';

type Page = { kind: 'loading' } | { kind: 'welcome' } | { kind: 'ws'; dir: string };

/* 全局报错条：
 * 打包后的应用没有控制台 —— 出错只 console.error 等于没报。
 * 这里把"未捕获异常 / 未处理的 Promise 拒绝"直接摆到界面上，同一条 8 秒内合并计数。 */
function useErrorBanner() {
  const [err, setErr] = useState<{ msg: string; n: number; id: number } | null>(null);
  const seq = useRef(0);

  const push = useCallback((raw: unknown): void => {
    const msg = raw instanceof Error
      ? (raw.message || raw.name)
      : typeof raw === 'string' ? raw : (() => {
          try { return JSON.stringify(raw); } catch { return String(raw); }
        })();
    if (!msg || /^(undefined|null)$/.test(msg)) return;
    setErr((prev) => {
      seq.current += 1;
      const same = prev && prev.msg === msg;
      return { msg, n: same ? prev.n + 1 : 1, id: seq.current };
    });
  }, []);

  useEffect(() => {
    const onErr = (e: ErrorEvent): void => {
      console.error('[Tempus] 未捕获错误：', e.error ?? e.message);
      push(e.error ?? e.message);
    };
    const onRej = (e: PromiseRejectionEvent): void => {
      console.error('[Tempus] 未处理的 Promise 拒绝：', e.reason);
      push(e.reason);
    };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, [push]);

  useEffect(() => {
    if (!err) return;
    const t = window.setTimeout(() => setErr(null), 9000);
    return () => window.clearTimeout(t);
  }, [err]);

  return { err, push, dismiss: () => setErr(null) };
}

export default function App() {
  const [page, setPage] = useState<Page>(() => {
    // 开发辅助：?ws=<dir> 直接进入工作区（配合浏览器内 mock 后端做视觉验证）
    const wsDir = new URLSearchParams(window.location.search).get('ws');
    return wsDir ? { kind: 'ws', dir: wsDir } : { kind: 'loading' };
  });
  const { err, dismiss } = useErrorBanner();

  /* 界面密度与主题首帧即生效，避免闪一下 */
  useEffect(() => {
    const s = loadSettings();
    applyDensity(s.density);
    applyTheme(s.theme);
  }, []);

  /* MCP 请求兜底：还没进工作区时，Workspace 的监听不存在，
   * 不接管的话后端会等满超时才报错。这里立刻回一句人话。 */
  useEffect(() => {
    if (page.kind === 'ws') return;
    const un = listen<{ reqId: number }>('mcp-request', (p) => {
      void api.mcpRespond(
        p.reqId,
        JSON.stringify({ ok: false, error: '请先在 Tempus 里打开工程 —— MCP 操作需要工程窗口' })
      ).catch(() => {});
    });
    return () => { un.then((f) => f()).catch(() => {}); };
  }, [page.kind]);

  let content: React.ReactNode;
  if (page.kind === 'loading') {
    content = <Loading onDone={() => setPage({ kind: 'welcome' })} />;
  } else if (page.kind === 'welcome') {
    content = <Welcome onOpenProject={(dir) => setPage({ kind: 'ws', dir })} />;
  } else {
    content = <Workspace projectDir={page.dir} onExit={() => setPage({ kind: 'welcome' })} />;
  }

  return (
    <div className="app-shell">
      <div className="ambient" aria-hidden="true">
        <i className="b1" />
        <i className="b2" />
        <i className="b3" />
      </div>
      <ErrorBoundary>{content}</ErrorBoundary>
      <DialogHost />
      {err && (
        <div className="err-banner" role="alert">
          <IconInfo size={15} />
          <div className="err-banner-body">
            <div className="err-banner-title">
              出了点问题{err.n > 1 ? `（重复 ${err.n} 次）` : ''}
            </div>
            <div className="err-banner-msg mono">{err.msg}</div>
          </div>
          <button className="icon-btn" style={{ width: 24, height: 24 }} title="关闭" onClick={dismiss}>
            <IconClose size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
