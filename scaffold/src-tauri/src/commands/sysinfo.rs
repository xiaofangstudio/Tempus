use serde::Serialize;
use std::process::Command;
use std::sync::OnceLock;

/* 设备信息：给「偏好设置 → 渲染」显示，并作为并行渲染默认档位的参考。
 * 走 PowerShell CIM 查询（比 wmic 稳，Win11 已移除 wmic）；失败则退回环境变量，绝不阻塞启动。 */

#[derive(Serialize, Clone)]
pub struct SysInfo {
    pub cpu: String,
    pub cores: u32,
    #[serde(rename = "memGB")]
    pub mem_gb: f64,
    pub gpu: String,
    pub os: String,
    /** 建议并行数：按核数与内存估算，上限 8 */
    #[serde(rename = "suggestParallel")]
    pub suggest_parallel: u32,
}

static CACHE: OnceLock<SysInfo> = OnceLock::new();

fn ps(script: &str) -> String {
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output();
    match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => String::new(),
    }
}

fn probe() -> SysInfo {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4);

    let script = "$c=(Get-CimInstance Win32_Processor | Select-Object -First 1).Name;\
$m=[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1);\
$g=(Get-CimInstance Win32_VideoController | Select-Object -First 1).Name;\
\"$c`n$m`n$g\"";
    let raw = ps(script);
    let mut lines = raw.lines();
    let cpu_raw = lines.next().unwrap_or("").trim().to_string();
    let mem: f64 = lines.next().unwrap_or("0").trim().parse().unwrap_or(0.0);
    let gpu_raw = lines.next().unwrap_or("").trim().to_string();

    let cpu = if cpu_raw.is_empty() {
        std::env::var("PROCESSOR_IDENTIFIER").unwrap_or_else(|_| "未知处理器".to_string())
    } else {
        cpu_raw
    };
    let gpu = if gpu_raw.is_empty() { "未知显卡".to_string() } else { gpu_raw };

    // 建议并行：每 2 核 1 个，且要求内存 ≥ 2GB/路；上限 8
    let by_core = (cores / 2).max(1);
    let by_mem = if mem > 0.0 { (mem / 2.0).floor().max(1.0) as u32 } else { 4 };
    let suggest = by_core.min(by_mem).clamp(1, 8);

    SysInfo {
        cpu,
        cores,
        mem_gb: mem,
        gpu,
        os: format!(
            "Windows {} · {} 位",
            std::env::var("OS").unwrap_or_else(|_| "10/11".into()),
            if cfg!(target_pointer_width = "64") { "64" } else { "32" }
        ),
        suggest_parallel: suggest,
    }
}

#[tauri::command]
pub fn sys_info() -> SysInfo {
    CACHE.get_or_init(probe).clone()
}
