import React, { useEffect, useState } from 'react';
import { loadSettings, saveSettings, type Settings, type Density, type Theme } from '../core/settings';
import { api } from '../core/tauri';
import { IconSettings } from '../ui/icons';

/* 偏好设置：编辑器 / 渲染设备与并行 / 界面密度。写入即生效并持久化。 */

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`switch ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span className="switch-knob" />
    </button>
  );
}

const SHORTCUTS: [string, string][] = [
  ['命令面板', 'Ctrl+Shift+P'],
  ['全局搜索', 'Ctrl+Shift+F'],
  ['保存全部', 'Ctrl+S'],
  ['编译刷新', 'Ctrl+R'],
  ['导出视频', 'Ctrl+E'],
  ['终端', 'Ctrl+`'],
  ['播放 / 暂停', '空格'],
  ['逐帧', '← / →']
];

export function SettingsPanel() {
  const [s, setS] = useState<Settings>(() => loadSettings());
  const [dev, setDev] = useState<{
    cpu: string; cores: number; memGB: number; gpu: string; os: string; suggestParallel: number;
  } | null>(null);

  /* 设备信息只查询一次（Rust 侧有缓存） */
  useEffect(() => {
    let alive = true;
    api.sysInfo()
      .then((d) => { if (alive) setDev(d); })
      .catch(() => { /* 拿不到就显示 — */ });
    return () => { alive = false; };
  }, []);

  const patch = (p: Partial<Settings>): void => {
    const next = saveSettings(p);
    setS(next);
  };

  return (
    <div className="explorer settings-panel">
      <div className="explorer-head">
        <span>设置</span>
        <span style={{ flex: 1 }} />
        <IconSettings size={13} />
      </div>

      <div className="settings-body">
        <div className="set-group">
          <div className="set-label">编辑器</div>

          <div className="set-row">
            <span className="set-name">字号</span>
            <div className="set-inline">
              <input
                type="range" min={11} max={20} step={0.5}
                value={s.fontSize}
                onChange={(e) => patch({ fontSize: Number(e.target.value) })}
              />
              <span className="set-val mono">{s.fontSize}px</span>
            </div>
          </div>

          <div className="set-row">
            <span className="set-name">自动换行</span>
            <Switch on={s.wordWrap} onChange={(v) => patch({ wordWrap: v })} />
          </div>

          <div className="set-row">
            <span className="set-name">代码小地图</span>
            <Switch on={s.minimap} onChange={(v) => patch({ minimap: v })} />
          </div>

          <div className="set-row">
            <span className="set-name">自动保存</span>
            <Switch on={s.autoSave} onChange={(v) => patch({ autoSave: v })} />
          </div>
        </div>

        <div className="set-group">
          <div className="set-label">渲染（设备）</div>
          <div className="set-device">
            <div className="set-dev-row"><span>处理器</span><b title={dev?.cpu}>{dev?.cpu ?? '读取中……'}</b></div>
            <div className="set-dev-row"><span>核心 / 线程</span><b>{dev ? `${dev.cores} 线程` : '—'}</b></div>
            <div className="set-dev-row"><span>内存</span><b>{dev && dev.memGB > 0 ? `${dev.memGB} GB` : '—'}</b></div>
            <div className="set-dev-row"><span>显卡</span><b title={dev?.gpu}>{dev?.gpu ?? '—'}</b></div>
            <div className="set-dev-row"><span>系统</span><b>{dev?.os ?? '—'}</b></div>
          </div>

          <div className="set-row">
            <span className="set-name">默认并行渲染</span>
            <Switch on={s.parallelRender} onChange={(v) => patch({ parallelRender: v })} />
          </div>

          <div className="set-row">
            <span className="set-name">并行路数</span>
            <div className="set-inline">
              <input
                type="range" min={2} max={8} step={1}
                value={s.parallelCount}
                onChange={(e) => patch({ parallelCount: Number(e.target.value) })}
              />
              <span className="set-val mono">{s.parallelCount}</span>
            </div>
          </div>
          {dev && (
            <div className="set-hint">
              按本机 {dev.cores} 线程估算，建议 {dev.suggestParallel} 路；路数太多反而抢 CPU。
            </div>
          )}
        </div>

        <div className="set-group">
          <div className="set-label">界面</div>
          <div className="set-row">
            <span className="set-name">主题</span>
            <div className="seg">
              {(['light', 'dark'] as Theme[]).map((t) => (
                <button
                  key={t}
                  className={`seg-btn ${s.theme === t ? 'active' : ''}`}
                  onClick={() => patch({ theme: t })}
                >
                  {t === 'light' ? '浅色' : '暗色'}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <span className="set-name">密度</span>
            <div className="seg">
              {(['comfortable', 'compact'] as Density[]).map((d) => (
                <button
                  key={d}
                  className={`seg-btn ${s.density === d ? 'active' : ''}`}
                  onClick={() => patch({ density: d })}
                >
                  {d === 'comfortable' ? '舒适' : '紧凑'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="set-group">
          <div className="set-label">快捷键</div>
          <div className="set-keys">
            {SHORTCUTS.map(([name, key]) => (
              <div className="set-key" key={name}>
                <span>{name}</span>
                <b>{key}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
