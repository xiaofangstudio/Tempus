import React, { useCallback, useRef } from 'react';

/* 通用拖拽分隔条 —— "整个界面都能自己拖着调"的基础件。
 *
 * 用法：<Splitter dir="col" targetRef={xxRef} invert onSize={setW} onCommit={save} onReset={clear} />
 *  - dir: col = 左右拖改宽度；row = 上下拖改高度
 *  - targetRef: 要改尺寸的元素；不传就取分隔条的前一个兄弟（也支持后一个：见 pick）
 *  - invert: 拖向右/下是"变小"（右栏、底栏用）
 *  - 双击复位（onReset）
 *
 * 拖动期间给 body 加 col/row-resizing：统一光标、禁掉 iframe 与 Monaco 的命中，
 * 否则鼠标一进预览画面拖动就断。 */

type Props = {
  /** col = 改宽度，row = 改高度 */
  dir?: 'col' | 'row';
  /** 被调整尺寸的元素；不传则取"后一个兄弟"（右侧/下方那一栏） */
  targetRef?: React.RefObject<HTMLElement | null>;
  /** 取前一个兄弟而不是后一个（左栏/上方那一栏） */
  prev?: boolean;
  min?: number;
  max?: number;
  /** 拖向右/下时尺寸变小（用于右栏、底部面板） */
  invert?: boolean;
  onSize: (px: number) => void;
  /** 松手时回调：用来落盘 */
  onCommit?: (px: number) => void;
  onReset?: () => void;
  title?: string;
};

export function Splitter({
  dir = 'col', targetRef, prev = false, min = 80, max = 4000,
  invert = false, onSize, onCommit, onReset, title
}: Props) {
  const dragRef = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const host = e.currentTarget as HTMLElement;
    const el = targetRef?.current
      ?? ((prev ? host.previousElementSibling : host.nextElementSibling) as HTMLElement | null);
    const rect = el?.getBoundingClientRect();
    if (!rect) return;
    const startPos = dir === 'col' ? e.clientX : e.clientY;
    const base = dir === 'col' ? rect.width : rect.height;
    let last = base;
    dragRef.current = true;
    document.body.classList.add(dir === 'col' ? 'col-resizing' : 'row-resizing');

    const onMove = (ev: MouseEvent): void => {
      const now = dir === 'col' ? ev.clientX : ev.clientY;
      const d = (now - startPos) * (invert ? -1 : 1);
      last = Math.round(Math.max(min, Math.min(max, base + d)));
      onSize(last);
    };
    const onUp = (): void => {
      dragRef.current = false;
      document.body.classList.remove(dir === 'col' ? 'col-resizing' : 'row-resizing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      onCommit?.(last);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [dir, targetRef, prev, min, max, invert, onSize, onCommit]);

  return (
    <div
      className={`splitter ${dir}`}
      role="separator"
      aria-orientation={dir === 'col' ? 'vertical' : 'horizontal'}
      title={title ?? (dir === 'col' ? '拖动调整宽度（双击复位）' : '拖动调整高度（双击复位）')}
      onMouseDown={onMouseDown}
      onDoubleClick={onReset}
    />
  );
}

/** 记忆一个尺寸：读 localStorage / 落盘，写失败（隐私模式）一律忽略 */
export function remember(key: string): {
  load: (min: number, max: number) => number | null;
  save: (v: number) => void;
  clear: () => void;
} {
  return {
    load(min, max) {
      try {
        const v = Number(localStorage.getItem(key));
        return Number.isFinite(v) && v >= min && v <= max ? v : null;
      } catch { return null; }
    },
    save(v) {
      try { localStorage.setItem(key, String(Math.round(v))); } catch { /* 忽略 */ }
    },
    clear() {
      try { localStorage.removeItem(key); } catch { /* 忽略 */ }
    }
  };
}
