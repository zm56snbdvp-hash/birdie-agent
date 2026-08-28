use serde::Serialize;
use std::{
    env,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

const EVENT_SUPERVISOR_COMPONENT_CHANGED: &str = "supervisor:component-changed";

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug)]
struct ProcessSpec {
    component: &'static str,
    program: PathBuf,
    args: Vec<String>,
    working_directory: Option<PathBuf>,
    environment: Vec<(String, String)>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SupervisorEvent<'a> {
    component: &'a str,
    status: &'a str,
    pid: Option<u32>,
    restart_count: u32,
    error_code: Option<&'a str>,
}

struct Worker {
    component: &'static str,
    child: Arc<Mutex<Option<Child>>>,
    thread: Option<JoinHandle<()>>,
}

pub struct ProcessSupervisor {
    stop: Arc<AtomicBool>,
    voice_enabled: Arc<AtomicBool>,
    voice_managed: bool,
    workers: Mutex<Vec<Worker>>,
}

fn diagnostic(event: &str, detail: impl AsRef<str>) {
    let Some(local_app_data) = env::var_os("LOCALAPPDATA") else {
        return;
    };
    let path = PathBuf::from(local_app_data)
        .join("Birdie")
        .join("logs")
        .join("desktop-runtime-diagnostic.log");
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let _ = writeln!(file, "SUPERVISOR_{event} {}", detail.as_ref());
}

impl ProcessSupervisor {
    pub fn start(app: AppHandle) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let voice_enabled = Arc::new(AtomicBool::new(true));
        let mut workers = Vec::new();

        let specs = discover_specs(&app);
        diagnostic(
            "DISCOVER",
            format!(
                "count={} components={}",
                specs.len(),
                specs
                    .iter()
                    .map(|spec| spec.component)
                    .collect::<Vec<_>>()
                    .join(",")
            ),
        );
        let voice_managed = specs.iter().any(|spec| spec.component == "birdie-voice");
        if specs.is_empty() {
            let _ = app.emit(
                EVENT_SUPERVISOR_COMPONENT_CHANGED,
                SupervisorEvent {
                    component: "birdie-runtime",
                    status: "NOT_CONFIGURED",
                    pid: None,
                    restart_count: 0,
                    error_code: Some("SUPERVISOR.NO_COMPONENTS_CONFIGURED"),
                },
            );
        }

        for spec in specs {
            let child = Arc::new(Mutex::new(None));
            let component_enabled = if spec.component == "birdie-voice" {
                voice_enabled.clone()
            } else {
                Arc::new(AtomicBool::new(true))
            };
            let component = spec.component;
            let thread = spawn_worker(
                app.clone(),
                stop.clone(),
                component_enabled,
                child.clone(),
                spec,
            );
            workers.push(Worker {
                component,
                child,
                thread: Some(thread),
            });
        }

        Self {
            stop,
            voice_enabled,
            voice_managed,
            workers: Mutex::new(workers),
        }
    }

    #[allow(dead_code)]
    pub fn set_voice_enabled(&self, enabled: bool) -> Result<(), String> {
        if !self.voice_managed {
            return Err("VOICE.SUPERVISOR.NOT_MANAGED".to_string());
        }

        self.voice_enabled.store(enabled, Ordering::Release);
        if enabled {
            return Ok(());
        }

        // Privacy first: synchronously terminate the capture process before the
        // UI command is acknowledged. The worker remains disabled until re-enabled.
        let workers = self
            .workers
            .lock()
            .map_err(|_| "VOICE.SUPERVISOR.STATE_POISONED".to_string())?;
        for worker in workers
            .iter()
            .filter(|worker| worker.component == "birdie-voice")
        {
            let mut guard = worker
                .child
                .lock()
                .map_err(|_| "VOICE.SUPERVISOR.CHILD_POISONED".to_string())?;
            if let Some(mut child) = guard.take() {
                child
                    .kill()
                    .map_err(|error| format!("VOICE.SUPERVISOR.KILL_FAILED:{error}"))?;
                child
                    .wait()
                    .map_err(|error| format!("VOICE.SUPERVISOR.WAIT_FAILED:{error}"))?;
            }
        }
        Ok(())
    }

    pub fn component_status(&self, component: &str) -> String {
        if component == "birdie-voice" && !self.voice_enabled.load(Ordering::Acquire) {
            return "STOPPED_BY_USER".into();
        }
        let Ok(workers) = self.workers.lock() else {
            return "UNKNOWN".into();
        };
        let Some(worker) = workers.iter().find(|worker| worker.component == component) else {
            return "UNMANAGED".into();
        };
        let status = match worker.child.lock() {
            Ok(child) if child.is_some() => "RUNNING".into(),
            Ok(_) => "STARTING_OR_RESTART_PENDING".into(),
            Err(_) => "UNKNOWN".into(),
        };
        status
    }

    pub fn shutdown(&self) {
        if self.stop.swap(true, Ordering::AcqRel) {
            return;
        }

        let mut workers = self.workers.lock().expect("process supervisor poisoned");
        for worker in workers.iter() {
            if let Ok(mut guard) = worker.child.lock() {
                if let Some(child) = guard.as_mut() {
                    let _ = child.kill();
                }
            }
        }

        for worker in workers.iter_mut() {
            if let Some(handle) = worker.thread.take() {
                let _ = handle.join();
            }
        }
    }
}

impl Drop for ProcessSupervisor {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn spawn_worker(
    app: AppHandle,
    stop: Arc<AtomicBool>,
    component_enabled: Arc<AtomicBool>,
    child_slot: Arc<Mutex<Option<Child>>>,
    spec: ProcessSpec,
) -> JoinHandle<()> {
    thread::Builder::new()
        .name(format!("birdie-supervisor-{}", spec.component))
        .spawn(move || {
            let mut restart_count = 0_u32;
            let mut backoff = Duration::from_millis(500);
            let mut disabled_reported = false;

            while !stop.load(Ordering::Acquire) {
                if !component_enabled.load(Ordering::Acquire) {
                    if !disabled_reported {
                        let _ = app.emit(
                            EVENT_SUPERVISOR_COMPONENT_CHANGED,
                            SupervisorEvent {
                                component: spec.component,
                                status: "STOPPED_BY_USER",
                                pid: None,
                                restart_count,
                                error_code: Some("VOICE.MICROPHONE.MUTED_BY_USER"),
                            },
                        );
                        disabled_reported = true;
                    }
                    thread::sleep(Duration::from_millis(100));
                    continue;
                }
                disabled_reported = false;

                let mut command = Command::new(&spec.program);
                command
                    .args(&spec.args)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .env("BIRDIE_SUPERVISED_BY", "birdie-desktop");
                for (key, value) in &spec.environment {
                    command.env(key, value);
                }

                if let Some(directory) = &spec.working_directory {
                    command.current_dir(directory);
                }

                #[cfg(windows)]
                command.creation_flags(CREATE_NO_WINDOW);

                diagnostic(
                    "SPAWN_ATTEMPT",
                    format!(
                        "component={} program={} args={} cwd={}",
                        spec.component,
                        spec.program.display(),
                        spec.args.join(" "),
                        spec.working_directory
                            .as_ref()
                            .map(|path| path.display().to_string())
                            .unwrap_or_default()
                    ),
                );
                match command.spawn() {
                    Ok(child) => {
                        let pid = child.id();
                        diagnostic(
                            "SPAWN_OK",
                            format!("component={} pid={pid}", spec.component),
                        );
                        *child_slot.lock().expect("supervised child poisoned") = Some(child);
                        let _ = app.emit(
                            EVENT_SUPERVISOR_COMPONENT_CHANGED,
                            SupervisorEvent {
                                component: spec.component,
                                status: "RUNNING",
                                pid: Some(pid),
                                restart_count,
                                error_code: None,
                            },
                        );
                        backoff = Duration::from_millis(500);

                        loop {
                            if stop.load(Ordering::Acquire) {
                                let mut guard =
                                    child_slot.lock().expect("supervised child poisoned");
                                if let Some(child) = guard.as_mut() {
                                    let _ = child.kill();
                                    let _ = child.wait();
                                }
                                *guard = None;
                                let _ = app.emit(
                                    EVENT_SUPERVISOR_COMPONENT_CHANGED,
                                    SupervisorEvent {
                                        component: spec.component,
                                        status: "STOPPED",
                                        pid: None,
                                        restart_count,
                                        error_code: None,
                                    },
                                );
                                return;
                            }

                            if !component_enabled.load(Ordering::Acquire) {
                                let mut guard =
                                    child_slot.lock().expect("supervised child poisoned");
                                if let Some(child) = guard.as_mut() {
                                    let _ = child.kill();
                                    let _ = child.wait();
                                }
                                *guard = None;
                                break;
                            }

                            let exited = {
                                let mut guard =
                                    child_slot.lock().expect("supervised child poisoned");
                                match guard.as_mut() {
                                    Some(child) => child.try_wait().ok().flatten().is_some(),
                                    None => true,
                                }
                            };

                            if exited {
                                *child_slot.lock().expect("supervised child poisoned") = None;
                                restart_count = restart_count.saturating_add(1);
                                let _ = app.emit(
                                    EVENT_SUPERVISOR_COMPONENT_CHANGED,
                                    SupervisorEvent {
                                        component: spec.component,
                                        status: "RESTART_PENDING",
                                        pid: None,
                                        restart_count,
                                        error_code: Some("SUPERVISOR.PROCESS_EXITED"),
                                    },
                                );
                                break;
                            }

                            thread::sleep(Duration::from_millis(100));
                        }
                    }
                    Err(_) => {
                        diagnostic(
                            "SPAWN_ERR",
                            format!(
                                "component={} program={} args={}",
                                spec.component,
                                spec.program.display(),
                                spec.args.join(" ")
                            ),
                        );
                        restart_count = restart_count.saturating_add(1);
                        let _ = app.emit(
                            EVENT_SUPERVISOR_COMPONENT_CHANGED,
                            SupervisorEvent {
                                component: spec.component,
                                status: "RESTART_PENDING",
                                pid: None,
                                restart_count,
                                error_code: Some("SUPERVISOR.SPAWN_FAILED"),
                            },
                        );
                    }
                }

                if !component_enabled.load(Ordering::Acquire) {
                    continue;
                }
                if sleep_until_restart(&stop, backoff) {
                    return;
                }
                backoff = std::cmp::min(backoff.saturating_mul(2), Duration::from_secs(5));
            }
        })
        .expect("could not start Birdie process supervisor thread")
}

fn sleep_until_restart(stop: &AtomicBool, duration: Duration) -> bool {
    let slices = duration.as_millis().div_ceil(100) as u64;
    for _ in 0..slices {
        if stop.load(Ordering::Acquire) {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    stop.load(Ordering::Acquire)
}

fn discover_specs(app: &AppHandle) -> Vec<ProcessSpec> {
    let Some(runtime_root) = runtime_root(app) else {
        return Vec::new();
    };

    let mut specs = Vec::new();
    if !env_disabled("BIRDIE_MANAGE_CORE") {
        let core_program = env::var_os("BIRDIE_CORE_PROGRAM")
            .map(PathBuf::from)
            .unwrap_or_else(discover_node_program);
        let core_script = env::var_os("BIRDIE_CORE_SCRIPT")
            .map(PathBuf::from)
            .unwrap_or_else(|| runtime_root.join("services/core/src/server-main.mjs"));
        if core_script.is_file() || env::var_os("BIRDIE_CORE_SCRIPT").is_some() {
            specs.push(ProcessSpec {
                component: "birdie-core",
                program: core_program,
                args: vec![core_script.to_string_lossy().into_owned()],
                working_directory: Some(runtime_root.clone()),
                environment: Vec::new(),
            });
        }
    }

    if !env_disabled("BIRDIE_MANAGE_VOICE") {
        if let Some(voice_program) = discover_voice_executable(&runtime_root) {
            let mut args = vec!["--mic".to_string()];
            if env_flag("BIRDIE_DEV_AUTO_ACCEPT") {
                args.push("--dev-auto-accept".to_string());
            }
            specs.push(ProcessSpec {
                component: "birdie-voice",
                program: voice_program,
                args,
                working_directory: Some(runtime_root.clone()),
                environment: discover_voice_environment(&runtime_root),
            });
        }
    }

    specs
}

fn discover_voice_executable(repo_root: &Path) -> Option<PathBuf> {
    if let Some(path) = env::var_os("BIRDIE_VOICE_EXE").map(PathBuf::from) {
        return Some(path);
    }

    [
        repo_root.join("build/voice/Release/birdie-voice-host.exe"),
        repo_root.join("build/voice/Debug/birdie-voice-host.exe"),
        repo_root.join("services/voice/build/Release/birdie-voice-host.exe"),
        repo_root.join("services/voice/build/Debug/birdie-voice-host.exe"),
        repo_root.join("birdie-voice-host.exe"),
        repo_root.join("voice/birdie-voice-host.exe"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

fn discover_node_program() -> PathBuf {
    #[cfg(windows)]
    {
        let candidates = [
            PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
            PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"),
        ];
        if let Some(candidate) = candidates.into_iter().find(|path| path.is_file()) {
            return candidate;
        }
    }
    PathBuf::from("node")
}

fn discover_voice_environment(runtime_root: &Path) -> Vec<(String, String)> {
    let mut environment = Vec::new();
    if env::var_os("BIRDIE_GATE_STT_PROVIDER").is_none() {
        let model = env::var_os("BIRDIE_GATE_STT_MODEL")
            .map(PathBuf::from)
            .unwrap_or_else(|| runtime_root.join("models/whisper/ggml-base.bin"));
        if model.is_file() {
            environment.push(("BIRDIE_GATE_STT_PROVIDER".into(), "whisper.cpp".into()));
            environment.push((
                "BIRDIE_GATE_STT_MODEL".into(),
                model.to_string_lossy().into_owned(),
            ));
            environment.push(("BIRDIE_GATE_STT_LANGUAGE".into(), "de".into()));
            environment.push(("BIRDIE_GATE_STT_THREADS".into(), "4".into()));
            environment.push(("BIRDIE_GATE_STT_USE_GPU".into(), "0".into()));
            environment.push(("BIRDIE_GATE_STT_FLASH_ATTN".into(), "0".into()));
        }
    }
    if env::var_os("BIRDIE_TTS_PROVIDER").is_none() {
        environment.push(("BIRDIE_TTS_PROVIDER".into(), "windows-sapi".into()));
    }
    environment
}

fn runtime_root(app: &AppHandle) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return repo_root();
    }
    app.path().resource_dir().ok().map(normalize_spawn_path)
}

#[cfg(windows)]
fn normalize_spawn_path(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

#[cfg(not(windows))]
fn normalize_spawn_path(path: PathBuf) -> PathBuf {
    path
}

fn repo_root() -> Option<PathBuf> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()?
        .parent()?
        .parent()
        .map(Path::to_path_buf)
}

fn env_flag(name: &str) -> bool {
    env::var(name)
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn env_disabled(name: &str) -> bool {
    env::var(name)
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "0" | "false" | "no" | "off"
            )
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_root_contains_expected_monorepo_directories() {
        let root = repo_root().expect("repo root should resolve from Cargo manifest");
        assert!(root.join("apps/desktop").is_dir());
        assert!(root.join("services/core").is_dir());
    }

    #[test]
    fn restart_sleep_can_be_cancelled() {
        let stop = AtomicBool::new(true);
        assert!(sleep_until_restart(&stop, Duration::from_secs(5)));
    }

    #[cfg(windows)]
    #[test]
    fn normalize_spawn_path_removes_windows_extended_prefix() {
        assert_eq!(
            normalize_spawn_path(PathBuf::from(r"\\?\C:\Birdie")),
            PathBuf::from(r"C:\Birdie")
        );
        assert_eq!(
            normalize_spawn_path(PathBuf::from(r"\\?\UNC\server\share\Birdie")),
            PathBuf::from(r"\\server\share\Birdie")
        );
    }
}
