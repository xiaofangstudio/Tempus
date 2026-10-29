import React, { useState } from 'react';
import { loadSettings, saveSettings, type Settings, type Density } from '../core/settings';
import { IconSettings } from '../ui/icons';

/* 偏好设置：字号 / 换行 / 小地图 / 自动保存 / 界面密度。写入即生效并持久化。 */

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
          <div className="set-label">界面</div>
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
