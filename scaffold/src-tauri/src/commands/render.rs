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

#[derive(Deserialize, Clone)]
pub struct RenderReq {
    pub html: String,
    pub comp: Comp,
    #[serde(rename = "outPath")]
    pub out_path: String,
    pub crf: u32,
    #[serde(rename = "projectDir")]
    pub project_dir: String,
    /** 前端用 OfflineAudioContext 混好的整条音轨（WAV 临时文件）；None 表示无声 */
    #[serde(rename = "audioPath", default)]
    pub audio_path: Option<String>,
    /** 并行渲程序数（1 = 串行） */
    #[serde(default)]
    pub parallel: Option<u32>,
    /** 内部用：本次只渲染 [start, end) 帧（并行分段时由后端自己填） */
    #[serde(skip)]
    pub range: Option<(u32, u32)>,
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
    tauri::async_runtime::spawn_blocking(move || render_dispatch(app, &cancel, req))
        .await
        .map_err(|e| e.to_string())?
}

/* MCP 等同步调用方使用的入口 */
pub fn render_export_sync(app: AppHandle, req: RenderReq) -> Result<String, String> {
    let state = app.state::<AppState>();
    let cancel = Arc::clone(&state.render_cancel);
    render_dispatch(app, &cancel, req)
}

/* 串行 vs 并行：并行时把帧区间等分，每段开一个无头浏览器 + 一条 ffmpeg，
 * 各自渲成无声片段，最后统一 concat（音频在这时一次性混进去）。 */
fn render_dispatch(app: AppHandle, cancel: &Arc<AtomicBool>, req: RenderReq) -> Result<String, String> {
    cancel.store(false, Ordering::SeqCst);
    let total = req.comp.duration_in_frames.max(1);
    let n = req.parallel.unwrap_or(1).clamp(1, 8).min(total.max(1));

    let out_path = if req.out_path.trim().is_empty() {
        PathBuf::from(&req.project_dir).join("out").join(format!("{}.mp4", req.comp.id))
    } else {
        PathBuf::from(&req.out_path)
    };
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    if n <= 1 {
        let mut solo = req.clone();
        solo.range = Some((0, total));
        solo.parallel = Some(1);
        let has_audio = solo.audio_path.as_ref().map(|p| !p.trim().is_empty()).unwrap_or(false);
        // 有音频时先渲无声片段再 concat，保证「音轨只混一次」
        if has_audio {
            let audio = solo.audio_path.clone();
            solo.audio_path = None;
            solo.out_path = out_path.to_string_lossy().to_string();
            let seg = render_blocking(app.clone(), cancel.as_ref(), solo)?;
            video_concat(vec![seg], out_path.to_string_lossy().to_string(), audio)?;
            emit(&app, RenderProgress { frame: total, total, stage: "完成".into(), out_path: Some(out_path.to_string_lossy().to_string()), done: true, error: None });
            return Ok(out_path.to_string_lossy().to_string());
        }
        return render_blocking(app, cancel.as_ref(), solo);
    }

    let work = std::env::temp_dir().join(format!("tempus-par-{}-{}", std::process::id(), total));
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;

    emit(&app, RenderProgress {
        frame: 0, total,
        stage: format!("并行渲染 · {} 路", n),
        out_path: Some(out_path.to_string_lossy().to_string()),
        done: false, error: None
    });

    let mut handles = Vec::new();
    for i in 0..n {
        let s = total * i / n;
        let e = total * (i + 1) / n;
        if e <= s { continue; }
        let mut r = req.clone();
        r.range = Some((s, e));
        r.parallel = Some(1);
        r.audio_path = None;              // 音频统一在 concat 阶段混
        r.out_path = work.join(format!("seg{}.mp4", i)).to_string_lossy().to_string();
        let app2 = app.clone();
        let c2 = Arc::clone(cancel);
        handles.push(std::thread::spawn(move || render_blocking(app2, c2.as_ref(), r)));
    }

    let mut segs: Vec<String> = Vec::new();
    let mut first_err: Option<String> = None;
    for h in handles {
        match h.join() {
            Ok(Ok(p)) => segs.push(p),
            Ok(Err(e)) => { if first_err.is_none() { first_err = Some(e); } }
            Err(_) => { if first_err.is_none() { first_err = Some("并行渲染线程崩溃".into()); } }
        }
    }
    if let Some(e) = first_err {
        let _ = std::fs::remove_dir_all(&work);
        return Err(e);
    }
    if segs.is_empty() {
        let _ = std::fs::remove_dir_all(&work);
        return Err("没有产出任何片段".into());
    }

    emit(&app, RenderProgress {
        frame: total, total,
        stage: "拼接片段".into(),
        out_path: Some(out_path.to_string_lossy().to_string()),
        done: false, error: None
    });

    let mut ordered: Vec<String> = Vec::new();
    for i in 0..n {
        let p = work.join(format!("seg{}.mp4", i)).to_string_lossy().to_string();
        if PathBuf::from(&p).exists() { ordered.push(p); }
    }

    let res = video_concat(ordered, out_path.to_string_lossy().to_string(), req.audio_path.clone());
    let _ = std::fs::remove_dir_all(&work);
    match res {
        Ok(()) => {
            emit(&app, RenderProgress { frame: total, total, stage: "完成".into(), out_path: Some(out_path.to_string_lossy().to_string()), done: true, error: None });
            Ok(out_path.to_string_lossy().to_string())
        }
        Err(e) => {
            emit(&app, RenderProgress { frame: 0, total, stage: "失败".into(), done: true, out_path: None, error: Some(e.clone()) });
            Err(e)
        }
    }
}

fn render_blocking(app: AppHandle, cancel: &AtomicBool, req: RenderReq) -> Result<String, String> {
    let total = req.comp.duration_in_frames.max(1);
    let (f_start, f_end) = req.range.unwrap_or((0, total));
    let span = f_end.saturating_sub(f_start).max(1);
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
        let mut args: Vec<String> = vec![
            "-y".into(),
            "-f".into(), "image2pipe".into(),
            "-framerate".into(), req.comp.fps.to_string(),
            "-i".into(), "-".into(),
        ];
        let has_audio = req.audio_path.as_ref().map(|p| !p.trim().is_empty()).unwrap_or(false);
        if has_audio {
            args.push("-i".into());
            args.push(req.audio_path.clone().unwrap());
        }
        args.extend([
            "-c:v".into(), "libx264".into(),
            "-preset".into(), "medium".into(),
            "-crf".into(), req.crf.to_string(),
            "-pix_fmt".into(), "yuv420p".into(),
        ]);
        if has_audio {
            // 音频长度由前端按总时长生成；不加 -shortest，避免音频短了把画面截断
            args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
        }
        args.extend(["-movflags".into(), "+faststart".into()]);
        args.push(out_path.to_string_lossy().to_string());

        let mut ff = Command::new(&ffmpeg)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("启动 ffmpeg 失败：{}", e))?;
        let mut ff_in = ff.stdin.take().ok_or("无法写入 ffmpeg 管道")?;

        emit(&app, RenderProgress { frame: 0, total: span, stage: "逐帧渲染".into(), out_path: Some(out_path.to_string_lossy().to_string()), done: false, error: None });

        let mut cancelled = false;
        for f in f_start..f_end {
            if cancel.load(Ordering::SeqCst) { cancelled = true; break; }
            // seek 并确认同步完成
            let seq = cdp.eval(&format!("(function(){{ window.__seek({}); return window.__seekSeq; }})()", f))?;
            if seq.as_u64().is_none() {
                return Err("渲染页 __seek 未生效".into());
            }
            let png = cdp.screenshot_png()?;
            ff_in.write_all(&png).map_err(|e| format!("写入 ffmpeg 失败：{}", e))?;
            let done_frames = f - f_start + 1;
            if done_frames % 3 == 0 || f == f_end - 1 {
                emit(&app, RenderProgress { frame: done_frames, total: span, stage: "逐帧渲染".into(), out_path: Some(out_path.to_string_lossy().to_string()), done: false, error: None });
            }
        }
        drop(ff_in);
        let status = ff.wait().map_err(|e| e.to_string())?;
        if cancelled {
            let _ = std::fs::remove_file(&out_path);
            emit(&app, RenderProgress { frame: 0, total: span, stage: "已取消".into(), done: true, out_path: None, error: Some("已取消".into()) });
            return Err("已取消".into());
        }
        if !status.success() {
            return Err("ffmpeg 编码失败".into());
        }
        emit(&app, RenderProgress { frame: span, total: span, stage: "完成".into(), out_path: Some(out_path.to_string_lossy().to_string()), done: true, error: None });
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

/* 多段拼接：序列器（Sequencer）按顺序渲染每一段后，用 concat 合成一条成片。
 * 各段参数一致时直接 stream copy（快）；不一致则重编码兜底。
 * audio_path 可选：整条时间线只铺一条配乐。 */
#[tauri::command]
pub fn video_concat(paths: Vec<String>, out: String, audio_path: Option<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Err("没有可拼接的片段".into());
    }
    let ffmpeg = find_ffmpeg().ok_or_else(|| "未找到 ffmpeg.exe（应随应用一同安装）".to_string())?;
    let work = std::env::temp_dir().join(format!("tempus-concat-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;

    let list = work.join("list.txt");
    let mut body = String::new();
    for p in &paths {
        let norm = p.replace('\\', "/").replace('\'', "'\\''");
        body.push_str(&format!("file '{}'\n", norm));
    }
    std::fs::write(&list, body).map_err(|e| e.to_string())?;

    let joined = work.join("joined.mp4");
    let run = |args: &[&std::ffi::OsStr]| -> Result<(), String> {
        let st = Command::new(&ffmpeg)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| format!("ffmpeg 启动失败：{}", e))?;
        if st.success() { Ok(()) } else { Err("ffmpeg 执行失败".into()) }
    };

    // 1) 直接拼接（同编码/同尺寸时最快）
    let copy_ok = run(&[
        std::ffi::OsStr::new("-y"),
        std::ffi::OsStr::new("-f"), std::ffi::OsStr::new("concat"),
        std::ffi::OsStr::new("-safe"), std::ffi::OsStr::new("0"),
        std::ffi::OsStr::new("-i"), list.as_os_str(),
        std::ffi::OsStr::new("-c"), std::ffi::OsStr::new("copy"),
        joined.as_os_str(),
    ]).is_ok();

    let base = if copy_ok {
        joined.clone()
    } else {
        // 2) 兜底：重编码（尺寸/帧率不一致时）
        let reenc = work.join("rejoined.mp4");
        run(&[
            std::ffi::OsStr::new("-y"),
            std::ffi::OsStr::new("-f"), std::ffi::OsStr::new("concat"),
            std::ffi::OsStr::new("-safe"), std::ffi::OsStr::new("0"),
            std::ffi::OsStr::new("-i"), list.as_os_str(),
            std::ffi::OsStr::new("-c:v"), std::ffi::OsStr::new("libx264"),
            std::ffi::OsStr::new("-preset"), std::ffi::OsStr::new("medium"),
            std::ffi::OsStr::new("-pix_fmt"), std::ffi::OsStr::new("yuv420p"),
            reenc.as_os_str(),
        ])?;
        reenc
    };

    if let Some(a) = audio_path.filter(|p| !p.trim().is_empty()) {
        run(&[
            std::ffi::OsStr::new("-y"),
            std::ffi::OsStr::new("-i"), base.as_os_str(),
            std::ffi::OsStr::new("-i"), std::ffi::OsStr::new(&a),
            std::ffi::OsStr::new("-c:v"), std::ffi::OsStr::new("copy"),
            std::ffi::OsStr::new("-c:a"), std::ffi::OsStr::new("aac"),
            std::ffi::OsStr::new("-b:a"), std::ffi::OsStr::new("192k"),
            std::ffi::OsStr::new("-movflags"), std::ffi::OsStr::new("+faststart"),
            std::ffi::OsStr::new(&out),
        ])?;
    } else {
        std::fs::copy(&base, &out).map_err(|e| format!("输出失败：{}", e))?;
    }

    let _ = std::fs::remove_dir_all(&work);
    Ok(())
}
