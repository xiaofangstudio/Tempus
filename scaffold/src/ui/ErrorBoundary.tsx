import React from 'react';

/* 顶层错误边界：任何渲染期异常都落到一张可恢复的卡片上，而不是整屏空白。
 * 不吞异常——同时写 console，方便开发期定位。 */

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[Tempus] 渲染异常：', error, info.componentStack);
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-card">
          <div className="crash-badge">!</div>
          <div className="crash-title">界面出了点问题</div>
          <div className="crash-sub">已捕获异常，你的文件没有被修改，可以放心恢复。</div>
          <pre className="crash-msg">{String(error.message || error)}</pre>
          <div className="crash-actions">
            <button className="btn primary" onClick={() => window.location.reload()}>重新加载</button>
            <button className="btn" onClick={() => this.setState({ error: null })}>尝试恢复</button>
          </div>
        </div>
      </div>
    );
  }
}
