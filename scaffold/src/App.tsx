import React, { useEffect, useState } from 'react';
import { Loading } from './ui/Loading';
import { Welcome } from './ui/Welcome';
import { Workspace } from './workspace/Workspace';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { DialogHost } from './ui/dialog';
import { applyDensity, applyTheme, loadSettings } from './core/settings';

type Page = { kind: 'loading' } | { kind: 'welcome' } | { kind: 'ws'; dir: string };

export default function App() {
  const [page, setPage] = useState<Page>(() => {
    // 开发辅助：?ws=<dir> 直接进入工作区（配合浏览器内 mock 后端做视觉验证）
    const wsDir = new URLSearchParams(window.location.search).get('ws');
    return wsDir ? { kind: 'ws', dir: wsDir } : { kind: 'loading' };
  });

  /* 界面密度与主题首帧即生效，避免闪一下 */
  useEffect(() => {
    const s = loadSettings();
    applyDensity(s.density);
    applyTheme(s.theme);
  }, []);

  /* 全局异常兜底：渲染期错误由 ErrorBoundary 接管，这里记录事件回调等游离异常 */
  useEffect(() => {
    const onErr = (e: ErrorEvent): void => {
      console.error('[Tempus] 未捕获错误：', e.error ?? e.message);
    };
    const onRej = (e: PromiseRejectionEvent): void => {
      console.error('[Tempus] 未处理的 Promise 拒绝：', e.reason);
    };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, []);

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
    </div>
  );
}
