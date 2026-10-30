import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/* 自研命令式弹窗。
 *
 * 为什么不用 window.prompt / window.confirm：
 *   Tauri 的 WebView2 宿主不处理 ScriptDialogOpening，原生 prompt 直接返回 null、
 *   confirm 直接返回 false —— 新建文件、重命名、删除确认、Git 建分支会全部「点了没反应」。
 *   所以 IDE 自己提供输入框与确认框，Promise 风格：
 *
 *     const name = await askText({ title: '新建文件', value: 'scene2.tsx' });
 *     if (await askConfirm({ title: '删除', message: '不可恢复', danger: true })) { ... }
 *
 * 宿主组件 <DialogHost /> 挂在应用根部，全局只要一个。 */

type TextReq = {
  kind: 'text';
  title: string;
  label?: string;
  value?: string;
  placeholder?: string;
  okText?: string;
};

type ConfirmReq = {
  kind: 'confirm';
  title: string;
  message: string;
  danger?: boolean;
  okText?: string;
};

type AlertReq = {
  kind: 'alert';
  title: string;
  message: string;
  okText?: string;
  /** 等宽字体（快捷键表格这类需要对齐的内容） */
  mono?: boolean;
  /** 宽版弹窗 */
  wide?: boolean;
};

type Req = TextReq | ConfirmReq | AlertReq;

type Pending = { req: Req; resolve: (v: unknown) => void };

let pending: Pending | null = null;
const subs = new Set<() => void>();
const emit = (): void => { subs.forEach((f) => f()); };

const snapshot = (): Pending | null => pending;

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

function open<T>(req: Req): Promise<T> {
  /* 同一时刻只留一个：旧请求按「取消」返回，避免弹窗叠罗汉 */
  if (pending) {
    pending.resolve(req.kind === 'text' ? null : req.kind === 'alert' ? undefined : false);
    pending = null;
  }
  return new Promise<T>((resolve) => {
    pending = { req, resolve: resolve as (v: unknown) => void };
    emit();
  });
}

export function askText(o: Omit<TextReq, 'kind'>): Promise<string | null> {
  return open<string | null>({ kind: 'text', ...o });
}

export function askConfirm(o: Omit<ConfirmReq, 'kind'>): Promise<boolean> {
  return open<boolean>({ kind: 'confirm', ...o });
}

/** 纯提示（帮助 / 关于 / 快捷键一览），只会有一个「知道了」按钮 */
export function askAlert(o: Omit<AlertReq, 'kind'>): Promise<void> {
  return open<void>({ kind: 'alert', ...o });
}

function close(value: string | null | boolean | undefined): void {
  const p = pending;
  pending = null;
  emit();
  p?.resolve(value);
}

export function DialogHost(): React.ReactElement | null {
  const cur = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  /* 打开时：文本类型自动聚焦并全选（重命名场景直接覆盖输入），确认类型聚焦确定按钮 */
  useEffect(() => {
    if (!cur) return;
    if (cur.req.kind === 'text') {
      setText(cur.req.value ?? '');
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    } else {
      requestAnimationFrame(() => okRef.current?.focus());
    }
  }, [cur]);

  if (!cur) return null;

  const req = cur.req;
  const isText = req.kind === 'text';
  const isAlert = req.kind === 'alert';
  const cancelValue = isText ? null : isAlert ? undefined : false;
  const okText = req.okText ?? (isAlert ? '知道了' : '确定');

  const submit = (): void => {
    if (req.kind === 'text') {
      const v = text.trim();
      if (!v) return;
      close(v);
    } else if (req.kind === 'alert') {
      close(undefined);
    } else {
      close(true);
    }
  };

  return (
    <div
      className="modal-mask dialog-mask"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(cancelValue); }}
    >
      <div
        className={`dialog ${req.kind === 'alert' && req.wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); close(cancelValue); }
          else if (e.key === 'Enter') { e.preventDefault(); submit(); }
        }}
      >
        <div className="dialog-title">{req.title}</div>
        {req.kind === 'text' ? (
          <>
            {req.label && <div className="dialog-label">{req.label}</div>}
            <input
              ref={inputRef}
              className="dialog-input"
              value={text}
              spellCheck={false}
              placeholder={req.placeholder ?? ''}
              onChange={(e) => setText(e.target.value)}
            />
          </>
        ) : (
          <div className={`dialog-msg ${req.kind === 'alert' && req.mono ? 'mono' : ''}`}>{req.message}</div>
        )}
        <div className="dialog-actions">
          {req.kind !== 'alert' && (
            <button className="btn ghost small" onClick={() => close(cancelValue)}>取消</button>
          )}
          <button
            ref={okRef}
            className={`btn small ${req.kind === 'confirm' && req.danger ? 'danger' : 'primary'}`}
            onClick={submit}
            disabled={req.kind === 'text' && !text.trim()}
          >
            {okText}
          </button>
        </div>
      </div>
    </div>
  );
}
