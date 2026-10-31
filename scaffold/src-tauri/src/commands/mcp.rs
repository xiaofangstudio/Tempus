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

fn find_subseq(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

type Request = (String, String, std::collections::HashMap<String, String>, String);

/* 完整读取一个 HTTP 请求：先取头部，再按 Content-Length 补齐 body。
 * 旧实现只读一次 64KB，AI 写的大文件请求会被截断成非法 JSON。 */
fn read_request(stream: &mut std::net::TcpStream) -> Option<Request> {
    let mut buf: Vec<u8> = Vec::with_capacity(8192);
    let mut tmp = [0u8; 16384];
    let header_end;
    loop {
        let n = stream.read(&mut tmp).ok()?;
        if n == 0 { return None; }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(p) = find_subseq(&buf, b"\r\n\r\n") { header_end = p; break; }
        if buf.len() > 8 * 1024 * 1024 { return None; }
    }
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.lines();
    let request_line = lines.next()?.to_string();
    let mut headers = std::collections::HashMap::new();
    for l in lines {
        if let Some((k, v)) = l.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let content_length: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut body: Vec<u8> = buf[header_end + 4..].to_vec();
    while body.len() < content_length {
        let n = stream.read(&mut tmp).ok()?;
        if n == 0 { break; }
        body.extend_from_slice(&tmp[..n]);
    }
    body.truncate(content_length);
    let body_str = String::from_utf8_lossy(&body).to_string();
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next().unwrap_or("/").to_string();
    Some((method, path, headers, body_str))
}

fn write_response(
    stream: &mut std::net::TcpStream,
    status: u16,
    content_type: &str,
    extra: &[(&str, String)],
    payload: &str,
) {
    let reason = match status {
        200 => "OK", 202 => "Accepted", 204 => "No Content",
        400 => "Bad Request", 404 => "Not Found", 405 => "Method Not Allowed", _ => "Error",
    };
    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nCache-Control: no-cache\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, GET, OPTIONS\r\nAccess-Control-Allow-Headers: content-type, accept, authorization, x-api-key, mcp-session-id, mcp-protocol-version\r\nAccess-Control-Expose-Headers: mcp-session-id, mcp-protocol-version\r\n",
        status, reason, content_type
    );
    for (k, v) in extra {
        head.push_str(&format!("{}: {}\r\n", k, v));
    }
    head.push_str(&format!("Content-Length: {}\r\n\r\n", payload.len()));
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(payload.as_bytes());
    let _ = stream.flush();
}

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
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(20)));
                let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(20)));
                let Some((method, path, _headers, body)) = read_request(&mut stream) else { return };

                if method == "OPTIONS" {
                    write_response(&mut stream, 204, "text/plain", &[], "");
                    return;
                }
                if method == "GET" && (path == "/health" || path.starts_with("/health?")) {
                    write_response(&mut stream, 200, "application/json", &[],
                        &json!({ "ok": true, "server": "tempus", "transport": "streamable-http" }).to_string());
                    return;
                }
                /* Streamable HTTP 规范允许服务端不提供 GET SSE 流，但必须回 405；
                 * 客户端据此知道走 POST-only 即可。回 404 会让部分客户端直接判死。 */
                if method == "GET" {
                    write_response(&mut stream, 405, "application/json",
                        &[("Allow", "POST, OPTIONS".to_string())],
                        &json!({ "error": "SSE stream not offered; use POST /mcp", "code": -32000 }).to_string());
                    return;
                }
                if method != "POST" || !(path == "/mcp" || path.starts_with("/mcp?")) {
                    write_response(&mut stream, 404, "application/json", &[],
                        &json!({ "error": "仅支持 POST /mcp 与 GET /health" }).to_string());
                    return;
                }
                let proto = ("MCP-Protocol-Version", "2025-06-18".to_string());
                match handle_body(&app, &body) {
                    Some(v) => write_response(&mut stream, 200, "application/json", &[proto], &v.to_string()),
                    None => write_response(&mut stream, 202, "application/json", &[proto], ""),
                }
            });
        }
    });
    Ok(actual_port)
}

/* 批量 JSON-RPC：数组请求逐个处理，全部是通知时回 202 */
fn handle_body(app: &tauri::AppHandle, body: &str) -> Option<Value> {
    let msg: Value = serde_json::from_str(body).ok()?;
    match msg {
        Value::Array(items) => {
            let mut outs = Vec::new();
            for m in items {
                if let Some(v) = handle_rpc(app, m) { outs.push(v); }
            }
            if outs.is_empty() { None } else { Some(Value::Array(outs)) }
        }
        m => handle_rpc(app, m),
    }
}

fn handle_rpc(app: &tauri::AppHandle, msg: Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(|m| m.as_str())?.to_string();

    // notification（无 id）：初始化完成通知等
    if id.is_none() {
        return None;
    }
    let requested_version = msg
        .pointer("/params/protocolVersion")
        .and_then(|v| v.as_str())
        .map(String::from);
    let result = match method.as_str() {
        "initialize" => {
            // 客户端要什么版本就回什么版本（限已知集合），否则回我们最新的
            let version = match requested_version.as_deref() {
                Some("2025-06-18") | Some("2025-03-26") | Some("2024-11-05") => requested_version.unwrap(),
                _ => "2025-06-18".to_string(),
            };
            json!({
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "tempus", "version": "0.1.0" },
                "instructions": "Tempus 编码动效工作室：人写/机写 React 场景代码，逐帧渲染成 MP4。写场景前先 read_skill『tempus-api.md』；动效方法论用 list_skills / read_skill 获取。write_file 会自动触发应用内预览重编译。"
            })
        }
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

/* ---------- 前端请求桥 ----------
 * create_file（模板在前端）、set_theme（存在 localStorage）只有前端能做。
 * 后端发 mcp-request，等前端 mcp_respond；超时就如实报错，不假装成功。 */
fn ask_frontend(
    app: &tauri::AppHandle,
    state: &tauri::State<AppState>,
    kind: &str,
    args: Value,
    secs: u64,
) -> Result<Value, String> {
    let id = state.mcp_seq.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    state
        .mcp_pending
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, tx);

    let ok = app
        .emit("mcp-request", json!({ "reqId": id, "kind": kind, "args": args }))
        .is_ok();
    if !ok {
        state.mcp_pending.lock().map_err(|e| e.to_string())?.remove(&id);
        return Err("应用窗口不可用，无法执行（请先在 Tempus 里打开工程）".into());
    }

    let got = rx.recv_timeout(std::time::Duration::from_secs(secs));
    state.mcp_pending.lock().map_err(|e| e.to_string())?.remove(&id);
    match got {
        Ok(s) => serde_json::from_str::<Value>(&s)
            .map_err(|e| format!("前端返回的不是 JSON：{}", e)),
        Err(_) => Err(format!("等待应用响应超时（{} 秒）—— 工程窗口可能没打开", secs)),
    }
}

/* 画幅预设（与前端 core/frame.ts 保持一致；ffmpeg 要求偶数边长） */
fn presets() -> Vec<(&'static str, u32, u32)> {
    vec![
        ("16:9", 1920, 1080),
        ("9:16", 1080, 1920),
        ("1:1", 1080, 1080),
        ("4:5", 1080, 1350),
        ("2.39:1", 1920, 804),
        ("4:3", 1440, 1080),
    ]
}

fn even(n: u32) -> u32 {
    if n % 2 == 0 { n } else { n + 1 }
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
                audio_path: None,
                parallel: None,
                range: None,
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

        /* ---- 新建文件：模板在前端，走请求桥 ---- */
        "create_file" => {
            let rel = args.get("path").and_then(|p| p.as_str()).ok_or("缺少 path")?;
            let kind = args.get("kind").and_then(|k| k.as_str()).unwrap_or("visual");
            if kind != "visual" && kind != "audio" {
                return Err("kind 只能是 visual（画面）或 audio（音频）".into());
            }
            let res = ask_frontend(
                app, state, "create_file",
                json!({ "path": rel, "kind": kind }), 12,
            )?;
            Ok(res.to_string())
        }

        /* ---- 画幅：project.json 后端直接写，UI 用事件同步 ---- */
        "set_frame" => {
            let mut w = args.get("width").and_then(|v| v.as_u64()).map(|v| v as u32);
            let mut h = args.get("height").and_then(|v| v.as_u64()).map(|v| v as u32);
            let preset = args.get("preset").and_then(|v| v.as_str());
            let mut frame_id: Option<String> = None;
            if let Some(p) = preset {
                let hit = presets().into_iter().find(|(id, _, _)| *id == p);
                match hit {
                    Some((id, pw, ph)) => { w = Some(pw); h = Some(ph); frame_id = Some(id.to_string()); }
                    None => return Err(format!("未知画幅预设 {}（可用：{}）", p,
                        presets().iter().map(|(i, _, _)| *i).collect::<Vec<_>>().join(", "))),
                }
            }
            let w = w.ok_or("缺少 width/height 或 preset")?;
            let h = h.ok_or("缺少 width/height 或 preset")?;
            if !(16..=7680).contains(&w) || !(16..=7680).contains(&h) {
                return Err("宽高需在 16 ~ 7680 之间".into());
            }
            let w = even(w);
            let h = even(h);

            let p = root.join("project.json");
            let raw = std::fs::read_to_string(&p).map_err(|e| format!("读取 project.json 失败：{}", e))?;
            let mut meta: Value = serde_json::from_str(&raw).map_err(|e| format!("project.json 不是合法 JSON：{}", e))?;
            let fps_out = {
                let obj = meta.as_object_mut().ok_or("project.json 不是对象")?;
                obj.insert("width".into(), json!(w));
                obj.insert("height".into(), json!(h));
                obj.insert("frame".into(), json!(frame_id.clone().unwrap_or_else(|| format!("{}x{}", w, h))));
                if let Some(fps) = args.get("fps").and_then(|v| v.as_u64()) {
                    if (1..=120).contains(&fps) { obj.insert("fps".into(), json!(fps as u32)); }
                }
                obj.get("fps").cloned().unwrap_or(json!(30))
            };
            std::fs::write(&p, serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?)
                .map_err(|e| format!("写入 project.json 失败：{}", e))?;
            /* 通知界面刷新（meta 变了，新建文件的模板尺寸也跟着变） */
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.emit("mcp-frame-changed", json!({ "width": w, "height": h }));
            }
            Ok(json!({
                "ok": true, "width": w, "height": h, "fps": fps_out,
                "frame": frame_id.clone().unwrap_or_else(|| format!("{}x{}", w, h)),
                "note": "已写入 project.json。已有合成里写死的 width/height 不会被改，新建文件与导出会用新画幅。"
            }).to_string())
        }

        /* ---- 主题：存在前端 localStorage，走请求桥 ---- */
        "set_theme" => {
            let t = args.get("theme").and_then(|v| v.as_str()).unwrap_or("toggle");
            if !["light", "dark", "toggle"].contains(&t) {
                return Err("theme 只能是 light / dark / toggle".into());
            }
            let res = ask_frontend(app, state, "set_theme", json!({ "theme": t }), 8)?;
            Ok(res.to_string())
        }

        /* ---- 多段合并渲染：按给定顺序逐段渲染再拼接（等价界面里的「序列器」） ---- */
        "sequencer_render" => {
            let ids = args.get("comp_ids").and_then(|v| v.as_array()).ok_or("缺少 comp_ids（数组，顺序即播放顺序）")?;
            let ids: Vec<String> = ids.iter().filter_map(|v| v.as_str().map(String::from)).collect();
            if ids.is_empty() {
                return Err("comp_ids 不能为空".into());
            }
            let crf = args.get("crf").and_then(|c| c.as_u64()).unwrap_or(20) as u32;
            let parallel = args.get("parallel").and_then(|c| c.as_u64()).map(|v| v as u32);
            let audio = args.get("audio_path").and_then(|a| a.as_str()).map(String::from)
                .filter(|s| !s.trim().is_empty());

            let state_docs = state.docs.lock().map_err(|e| e.to_string())?;
            let comps = state.comps.lock().map_err(|e| e.to_string())?;
            let picked: Vec<(String, crate::commands::render::Comp, String)> = ids
                .iter()
                .map(|id| {
                    let c = comps.iter().find(|c| &c.id == id)
                        .ok_or_else(|| format!("合成 {} 不存在或尚未编译", id))?;
                    let d = state_docs.get(id)
                        .ok_or_else(|| format!("合成 {} 尚未编译（请在应用里打开工程并编译一次）", id))?;
                    Ok((id.clone(), crate::commands::render::Comp {
                        id: c.id.clone(), width: c.width, height: c.height,
                        fps: c.fps, duration_in_frames: c.durationInFrames,
                    }, d.clone()))
                })
                .collect::<Result<Vec<_>, String>>()?;
            drop(state_docs);
            drop(comps);

            let out_dir = PathBuf::from(&root).join("out");
            std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let out_path = args.get("out_path").and_then(|o| o.as_str()).map(String::from)
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| out_dir.join(format!("sequence-{}.mp4", stamp)).to_string_lossy().to_string());

            let mut segs: Vec<String> = Vec::new();
            let mut total_frames = 0u32;
            for (i, (id, comp, doc)) in picked.iter().enumerate() {
                let seg = out_dir.join(format!(".seq-{}.mp4", i)).to_string_lossy().to_string();
                let req = crate::commands::render::RenderReq {
                    html: doc.clone(),
                    comp: comp.clone(),
                    out_path: seg.clone(),
                    crf,
                    project_dir: root.to_string_lossy().to_string(),
                    audio_path: None,       // 音频统一在最后 concat 时混一次
                    parallel,
                    range: None,
                };
                crate::commands::render::render_export_sync(app.clone(), req)
                    .map_err(|e| format!("第 {} 段（{}）渲染失败：{}", i + 1, id, e))?;
                total_frames += comp.duration_in_frames;
                segs.push(seg);
            }

            crate::commands::render::video_concat(segs.clone(), out_path.clone(), audio.clone())
                .map_err(|e| format!("拼接失败：{}", e))?;

            Ok(json!({
                "ok": true,
                "out_path": out_path,
                "segments": ids,
                "segment_files": segs,
                "total_frames": total_frames,
                "audio": audio
            }).to_string())
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
  { "name": "read_skill", "description": "读取指定技能全文（file 用 list_skills 返回的 file 字段）", "inputSchema": { "type": "object", "properties": { "file": { "type": "string" } }, "required": ["file"] } },
  { "name": "create_file", "description": "按内置模板新建文件（与应用里「新建文件」同一套模板，会自动带上工程画幅与帧率）。kind: visual=画面文件（registerComposition 骨架）/ audio=音频文件（Audio + 淡入淡出）；path 为工程内相对路径，如 src/scenes/Title.tsx", "inputSchema": { "type": "object", "properties": { "path": { "type": "string" }, "kind": { "type": "string", "enum": ["visual", "audio"] } }, "required": ["path"] } },
  { "name": "set_frame", "description": "设置工程画幅（写入 project.json）。可以传 preset（16:9 / 9:16 / 1:1 / 4:5 / 2.39:1 / 4:3），也可以传 width+height（自动取偶数），fps 可选。已有合成里写死的 width/height 不会被改。", "inputSchema": { "type": "object", "properties": { "preset": { "type": "string" }, "width": { "type": "number" }, "height": { "type": "number" }, "fps": { "type": "number" } } } },
  { "name": "set_theme", "description": "切换界面主题（浅色 / 暗色）。theme: light / dark / toggle（默认 toggle）", "inputSchema": { "type": "object", "properties": { "theme": { "type": "string", "enum": ["light", "dark", "toggle"] } } } },
  { "name": "sequencer_render", "description": "多段合并渲染（等价界面里的「序列器」）：按 comp_ids 给定顺序逐段渲染再拼接成一条成片。out_path 可选（默认 工程/out/sequence-<时间戳>.mp4）；crf 默认 20；parallel 为并行路数（1~8）；audio_path 可选，整条铺满。阻塞直到完成。", "inputSchema": { "type": "object", "properties": { "comp_ids": { "type": "array", "items": { "type": "string" } }, "out_path": { "type": "string" }, "crf": { "type": "number" }, "parallel": { "type": "number" }, "audio_path": { "type": "string" } }, "required": ["comp_ids"] } }
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
