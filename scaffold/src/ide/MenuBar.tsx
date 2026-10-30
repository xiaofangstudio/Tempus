import React, { useEffect, useRef, useState } from 'react';

/* IDE 菜单栏：文件 / 编辑 / 选择 / 查看 / 转到 / 运行 / 终端 / 帮助
 *
 * 交互对齐 VSCode：
 *  - 点标题展开；已展开时鼠标移到别的标题直接切换（不用再点一次）
 *  - 点遮罩、Esc、执行完命令都关闭
 *  - 打开状态下 ←→ 切菜单、↑↓ 选项、Enter 执行
 *  - 快捷键提示右对齐，tabular-nums 保证不抖动
 */

export type MenuItem = {
  id: string;
  label?: string;
  hint?: string;
  run?: () => void;
  disabled?: boolean;
  sep?: boolean;
  checked?: boolean;
};

export type MenuGroup = { id: string; label: string; items: MenuItem[] };

const pickable = (g: MenuGroup): number[] =>
  g.items.map((it, i) => (it.sep || it.disabled ? -1 : i)).filter((i) => i >= 0);

export function MenuBar({ menus }: { menus: MenuGroup[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [hi, setHi] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent): void => {
      const g = menus[open];
      if (!g) return;
      const idxs = pickable(g);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(null); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        if (!idxs.length) return;
        const cur = idxs.indexOf(hi);
        const next = e.key === 'ArrowDown'
          ? idxs[(cur + 1) % idxs.length]
          : idxs[(cur - 1 + idxs.length) % idxs.length];
        setHi(next);
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const n = menus.length;
        const ni = ((open + dir) % n + n) % n;
        setOpen(ni);
        setHi(pickable(menus[ni])[0] ?? 0);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const it = g.items[hi];
        if (it && !it.sep && !it.disabled) { setOpen(null); it.run?.(); }
      }
    };
    /* capture：菜单打开时优先于 Monaco 等内部按键处理 */
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, hi, menus]);

  return (
    <>
      {open != null && <div className="mb-scrim" onMouseDown={() => setOpen(null)} />}
      <div className="menubar" ref={barRef}>
        {menus.map((g, gi) => (
          <div className="mb-root" key={g.id}>
            <button
              type="button"
              className={`mb-title ${open === gi ? 'open' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                if (open === gi) { setOpen(null); return; }
                setOpen(gi);
                setHi(pickable(g)[0] ?? 0);
              }}
              onMouseEnter={() => {
                if (open != null && open !== gi) { setOpen(gi); setHi(pickable(g)[0] ?? 0); }
              }}
            >
              {g.label}
            </button>
            {open === gi && (
              <div className="mb-drop" onMouseDown={(e) => e.stopPropagation()}>
                {g.items.map((it, ii) => it.sep ? (
                  <div className="mb-sep" key={it.id} />
                ) : (
                  <div
                    key={it.id}
                    className={`mb-row ${ii === hi ? 'hi' : ''} ${it.disabled ? 'dis' : ''}`}
                    onMouseEnter={() => setHi(ii)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (it.disabled) return;
                      setOpen(null);
                      it.run?.();
                    }}
                  >
                    <span className="mb-check">{it.checked ? '✓' : ''}</span>
                    <span className="mb-label">{it.label}</span>
                    {it.hint && <span className="mb-hint">{it.hint}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
