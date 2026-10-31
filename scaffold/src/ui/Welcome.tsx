import React, { useEffect, useState } from 'react';
import { api } from '../core/tauri';
import { TEMPLATES, DEFAULT_FRAME, type Template, type FrameSpec } from '../core/templates';
import { frameById, frameIdOf } from '../core/frame';
import { FrameGrid } from './FramePicker';
import { loadSettings, saveSettings, onSettings, type Theme } from '../core/settings';
import { Logo, IconFolder, IconPlus, IconImport, IconClose, IconWand, IconBranch, IconMcp, IconSun, IconMoon } from './icons';
import type { RecentItem } from '../core/types';

/* 欢迎页：左栏主操作 + 最近工程，右侧品牌横幅 + 模板卡片（PyCharm 式双栏）。 */

function TplThumb({ tpl }: { tpl: Template }) {
  if (tpl.id === 'standard') return (
    <svg width="100%" height="100%" viewBox="0 0 220 118" preserveAspectRatio="xMidYMid slice">
      <rect width="220" height="118" fill="#eef4ff" />
      <rect x="24" y="22" width="172" height="74" rx="8" fill="#ffffff" stroke="#dde7f5" />
      <rect x="36" y="34" width="46" height="14" rx="4" fill="#9cc3fb" />
      <rect x="88" y="34" width="58" height="14" rx="4" fill="#3d86f4" />
      <rect x="152" y="34" width="32" height="14" rx="4" fill="#bcd7fc" />
      <rect x="36" y="56" width="88" height="14" rx="4" fill="#cfe2fd" />
      <rect x="130" y="56" width="54" height="14" rx="4" fill="#e3eefc" />
      <rect x="36" y="78" width="60" height="8" rx="3" fill="#e3eefc" />
      <line x1="108" y1="30" x2="108" y2="90" stroke="#1f6feb" strokeWidth="2" strokeLinecap="round" />
      <path d="M108 26l4.5 8h-9z" fill="#1f6feb" />
    </svg>);
  if (tpl.id === 'three') return (
    <svg width="100%" height="100%" viewBox="0 0 220 118" preserveAspectRatio="xMidYMid slice">
      <rect width="220" height="118" fill="#0d1730" />
      {[[28, 22, 1.3], [52, 84, 1], [76, 30, 1.5], [150, 20, 1.1], [186, 60, 1.4], [196, 96, 1], [40, 56, 1], [118, 14, 1.2], [206, 30, 1.3], [16, 96, 1.2]].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#7fa8e8" opacity={0.6} />
      ))}
      <polygon points="110,30 146,50 146,84 110,104 74,84 74,50" fill="none" stroke="#5aa9ff" strokeWidth="1.8" opacity="0.95" />
      <polygon points="110,44 132,56 132,78 110,90 88,78 88,56" fill="none" stroke="#5aa9ff" strokeWidth="1" opacity="0.5" />
      <line x1="110" y1="30" x2="110" y2="44" stroke="#5aa9ff" strokeWidth="1" opacity="0.5" />
      <line x1="146" y1="50" x2="132" y2="56" stroke="#5aa9ff" strokeWidth="1" opacity="0.5" />
      <line x1="146" y1="84" x2="132" y2="78" stroke="#5aa9ff" strokeWidth="1" opacity="0.5" />
      <line x1="74" y1="50" x2="88" y2="56" stroke="#5aa9ff" strokeWidth="1" opacity="0.5" />
      <circle cx="110" cy="67" r="3" fill="#5aa9ff" />
    </svg>);
  return (
    <svg width="100%" height="100%" viewBox="0 0 220 118" preserveAspectRatio="xMidYMid slice">
      <rect width="220" height="118" fill="#eef4ff" />
      <rect x="46" y="24" width="128" height="70" rx="9" fill="#ffffff" stroke="#dde7f5" />
      <rect x="46" y="24" width="128" height="70" rx="9" fill="none" stroke="#c3d8fb" strokeDasharray="0" />
      <line x1="60" y1="44" x2="160" y2="44" stroke="#e3eefc" strokeWidth="2" strokeLinecap="round" />
      <line x1="60" y1="56" x2="140" y2="56" stroke="#e3eefc" strokeWidth="2" strokeLinecap="round" />
      <line x1="60" y1="68" x2="152" y2="68" stroke="#e3eefc" strokeWidth="2" strokeLinecap="round" />
      <path d="M100 88l16 9-16 9z" fill="#1f6feb" transform="translate(2,-42)" opacity="0" />
      <path d="M92 51l18 10-18 10z" fill="#1f6feb" />
      <circle cx="178" cy="30" r="10" fill="#dcebfe" />
      <circle cx="38" cy="88" r="14" fill="#dcebfe" />
    </svg>);
}

/* 新建工程对话框：模板三选一 + 名称 + 位置 */
function NewProjectDialog({ preset, onClose, onOpenProject }: {
  preset: Template;
  onClose: () => void;
  onOpenProject: (dir: string) => void;
}) {
  const [tplId, setTplId] = useState(preset.id);
  const [name, setName] = useState(preset.name);
  const [loc, setLoc] = useState('');
  const [frame, setFrame] = useState<FrameSpec>(() => ({ ...DEFAULT_FRAME }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const def = window.localStorage.getItem('tempus.newProjectDir');
    if (def) setLoc(def);
    /* 记住上次选的画幅与帧率：一条片子通常要连续做很多条同样尺寸的 */
    const p = window.localStorage.getItem('tempus.newProjectFrame');
    if (p) {
      const hit = frameById(p);
      if (hit) setFrame((s) => ({ ...s, width: hit.w, height: hit.h }));
    }
    const fps = Number(window.localStorage.getItem('tempus.newProjectFps'));
    if (Number.isFinite(fps) && fps >= 1 && fps <= 120) setFrame((s) => ({ ...s, fps }));
  }, []);

  const tpl = TEMPLATES.find((t) => t.id === tplId) ?? TEMPLATES[0];

  const browse = async (): Promise<void> => {
    const dir = await api.pickFolder('选择工程存放文件夹');
    if (dir) {
      setLoc(dir);
      window.localStorage.setItem('tempus.newProjectDir', dir);
    }
  };

  const create = async (): Promise<void> => {
    if (!loc) { setErr('请选择工程存放位置'); return; }
    if (!name.trim()) { setErr('请填写工程名称'); return; }
    setBusy(true);
    setErr('');
    try {
      /* 全部文件按选中的画幅生成：project.json、registerComposition、
       * 以及模板内部的字号间距都会跟着走，所以 9:16 也不会溢出 */
      const files: Record<string, string> = tpl.build(frame);
      try {
        const meta = JSON.parse(files['project.json']);
        meta.name = name.trim();
        files['project.json'] = JSON.stringify(meta, null, 2);
      } catch { /* 模板无 project.json 时忽略 */ }
      window.localStorage.setItem('tempus.newProjectFrame', frameIdOf(frame.width, frame.height));
      window.localStorage.setItem('tempus.newProjectFps', String(frame.fps));
      const projDir = await api.projectNew(loc, name.trim(), files);
      onOpenProject(projDir);
    } catch (e) {
      setErr('创建失败：' + String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal npd" onClick={(e) => e.stopPropagation()}>
        <h3>新建工程</h3>
        <div className="npd-tpls">
          {TEMPLATES.map((t) => (
            <div key={t.id} className={`npd-tpl ${t.id === tplId ? 'active' : ''}`} onClick={() => setTplId(t.id)}>
              <div className="npd-thumb"><TplThumb tpl={t} /></div>
              <div className="npd-tplname">{t.name}</div>
              <div className="npd-tpldesc">{t.desc}</div>
            </div>
          ))}
        </div>
        <div className="form-row">
          <label>工程名称</label>
          <input type="text" className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="我的动效" />
        </div>
        <div className="form-row">
          <label>存放位置</label>
          <input type="text" className="grow" value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="选择文件夹……" />
          <button className="btn" onClick={() => void browse()}>浏览</button>
        </div>
        <div className="npd-frame">
          <div className="npd-frame-head">
            <span>画幅</span>
            <span className="npd-frame-cur mono">{frame.width} × {frame.height} · {frame.fps}fps</span>
          </div>
          <FrameGrid
            value={frame}
            max={38}
            onPick={(w, h) => setFrame((f) => ({ ...f, width: w, height: h }))}
          />
          <div className="npd-fps">
            <span>帧率</span>
            {[24, 25, 30, 60].map((f) => (
              <button key={f} type="button" className={`chip ${frame.fps === f ? 'active' : ''}`}
                onClick={() => setFrame((s) => ({ ...s, fps: f }))}>
                {f} fps
              </button>
            ))}
          </div>
        </div>
        {err && <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn grad" disabled={busy} onClick={() => void create()}>{busy ? '正在创建……' : '创建'}</button>
        </div>
      </div>
    </div>
  );
}

export function Welcome({ onOpenProject }: { onOpenProject: (dir: string) => void }) {
  const [recents, setRecents] = useState<RecentItem[]>([]);
  const [busy, setBusy] = useState('');
  const [newTpl, setNewTpl] = useState<Template | null>(null);
  /* 主题：欢迎页也要能一键切（进工程前就该选好深浅） */
  const [theme, setTheme] = useState<Theme>(() => loadSettings().theme);
  useEffect(() => onSettings((s) => setTheme(s.theme)), []);
  const toggleTheme = (): void => {
    const next: Theme = loadSettings().theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    saveSettings({ theme: next });
  };

  useEffect(() => {
    api.recentGet().then(setRecents).catch(() => setRecents([]));
  }, []);

  const openExisting = async (): Promise<void> => {
    const dir = await api.pickFolder('选择工程文件夹（含 project.json）');
    if (!dir) return;
    onOpenProject(dir);
  };

  const importZip = async (): Promise<void> => {
    const zip = await api.pickSaveFile('选择 .tempus 工程包', '', 'tempus');
    if (!zip) return;
    setBusy('正在导入……');
    try {
      const destRoot = zip.replace(/[\\/]+$/, '').replace(/\.tempus$/, '');
      const projDir = await api.projectImportZip(zip, destRoot);
      onOpenProject(projDir);
    } catch (e) {
      alert('导入失败：' + String(e));
    } finally {
      setBusy('');
    }
  };

  const removeRecent = async (path: string): Promise<void> => {
    await api.recentRemove(path).catch(() => {});
    setRecents((l) => l.filter((r) => r.path !== path));
  };

  return (
    <div className="welcome">
      <div className="welcome-body">
        <aside className="wl-side">
          <div className="wl-brand">
            <Logo size={48} />
            <div>
              <div className="wl-title">Tempus</div>
              <div className="wl-sub">编码动效工作室</div>
            </div>
          </div>
          <button className="wl-act primary" onClick={() => setNewTpl(TEMPLATES[0])}>
            <IconPlus /> 新建工程
          </button>
          <button className="wl-act" onClick={() => void openExisting()}>
            <IconFolder /> 打开工程
          </button>
          <button className="wl-act" onClick={() => void importZip()}>
            <IconImport /> 导入工程包
          </button>

          <div className="wl-sec">最近工程</div>
          <div className="wl-recent">
            {recents.length === 0 && <div className="muted" style={{ padding: '6px 4px', fontSize: 12 }}>还没有打开过工程</div>}
            {recents.map((r, i) => (
              <div key={r.path} className="wl-recent-item" style={{ animationDelay: `${0.05 + i * 0.04}s` }} onClick={() => onOpenProject(r.path)}>
                <div style={{ minWidth: 0 }}>
                  <div className="wl-recent-name">{r.name}</div>
                  <div className="wl-recent-path">{r.path}</div>
                </div>
                <span className="icon-btn" style={{ width: 22, height: 22, flex: 'none' }}
                  title="从列表移除（不删除文件）"
                  onClick={(e) => { e.stopPropagation(); void removeRecent(r.path); }}>
                  <IconClose size={11} />
                </span>
              </div>
            ))}
          </div>

          <div className="wl-sidefoot">
            <div><b>Space</b> 播放/暂停　<b>←</b><b>→</b> 逐帧</div>
            <div><b>Ctrl+S</b> 保存　<b>Ctrl+E</b> 导出　<b>Ctrl+`</b> 终端</div>
          </div>
        </aside>

        <main className="wl-main">
          <div className="wl-hero">
            <div className="wl-hero-logo"><Logo size={128} /></div>
            <h1>代码即动画</h1>
            <p>左边写组件，右边出成片。改一行代码，画面立刻变 —— 时间轴、监视器、渲染管线一应俱全。</p>
            <div className="wl-hero-tags">
              <span className="wl-hero-tag">Remotion 同源思路</span>
              <span className="wl-hero-tag">确定性逐帧渲染</span>
              <span className="wl-hero-tag">MCP 接入外部 AI</span>
            </div>
          </div>

          <div className="section-title">从模板开始</div>
          <div className="tpl-grid">
            {TEMPLATES.map((t, i) => (
              <div key={t.id} className="tpl-card" style={{ animationDelay: `${0.1 + i * 0.07}s` }} onClick={() => setNewTpl(t)}>
                <div className="tpl-thumb"><TplThumb tpl={t} /></div>
                <div className="tpl-name">{t.name}</div>
                <div className="tpl-desc">{t.desc}</div>
              </div>
            ))}
          </div>

          <div className="wl-feats">
            <div className="wl-feat" style={{ animationDelay: '.22s' }}>
              <div className="wl-feat-name"><IconWand size={14} /> 真 IDE 工作台</div>
              <div className="wl-feat-desc">Monaco 智能补全、多标签、真终端与完整 Git，写代码不将就。</div>
            </div>
            <div className="wl-feat" style={{ animationDelay: '.3s' }}>
              <div className="wl-feat-name"><IconBranch size={14} /> 帧帧确定性</div>
              <div className="wl-feat-desc">随机与时间被接管，同一工程渲染一万次画面分毫不差。</div>
            </div>
            <div className="wl-feat" style={{ animationDelay: '.38s' }}>
              <div className="wl-feat-name"><IconMcp size={14} /> AI 随时候命</div>
              <div className="wl-feat-desc">内置 MCP 服务，外部 AI 连上就能读工程、写代码、直接出片。</div>
            </div>
          </div>
        </main>
      </div>

      <div className="welcome-foot">
        <span>v0.1.0 · 小方工作室 · MIT</span>
        <button
          className="icon-btn"
          style={{ width: 24, height: 24 }}
          title={theme === 'dark' ? '切换到浅色主题（Ctrl+Shift+L）' : '切换到暗色主题（Ctrl+Shift+L）'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
        </button>
        {busy && <span style={{ color: 'var(--brand)' }}>{busy}</span>}
      </div>

      {newTpl && (
        <NewProjectDialog
          preset={newTpl}
          onClose={() => setNewTpl(null)}
          onOpenProject={onOpenProject}
        />
      )}
    </div>
  );
}
