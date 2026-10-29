use serde_json::{json, Value};
use std::io::prelude::*;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
use tauri::Manager;

use crate::AppState;

/* 内置 MCP 服务（Streamable HTTP）：
 * AI 客户端 POST http://127.0.0.1:<port>/mcp 即可读写工程、列出合成、发起渲染。
 * 方法仅支持本机回环，无任何外网行为。 */

static MCP_STOP: AtomicBool = AtomicBool::new(false);

pub fn start_server(app: tauri::AppHandle, port: u16) -> Result<u16, String> {
    MCP_STOP.store(false, Ordering::SeqCst);
    let listener = TcpListener::bind(format!("127.0.0.1:{}", port))
        .map_err(|e| format!("端口 {} 占用：{}", port, e))?;
    let actual_port = listener.local_addr().map_err(|e| e.to_string())?.port();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            if MCP_STOP.load(Ordering::SeqCst) { break; }
            let mut stream = match stream { Ok(s) => s, Err(_) => continue };
            let app = app.clone();
            std::thread::spawn(move || {
                let mut buf = [0u8; 65536];
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(10)));
                let n = match stream.read(&mut buf) { Ok(n) => n, Err(_) => return };
                let req = String::from_utf8_lossy(&buf[..n]);
                let method = req.lines().next().unwrap_or("");
                let is_options = method.starts_with("OPTIONS");
                let body = req.split("\r\n\r\n").nth(1).unwrap_or("").to_string();

                let (status, payload) = if is_options {
                    (204, String::new())
                } else if method.starts_with("GET") && req.contains("GET /health") {
                    (200, json!({ "ok": true, "server": "tempus" }).to_string())
                } else if method.starts_with("POST") {
                    match handle_rpc(&app, &body) {
                        Some(v) => (200, v.to_string()),
                        None => (202, String::new()), // notification
                    }
                } else {
                    (404, json!({ "error": "仅支持 POST /mcp 与 GET /health" }).to_string())
                };

                let mut resp = format!(
                    "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, GET, OPTIONS\r\nAccess-Control-Allow-Headers: content-type, mcp-session-id\r\n",
                    status,
                    match status { 200 => "OK", 202 => "Accepted", 204 => "No Content", _ => "Error" }
                );
                if status == 204 {
                    resp.push_str("Content-Length: 0\r\n\r\n");
                } else {
                    resp.push_str(&format!("Content-Length: {}\r\n\r\n{}", payload.len(), payload));
                }
                let _ = stream.write_all(resp.as_bytes());
                let _ = stream.flush();
            });
        }
    });
    Ok(actual_port)
}

fn handle_rpc(app: &tauri::AppHandle, body: &str) -> Option<Value> {
    let msg: Value = serde_json::from_str(body).ok()?;
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(|m| m.as_str())?.to_string();

    // notification（无 id）：初始化完成通知等
    if id.is_none() {
        return None;
    }
    let result = match method.as_str() {
        "initialize" => json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "tempus", "version": "0.1.0" }
        }),
        "tools/list" => json!({ "tools": TOOLS }),
        "tools/call" => {
            let state = app.state::<AppState>();
            match tool_call(app, &state, &msg) {
                Ok(v) => json!({ "content": [ { "type": "text", "text": v } ] }),
                Err(e) => json!({ "content": [ { "type": "text", "text": e } ], "isError": true }),
            }
        }
        "ping" => json!({}),
        other => return Some(json!({
            "jsonrpc": "2.0", "id": id,
            "error": { "code": -32601, "message": format!("未知方法：{}", other) }
        })),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn project_dir(state: &tauri::State<AppState>) -> PathBuf {
    PathBuf::from(state.project_dir.lock().map(|g| g.clone()).unwrap_or_default())
}

fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = root.join(rel);
    if !p.starts_with(root) {
        return Err("路径越出工程目录".into());
    }
    Ok(p)
}

fn tool_call(app: &tauri::AppHandle, state: &tauri::State<AppState>, msg: &Value) -> Result<String, String> {
    let name = msg.pointer("/params/name").and_then(|n| n.as_str()).ok_or("缺少 tools/call name")?;
    let args = msg.pointer("/params/arguments").cloned().unwrap_or(json!({}));
    let root = project_dir(state);
    match name {
        "project_info" => {
            let p = root.join("project.json");
            let raw = std::fs::read_to_string(&p).map_err(|e| format!("读取 project.json 失败：{}", e))?;
            let comps = state.comps.lock().map_err(|e| e.to_string())?;
            Ok(json!({
                "project": serde_json::from_str::<Value>(&raw).unwrap_or(json!({})),
                "path": root.to_string_lossy(),
                "compositions": &*comps,
            }).to_string())
        }
        "list_files" => {
            let out = walk_tree(&root, &root, 0, 4)?;
            Ok(json!({ "files": out }).to_string())
        }
        "read_file" => {
            let rel = args.get("path").and_then(|p| p.as_str()).ok_or("缺少 path")?;
            let p = safe_join(&root, rel)?;
            let text = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
            Ok(text)
        }
        "write_file" => {
            let rel = args.get("path").and_then(|p| p.as_str()).ok_or("缺少 path")?;
            let content = args.get("content").and_then(|c| c.as_str()).ok_or("缺少 content")?;
            let p = safe_join(&root, rel)?;
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&p, content).map_err(|e| e.to_string())?;
            // 触发前端重新编译：向窗口发事件
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.emit("mcp-file-changed", rel);
            }
            Ok(json!({ "ok": true, "written": rel }).to_string())
        }
        "get_compositions" => {
            let comps = state.comps.lock().map_err(|e| e.to_string())?;
            let marks = state.marks.lock().map_err(|e| e.to_string())?;
            Ok(json!({ "compositions": &*comps, "marks": &*marks }).to_string())
        }
        "render_video" => {
            let comp_id = args.get("comp_id").and_then(|c| c.as_str()).ok_or("缺少 comp_id")?;
            let out_path = args.get("out_path").and_then(|o| o.as_str()).map(String::from);
            let crf = args.get("crf").and_then(|c| c.as_u64()).unwrap_or(20) as u32;
            let doc = {
                let docs = state.docs.lock().map_err(|e| e.to_string())?;
                docs.get(comp_id).cloned().ok_or(format!("合成 {} 不存在或尚未编译（请在应用里先打开工程并编译一次）", comp_id))?
            };
            let comps = state.comps.lock().map_err(|e| e.to_string())?;
            let comp = comps.iter().find(|c| c.id == comp_id).cloned().ok_or("合成不存在")?;
            drop(comps);
            let out = out_path.unwrap_or_else(|| root.join("out").join(format!("{}.mp4", comp_id)).to_string_lossy().to_string());
            let req = crate::commands::render::RenderReq {
                html: doc,
                comp: crate::commands::render::Comp {
                    id: comp.id.clone(),
                    width: comp.width,
                    height: comp.height,
                    fps: comp.fps,
                    duration_in_frames: comp.durationInFrames,
                },
                out_path: out,
                crf,
                project_dir: root.to_string_lossy().to_string(),
            };
            // 复用渲染管线（阻塞直到完成）；渲染进度同样发 render-progress 事件
            let app2 = app.clone();
            let res = crate::commands::render::render_export_sync(app2, req);
            res
        }
        "list_skills" => {
            let skills = crate::commands::skills::load_index().unwrap_or_default();
            Ok(json!({ "skills": skills }).to_string())
        }
        "read_skill" => {
            let file = args.get("file").and_then(|f| f.as_str()).ok_or("缺少 file")?;
            let text = crate::commands::skills::read_by_file(file)?;
            Ok(text)
        }
        other => Err(format!("未知工具：{}", other)),
    }
}

fn walk_tree(root: &Path, dir: &Path, depth: usize, max: usize) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    if depth > max { return Ok(out); }
    for e in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "out" || name == "node_modules" || name == "target" { continue; }
        let p = e.path();
        let rel = p.strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
        if p.is_dir() {
            out.push(json!({ "path": rel, "type": "dir" }));
            out.extend(walk_tree(root, &p, depth + 1, max)?);
        } else {
            out.push(json!({ "path": rel, "type": "file", "size": e.metadata().map(|m| m.len()).unwrap_or(0) }));
        }
    }
    Ok(out)
}

const TOOLS: &str = r#"[
  { "name": "project_info", "description": "获取 Tempus 工程信息：名称、入口、帧率、画布尺寸与已注册合成", "inputSchema": { "type": "object", "properties": {} } },
  { "name": "list_files", "description": "列出工程文件树（相对路径）", "inputSchema": { "type": "object", "properties": {} } },
  { "name": "read_file", "description": "读取工程内文件文本", "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"] } },
  { "name": "write_file", "description": "写入工程内文件（会触发应用自动重新编译预览）", "inputSchema": { "type": "object", "properties": { "path": { "type": "string" }, "content": { "type": "string" } }, "required": ["path", "content"] } },
  { "name": "get_compositions", "description": "列出全部合成（尺寸/帧率/时长）与标记", "inputSchema": { "type": "object", "properties": {} } },
  { "name": "render_video", "description": "渲染导出 MP4（阻塞直到完成）。comp_id 必填；out_path 可选（默认 工程/out/<id>.mp4）；crf 默认 20", "inputSchema": { "type": "object", "properties": { "comp_id": { "type": "string" }, "out_path": { "type": "string" }, "crf": { "type": "number" } }, "required": ["comp_id"] } },
  { "name": "list_skills", "description": "列出内置技能（动效方法论库）", "inputSchema": { "type": "object", "properties": {} } },
  { "name": "read_skill", "description": "读取指定技能全文（file 用 list_skills 返回的 file 字段）", "inputSchema": { "type": "object", "properties": { "file": { "type": "string" } }, "required": ["file"] } }
]"#;

#[tauri::command]
pub fn mcp_start(app: tauri::AppHandle, state: tauri::State<'_, AppState>, port: u32, project_dir: String) -> Result<u16, String> {
    *state.project_dir.lock().map_err(|e| e.to_string())? = project_dir.clone();
    let p = start_server(app, port as u16)?;
    *state.mcp_port.lock().map_err(|e| e.to_string())? = p;
    Ok(p)
}

#[tauri::command]
pub fn mcp_stop(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let port = *state.mcp_port.lock().map_err(|e| e.to_string())?;
    if port != 0 {
        // 唤醒 accept 使监听线程退出并释放端口
        MCP_STOP.store(true, Ordering::SeqCst);
        let _ = std::net::TcpStream::connect(format!("127.0.0.1:{}", port));
        *state.mcp_port.lock().map_err(|e| e.to_string())? = 0;
    }
    Ok(())
}

#[tauri::command]
pub fn mcp_status(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let port = *state.mcp_port.lock().map_err(|e| e.to_string())?;
    Ok(json!({ "running": port != 0, "port": port }))
}
