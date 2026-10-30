import React, { useEffect, useRef, useState } from 'react';
import { IconFilm, IconWave } from '../ui/icons';

/* 新建文件：先选类型（画面 / 音频），再填名字。
 * 两类文件写法不同 —— 画面返回 JSX，音频返回 <Audio>（不画东西，只铺声音）。 */

export type NewFileKind = 'visual' | 'audio';

type Props = {
  onPick: (kind: NewFileKind, name: string) => void;
  onClose: () => void;
};

const KINDS: { id: NewFileKind; title: string; desc: string; ph: string }[] = [
  {
    id: 'visual',
    title: '画面文件',
    desc: '返回 JSX，渲染到画布上。一个文件通常就是一个场景。',
    ph: 'scenes/Intro.tsx'
  },
  {
    id: 'audio',
    title: '音频文件',
    desc: '返回 <Audio>，不画东西只铺声音。音量可逐帧写成淡入淡出。',
    ph: 'audio/背景音乐.tsx'
  }
];

export function NewFileDialog({ onPick, onClose }: Props) {
  const [kind, setKind] = useState<NewFileKind>('visual');
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, [kind]);

  const submit = (): void => {
    const v = name.trim();
    if (!v) return;
    onPick(kind, v);
  };

  return (
    <div className="modal-mask dialog-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog wide" role="dialog" aria-modal="true" onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
        else if (e.key === 'Enter') { e.preventDefault(); submit(); }
      }}>
        <div className="dialog-title">新建文件</div>
        <div className="nf-kinds">
          {KINDS.map((k) => {
            const active = kind === k.id;
            return (
              <button
                key={k.id}
                type="button"
                className={`nf-kind ${active ? 'active' : ''}`}
                onClick={() => setKind(k.id)}
              >
                <span className="nf-kind-icon">
                  {k.id === 'visual' ? <IconFilm size={18} /> : <IconWave size={18} />}
                </span>
                <span className="nf-kind-main">
                  <span className="nf-kind-title">{k.title}</span>
                  <span className="nf-kind-desc">{k.desc}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="dialog-label" style={{ marginTop: 16 }}>
          文件名（可带子目录）· {kind === 'visual' ? '建议 .tsx' : '建议 .tsx，会被画面文件 import'}
        </div>
        <input
          ref={inputRef}
          className="dialog-input"
          value={name}
          spellCheck={false}
          placeholder={KINDS.find((k) => k.id === kind)?.ph}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="dialog-actions">
          <button className="btn ghost small" onClick={onClose}>取消</button>
          <button className="btn primary small" onClick={submit} disabled={!name.trim()}>创建</button>
        </div>
      </div>
    </div>
  );
}
