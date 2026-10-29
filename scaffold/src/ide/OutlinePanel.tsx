import React, { useCallback, useEffect, useState } from 'react';
import type { EditorHandle, OutlineItem } from './EditorPane';
import { IconOutline, IconRefresh } from '../ui/icons';

/* 大纲：解析当前编辑文件的声明（组件 / 函数 / 常量 / 类型），点击跳转。 */

type Props = {
  activeFile: string | null;
  bus: React.MutableRefObject<{ editor?: EditorHandle }>;
};

const KIND_COLOR: Record<string, string> = {
  组件: 'var(--brand)',
  函数: '#7c5cf0',
  常量: '#0f9d76',
  类: '#d9822b',
  类型: '#2aa3c9'
};

export function OutlinePanel({ activeFile, bus }: Props) {
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    const ed = bus.current.editor;
    if (!ed) { setItems([]); return; }
    setItems(ed.getOutline());
  }, [bus]);

  useEffect(() => {
    // 模型可能晚于 activeFile 就绪，短延时补一次
    const t1 = window.setTimeout(refresh, 0);
    const t2 = window.setTimeout(refresh, 220);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [refresh, activeFile, tick]);

  const name = activeFile ? activeFile.split(/[\\/]/).pop() : '';

  return (
    <div className="explorer outline-panel">
      <div className="explorer-head">
        <span>大纲</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" style={{ width: 22, height: 22 }} title="刷新大纲" onClick={() => setTick((n) => n + 1)}>
          <IconRefresh size={12} />
        </button>
      </div>
      {!activeFile ? (
        <div className="panel-empty">
          <IconOutline size={22} />
          <span>没有打开的文件</span>
        </div>
      ) : (
        <>
          <div className="outline-file mono" title={activeFile}>{name}</div>
          <div className="outline-list">
            {items.length === 0 && <div className="panel-empty small">此文件没有可提取的声明</div>}
            {items.map((it) => (
              <div
                key={`${it.name}:${it.line}`}
                className="outline-item"
                onClick={() => bus.current.editor?.gotoLine(it.line)}
                title={`第 ${it.line} 行`}
              >
                <span className="oi-kind" style={{ color: KIND_COLOR[it.kind] ?? 'var(--txt3)' }}>{it.kind}</span>
                <span className="oi-name">{it.name}</span>
                <span className="oi-line mono">{it.line}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
