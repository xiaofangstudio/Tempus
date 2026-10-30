use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    #[serde(rename = "relPath")]
    pub rel_path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub size: u64,
}

fn list_one(dir: &str) -> Result<Vec<FileEntry>, String> {
    let base = Path::new(dir);
    let mut out = Vec::new();
    let rd = std::fs::read_dir(base).map_err(|e| e.to_string())?;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name == "." || name == ".." { continue; }
        let meta = e.metadata().map_err(|e| e.to_string())?;
        out.push(FileEntry {
            name: name.clone(),
            rel_path: name,
            is_dir: meta.is_dir(),
            size: if meta.is_file() { meta.len() } else { 0 },
        });
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

#[tauri::command]
pub fn fs_list(dir: String) -> Result<Vec<FileEntry>, String> {
    list_one(&dir)
}

#[tauri::command]
pub fn fs_read(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取失败 {}: {}", path, e))
}

#[tauri::command]
pub fn fs_write(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, contents).map_err(|e| format!("写入失败 {}: {}", path, e))
}

/* 二进制读取（base64）：音频/图片等素材给预览 iframe 用 blob URL。
 * 只做素材用，超大文件由调用方自己拦。 */
#[tauri::command]
pub fn fs_read_bytes(path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = std::fs::read(&path).map_err(|e| format!("读取失败 {}: {}", path, e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn fs_write_bytes(path: String, base64_data: String) -> Result<(), String> {
    use base64::Engine;
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("base64 解码失败：{}", e))?;
    std::fs::write(&path, bytes).map_err(|e| format!("写入失败 {}: {}", path, e))
}

#[tauri::command]
pub fn fs_mkdir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_delete(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    }
}
