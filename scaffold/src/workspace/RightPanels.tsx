import React, { useEffect, useState } from 'react';
import { api } from '../core/tauri';
import type { CompInfo } from '../core/types';
import { IconMcp, IconBook, IconInfo } from '../ui/icons';

/* 右侧面板：工程信息 / MCP 接入 / 技能库（memo：播放时不随帧重渲染） */

type Props = {
  comps: CompInfo[];
  activeComp: string | null;
  onSelectComp: (id: string) => void;
  projectDir: string;
};

type SkillMeta = { name: string; file: string; desc: string };

function RightPanelsImpl({ comps, activeComp, onSelectComp, projectDir }: Props) {
  const [tab, setTab] = useState<'proj' | 'mcp' | 'skills'>('proj');
  const [mcp, setMcp] = useState<{ running: boolean; port: number }>({ running: false, port: 0 });
  const [port, setPort] = useState(8964);
  const [mcpMsg, setMcpMsg] = useState('');
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [skillText, setSkillText] = useState<string | null>(null);
  const [skillName, setSkillName] = useState('');

  useEffect(() => {
    api.skillsList().then(setSkills).catch(() => setSkills([]));
    api.mcpStatus().then(setMcp).catch(() => {});
  }, []);

  const toggleMcp = async (): Promise<void> => {
    try {
      if (mcp.running) {
        await api.mcpStop();
        setMcp({ running: false, port: 0 });
        setMcpMsg('已停止');
      } else {
        const p = await api.mcpStart(port, projectDir);
        setMcp({ running: true, port: p });
        setMcpMsg(`已在 127.0.0.1:${p} 提供服务`);
      }
    } catch (e) { setMcpMsg(String(e)); }
  };

  const openSkill = async (s: SkillMeta): Promise<void> => {
    const text = await api.skillsRead(s.file);
    setSkillName(s.name);
    setSkillText(text);
  };

  const configJson = JSON.stringify({
    mcpServers: {
      tempus: { url: `http://127.0.0.1:${mcp.port || port}/mcp` }
    }
  }, null, 2);

  return (
    <div className="side-panels">
      <div className="sp-tabs">
        <div className={`sp-tab ${tab === 'proj' ? 'active' : ''}`} onClick={() => setTab('proj')}><IconInfo size={12} /> 工程</div>
        <div className={`sp-tab ${tab === 'mcp' ? 'active' : ''}`} onClick={() => setTab('mcp')}><IconMcp size={12} /> MCP</div>
        <div className={`sp-tab ${tab === 'skills' ? 'active' : ''}`} onClick={() => setTab('skills')}><IconBook size={12} /> 技能库</div>
      </div>
      <div className="sp-body">
        {tab === 'proj' && (
          <>
            <div className="section-title">合成（registerComposition 注册）</div>
            {comps.length === 0 && <div style={{ color: 'var(--txt3)' }}>编译后显示</div>}
            {comps.map((c) => (
              <div key={c.id}
                className={`comp-item ${activeComp === c.id ? 'active' : ''}`}
                onClick={() => onSelectComp(c.id)}>
                <div>
                  <div className="comp-name">{c.id}</div>
                  <div className="comp-dim">{c.width}×{c.height} · {c.fps}fps · {c.durationInFrames}帧</div>
                </div>
              </div>
            ))}
            <div className="section-title" style={{ marginTop: 14 }}>工程路径</div>
            <div className="mono" style={{ color: 'var(--txt2)', wordBreak: 'break-all', fontSize: 11 }}>{projectDir}</div>
          </>
        )}

        {tab === 'mcp' && (
          <>
            <div style={{ marginBottom: 10 }}>
              <button className={`btn ${mcp.running ? '' : 'primary'}`} style={{ width: '100%' }} onClick={toggleMcp}>
                {mcp.running ? '停止 MCP 服务' : '启动 MCP 服务'}
              </button>
            </div>
            <div className="form-row">
              <label>端口</label>
              <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 8964)} disabled={mcp.running} />
            </div>
            {mcpMsg && <div style={{ color: mcp.running ? 'var(--ok)' : 'var(--txt2)', marginBottom: 10 }}>{mcpMsg}</div>}
            <div className="section-title">接入方法（给 AI 用）</div>
            <p style={{ color: 'var(--txt2)', fontSize: 12 }}>
              在支持 MCP 的 AI 客户端（如 Trae / Claude）里加入以下配置，AI 即可直接读写本工程、列出合成、发起渲染：
            </p>
            <pre className="mono" style={{ background: 'var(--field)', padding: 10, borderRadius: 8, fontSize: 11, overflowX: 'auto', userSelect: 'text', border: '1px solid var(--line)' }}>{configJson}</pre>
            <div className="section-title" style={{ marginTop: 10 }}>提供 8 个工具</div>
            <div style={{ color: 'var(--txt2)', fontSize: 12, lineHeight: 1.9 }}>
              project_info · list_files · read_file · write_file · get_compositions · render_video · list_skills · read_skill
            </div>
          </>
        )}

        {tab === 'skills' && (
          <>
            {skillText ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <b>{skillName}</b>
                  <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setSkillText(null)}>返回</button>
                </div>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11.5, color: 'var(--txt2)', userSelect: 'text', fontFamily: 'inherit' }}>{skillText}</pre>
              </>
            ) : (
              <>
                <div className="section-title">内置技能（AI 与人都能读）</div>
                {skills.map((s) => (
                  <div key={s.file} className="skill-item" onClick={() => openSkill(s)}>
                    <div className="skill-name">{s.name}</div>
                    <div className="skill-desc">{s.desc}</div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export const RightPanels = React.memo(RightPanelsImpl);
