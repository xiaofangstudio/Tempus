mod commands;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Deserialize;

pub struct AppState {
    pub project_dir: Mutex<String>,
    pub comps: Mutex<Vec<CompEntry>>,
    pub marks: Mutex<Vec<MarkEntry>>,
    pub docs: Mutex<HashMap<String, String>>,
    pub mcp_port: Mutex<u16>,
    pub render_cancel: Arc<AtomicBool>,
    pub ptys: commands::terminal::PtyState,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[allow(non_snake_case)]
pub struct CompEntry {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub durationInFrames: u32,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[allow(non_snake_case)]
pub struct MarkEntry {
    pub t: f64,
    pub label: String,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            project_dir: Mutex::new(String::new()),
            comps: Mutex::new(Vec::new()),
            marks: Mutex::new(Vec::new()),
            docs: Mutex::new(HashMap::new()),
            mcp_port: Mutex::new(0),
            render_cancel: Arc::new(AtomicBool::new(false)),
            ptys: commands::terminal::PtyState::new(),
        }
    }
    pub fn cancel(&self) {
        self.render_cancel.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.render_cancel.load(Ordering::SeqCst)
    }
    pub fn reset_cancel(&self) {
        self.render_cancel.store(false, Ordering::SeqCst);
    }
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct SetCompsArgs {
    comps: Vec<CompEntry>,
    marks: Vec<MarkEntry>,
    docs: HashMap<String, String>,
    projectDir: String,
}

#[tauri::command]
fn set_compositions(
    state: tauri::State<AppState>,
    args: SetCompsArgs,
) -> Result<(), String> {
    *state.comps.lock().map_err(|e| e.to_string())? = args.comps;
    *state.marks.lock().map_err(|e| e.to_string())? = args.marks;
    *state.docs.lock().map_err(|e| e.to_string())? = args.docs;
    *state.project_dir.lock().map_err(|e| e.to_string())? = args.projectDir;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            set_compositions,
            commands::fsx::fs_list,
            commands::fsx::fs_read,
            commands::fsx::fs_write,
            commands::fsx::fs_mkdir,
            commands::fsx::fs_rename,
            commands::fsx::fs_delete,
            commands::project::project_new,
            commands::project::recent_get,
            commands::project::recent_push,
            commands::project::recent_remove,
            commands::project::pick_folder,
            commands::project::pick_save_file,
            commands::project::project_export_zip,
            commands::project::project_import_zip,
            commands::project::open_path,
            commands::project::detect_env,
            commands::skills::skills_list,
            commands::skills::skills_read,
            commands::mcp::mcp_start,
            commands::mcp::mcp_stop,
            commands::mcp::mcp_status,
            commands::render::render_export,
            commands::render::render_cancel,
            commands::terminal::pty_create,
            commands::terminal::pty_write,
            commands::terminal::pty_resize,
            commands::terminal::pty_close,
            commands::git::git_available,
            commands::git::git_run,
        ])
        .run(tauri::generate_context!())
        .expect("Tempus 启动失败");
}
