use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/* 内置技能库：exe 旁 skills/ 目录（skills.json 索引 + md 全文）。
 * 技能是给 AI 与人共同阅读的动效方法论；MCP 的 list_skills / read_skill 直通此目录。 */

#[derive(Serialize, Deserialize, Clone)]
pub struct SkillMeta {
    pub name: String,
    pub file: String,
    pub desc: String,
}

pub fn skills_dir() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_default();
    let cand = [
        exe_dir.join("skills"),
        exe_dir.join("src-tauri").join("skills"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("skills"),
    ];
    for c in cand {
        if c.is_dir() {
            return c;
        }
    }
    PathBuf::from("skills")
}

pub fn load_index() -> Result<Vec<SkillMeta>, String> {
    let idx = skills_dir().join("skills.json");
    let raw = std::fs::read_to_string(idx).map_err(|e| format!("读取 skills.json 失败：{}", e))?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn read_by_file(file: &str) -> Result<String, String> {
    // 文件名白名单校验：只允许索引里存在的文件名，防路径穿越
    let index = load_index()?;
    if !index.iter().any(|s| s.file == file) {
        return Err(format!("技能不存在：{}", file));
    }
    let p = skills_dir().join(file);
    std::fs::read_to_string(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skills_list() -> Result<Vec<SkillMeta>, String> {
    load_index()
}

#[tauri::command]
pub fn skills_read(file: String) -> Result<String, String> {
    read_by_file(&file)
}
