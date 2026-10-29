use base64::Engine;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tungstenite::{WebSocket, stream::MaybeTlsStream};

use crate::commands::project::{find_browser, find_ffmpeg};
use crate::AppState;

#[derive(Deserialize)]
pub struct RenderReq {
    pub html: String,
    pub comp: Comp,
    #[serde(rename = "outPath")]
    pub out_path: String,
    pub crf: u32,
    #[serde(rename = "projectDir")]
    pub project_dir: String,
}

#[derive(Deserialize, Clone, Serialize)]
pub struct Comp {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    #[serde(rename = "durationInFrames")]
    pub duration_in_frames: u32,
}

#[derive(Clone, Serialize)]
pub struct RenderProgress {
    pub frame: u32,
    pub total: u32,
    pub stage: String,
    #[serde(rename = "outPath", skip_serializing_if = "Option::is_none")]
    pub out_path: Option<String>,
    pub done: bool,
    pub error: Option<String>,
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .unwrap_or(9333)
}

struct Cdp {
    ws: WebSocket<MaybeTlsStream<std::net::TcpStream>>,
    next_id: u64,
}

impl Cdp {
    fn connect(url: &str) -> Result<Self, String> {
        let (ws, _resp) = tungstenite::connect(url)
            .map_err(|e| format!("DevTools WebSocket 连接失败：{}", e))?;
        Ok(Self { ws, next_id: 1 })
    }

    fn send(&mut self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let msg = serde_json::json!({ "id": id, "method": method, "params": params });
        self.ws
            .send(tungstenite::Message::Text(msg.to_string()))
            .map_err(|e| e.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if Instant::now() > deadline {
                return Err(format!("CDP 响应超时：{}", method));
            }
            let m = self.ws.read().map_err(|e| e.to_string())?;
            if let tungstenite::Message::Text(t) = m {
                let v: serde_json::Value = serde_json::from_str(&t).map_err(|e| e.to_string())?;
                if v.get("id").and_then(|x| x.as_u64()) == Some(id) {
                    if let Some(err) = v.get("error") {
                        return Err(format!("CDP 错误：{}", err));
                    }
                    return Ok(v.get("result").cloned().unwrap_or(serde_json::Value::Null));
                }
                // 事件消息（loadEventFired 等）直接丢弃
            }
        }
    }

    fn eval(&mut self, expr: &str) -> Result<serde_json::Value, String> {
        let r = self.send(
            "Runtime.evaluate",
            serde_json::json!({ "expression": expr, "returnByValue": true, "awaitPromise": false }),
        )?;
        Ok(r.get("result").and_then(|r| r.get("value")).cloned().unwrap_or(serde_json::Value::Null))
    }

    fn screenshot_png(&mut self) -> Result<Vec<u8>, String> {
        let r = self.send(
            "Page.captureScreenshot",
            serde_json::json!({ "format": "png", "optimizeForSpeed": true }),
        )?;
        let b64 = r
            .get("data")
            .and_then(|d| d.as_str())
            .ok_or("截图返回缺少 data")?;
        base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("base64 解码失败：{}", e))
    }
}

fn kill_tree(child: &mut Child) {
    let pid = child.id().to_string();
    let _ = Command::new("taskkill")
        .args(["/PID", &pid, "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
    let _ = child.wait();
}

fn emit(app: &AppHandle, p: RenderProgress) {
    let _ = app.emit("render-progress", p);
}

#[tauri::command]
pub async fn render_export(app: AppHandle, state: tauri::State<'_, AppState>, req: RenderReq) -> Result<String, String> {
    let cancel = Arc::clone(&state.render_cancel);
    tauri::async_runtime::spawn_blocking(move || render_blocking(app, &cancel, req))
        .await
        .map_err(|e| e.to_string())?
}

/* MCP 等同步调用方使用的入口 */
pub fn render_export_sync(app: AppHandle, req: RenderReq) -> Result<String, String> {
    let state = app.state::<AppState>();
    let cancel = Arc::clone(&state.render_cancel);
    render_blocking(app, &cancel, req)
}

fn render_blocking(app: AppHandle, cancel: &AtomicBool, req: RenderReq) -> Result<String, String> {
    cancel.store(false, Ordering::SeqCst);
    let total = req.comp.duration_in_frames.max(1);
    let out_path = if req.out_path.trim().is_empty() {
        PathBuf::from(&req.project_dir).join("out").join(format!("{}.mp4", req.comp.id))
    } else {
        PathBuf::from(&req.out_path)
    };
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let (browser, _) = find_browser().ok_or_else(|| {
        "未找到 Edge 或 Chrome（Windows 10/11 自带 Edge，请勿卸载）。导出依赖它逐帧截图。".to_string()
    })?;
    let ffmpeg = find_ffmpeg().ok_or_else(|| "未找到 ffmpeg.exe（应随应用一同安装）".to_string())?;

    // 会话临时目录
    let session = std::env::temp_dir().join(format!("tempus-render-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&session);
    std::fs::create_dir_all(&session).map_err(|e| e.to_string())?;
    let page = session.join("page.html");
    std::fs::write(&page, &req.html).map_err(|e| e.to_string())?;
    let profile = session.join("profile");
    std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;

    let port = free_port();
    let mut browser_child = Command::new(&browser)
        .args([
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--disable-extensions",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            "--window-size=0,0",
            &format!("--remote-debugging-port={}", port),
            &format!("--user-data-dir={}", profile.to_string_lossy()),
            "about:blank",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动浏览器失败：{}", e))?;

    let cleanup = |child: &mut Child| {
        kill_tree(child);
        let _ = std::fs::remove_dir_all(&session);
    };

    let result = (|| -> Result<String, String> {
        // 等 DevTools 就绪
        let http_base = format!("http://127.0.0.1:{}", port);
        let mut ws_url = None;
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            if cancel.load(Ordering::SeqCst) { return Err("已取消".into()); }
            if let Ok(body) = mini_get(&format!("{}/json/list", http_base)) {
                if let Ok(list) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(pages) = list.as_array() {
                        for t in pages {
                            if t.get("type").and_then(|x| x.as_str()) == Some("page") {
                                if let Some(u) = t.get("webSocketDebuggerUrl").and_then(|x| x.as_str()) {
                                    ws_url = Some(u.to_string());
                                    break;
                                }
                            }
                        }
                    }
                }
                if ws_url.is_some() { break; }
            }
            std::thread::sleep(Duration::from_millis(150));
        }
        let ws_url = ws_url.ok_or_else(|| "浏览器 DevTools 未就绪（headless 模式可能不被支持，请更新 Edge）".to_string())?;

        let mut cdp = Cdp::connect(&ws_url)?;
        let _ = cdp.send("Page.enable", serde_json::json!({}));
        let page_url = format!("file:///{}", page.to_string_lossy().replace('\\', "/"));
        let _ = cdp.send("Page.navigate", serde_json::json!({ "url": page_url }));

        // 等待渲染层就绪
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if Instant::now() > deadline { return Err("渲染页加载超时".into()); }
            let v = cdp.eval("window.__ready === true")?;
            if v == serde_json::json!(true) { break; }
            std::thread::sleep(Duration::from_millis(60));
        }
        // 视口 = 合成尺寸
        let _ = cdp.send(
            "Emulation.setDeviceMetricsOverride",
            serde_json::json!({
                "width": req.comp.width, "height": req.comp.height,
                "deviceScaleFactor": 1, "mobile": false
            }),
        );

        // ffmpeg 管道
        let mut ff = Command::new(&ffmpeg)
            .args([
                "-y",
                "-f", "image2pipe",
                "-framerate", &req.comp.fps.to_string(),
                "-i", "-",
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", &req.crf.to_string(),
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
            ])
            .arg(&out_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("启动 ffmpeg 失败：{}", e))?;
        let mut ff_in = ff.stdin.take().ok_or("无法写入 ffmpeg 管道")?;

        emit(&app, RenderProgress { frame: 0, total, stage: "逐帧渲染".into(), out_path: Some(out_path.to_string_lossy().to_string()), done: false, error: None });

        let mut cancelled = false;
        for f in 0..total {
            if cancel.load(Ordering::SeqCst) { cancelled = true; break; }
            // seek 并确认同步完成
            let seq = cdp.eval(&format!("(function(){{ window.__seek({}); return window.__seekSeq; }})()", f))?;
            if seq.as_u64().is_none() {
                return Err("渲染页 __seek 未生效".into());
            }
            let png = cdp.screenshot_png()?;
            ff_in.write_all(&png).map_err(|e| format!("写入 ffmpeg 失败：{}", e))?;
            if f % 3 == 0 || f == total - 1 {
                emit(&app, RenderProgress { frame: f + 1, total, stage: "逐帧渲染".into(), out_path: Some(out_path.to_string_lossy().to_string()), done: false, error: None });
            }
        }
        drop(ff_in);
        let status = ff.wait().map_err(|e| e.to_string())?;
        if cancelled {
            let _ = std::fs::remove_file(&out_path);
            emit(&app, RenderProgress { frame: 0, total, stage: "已取消".into(), done: true, out_path: None, error: Some("已取消".into()) });
            return Err("已取消".into());
        }
        if !status.success() {
            return Err("ffmpeg 编码失败".into());
        }
        emit(&app, RenderProgress { frame: total, total, stage: "完成".into(), out_path: Some(out_path.to_string_lossy().to_string()), done: true, error: None });
        Ok(out_path.to_string_lossy().to_string())
    })();

    cleanup(&mut browser_child);
    result
}

fn mini_get(url: &str) -> Result<String, String> {
    use std::io::{BufRead, BufReader};
    use std::net::TcpStream;
    // 解析 http://host:port/path
    let rest = url.strip_prefix("http://").ok_or("仅支持 http")?;
    let (hostport, path) = rest.split_once('/').ok_or("URL 无路径")?;
    let mut stream = TcpStream::connect(hostport).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
    write!(stream, "GET /{} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n", path, hostport).map_err(|e| e.to_string())?;
    let reader = BufReader::new(stream);
    let mut body = String::new();
    let mut in_body = false;
    for line in reader.lines() {
        let l = line.map_err(|e| e.to_string())?;
        if in_body {
            body.push_str(&l);
        } else if l.is_empty() {
            in_body = true;
        }
    }
    Ok(body)
}

#[tauri::command]
pub fn render_cancel(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.cancel();
    Ok(())
}
