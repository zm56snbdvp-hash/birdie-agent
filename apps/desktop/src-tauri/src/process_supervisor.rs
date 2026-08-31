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
use std::os::windows::{io::AsRawHandle, process::CommandExt};

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
struct KillOnCloseJob {
    handle: HANDLE,
}

#[cfg(windows)]
impl KillOnCloseJob {
    fn create() -> Result<Self, String> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(format!(
                "CreateJobObjectW failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                std::ptr::addr_of!(limits).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            let error = std::io::Error::last_os_error();
            unsafe {
                CloseHandle(handle);
            }
            return Err(format!("SetInformationJobObject failed: {error}"));
        }

        Ok(Self { handle })
    }

    fn assign(&self, child: &Child) -> Result<(), String> {
        let assigned =
            unsafe { AssignProcessToJobObject(self.handle, child.as_raw_handle() as HANDLE) };
        if assigned == 0 {
            return Err(format!(
                "AssignProcessToJobObject failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
}

#[cfg(windows)]
impl Drop for KillOnCloseJob {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

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
    transition: Arc<Mutex<()>>,
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
    pub fn start(app: AppHandle, initial_voice_enabled: bool) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let voice_enabled = Arc::new(AtomicBool::new(initial_voice_enabled));
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
            let transition = Arc::new(Mutex::new(()));
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
                transition.clone(),
                spec,
            );
            workers.push(Worker {
                component,
                child,
                transition,
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

    pub fn set_voice_enabled(&self, enabled: bool) -> Result<(), String> {
        if !self.voice_managed {
            return Err("VOICE.SUPERVISOR.NOT_MANAGED".to_string());
        }

        // Every transition first closes the privacy gate so any failure leaves
        // capture disabled. On is published only after every managed Voice
        // transition has been checked successfully.
        self.voice_enabled.store(false, Ordering::Release);
        let workers = self
            .workers
            .lock()
            .map_err(|_| "VOICE.SUPERVISOR.STATE_POISONED".to_string())?;
        let mut matched_voice_worker = false;
        for worker in workers
            .iter()
            .filter(|worker| worker.component == "birdie-voice")
        {
            matched_voice_worker = true;
            let _transition = worker
                .transition
                .lock()
                .map_err(|_| "VOICE.SUPERVISOR.TRANSITION_POISONED".to_string())?;
            if enabled {
                continue;
            }

            // Privacy first: synchronously terminate the capture process before
            // the tray command is acknowledged. The transition lock closes the
            // spawn-before-store race with the worker.
            let mut guard = worker
                .child
                .lock()
                .map_err(|_| "VOICE.SUPERVISOR.CHILD_POISONED".to_string())?;
            if let Some(child) = guard.as_mut() {
                terminate_child(child)?;
                *guard = None;
            }
        }
        if !matched_voice_worker {
            return Err("VOICE.SUPERVISOR.WORKER_MISSING".to_string());
        }
        if enabled {
            self.voice_enabled.store(true, Ordering::Release);
        }
        Ok(())
    }

    pub fn manages_voice(&self) -> bool {
        self.voice_managed
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

fn terminate_child(child: &mut Child) -> Result<(), String> {
    match child.try_wait() {
        Ok(Some(_)) => return Ok(()),
        Ok(None) => {}
        Err(error) => return Err(format!("VOICE.SUPERVISOR.STATUS_FAILED:{error}")),
    }
    if let Err(kill_error) = child.kill() {
        return match child.try_wait() {
            Ok(Some(_)) => Ok(()),
            Ok(None) => Err(format!("VOICE.SUPERVISOR.KILL_FAILED:{kill_error}")),
            Err(status_error) => Err(format!(
                "VOICE.SUPERVISOR.KILL_FAILED:{kill_error};STATUS_FAILED:{status_error}"
            )),
        };
    }
    child
        .wait()
        .map(|_| ())
        .map_err(|error| format!("VOICE.SUPERVISOR.WAIT_FAILED:{error}"))
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
    component_transition: Arc<Mutex<()>>,
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

                #[cfg(windows)]
                let kill_on_close_job = match KillOnCloseJob::create() {
                    Ok(job) => job,
                    Err(error) => {
                        diagnostic(
                            "JOB_CREATE_ERR",
                            format!("component={} error={error}", spec.component),
                        );
                        restart_count = restart_count.saturating_add(1);
                        if sleep_until_restart(&stop, backoff) {
                            return;
                        }
                        backoff = std::cmp::min(backoff.saturating_mul(2), Duration::from_secs(5));
                        continue;
                    }
                };

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
                let transition_guard = component_transition
                    .lock()
                    .expect("supervised transition poisoned");
                if !component_spawn_allowed(&stop, &component_enabled) {
                    drop(transition_guard);
                    continue;
                }
                match command.spawn() {
                    Ok(mut child) => {
                        let pid = child.id();

                        #[cfg(windows)]
                        let child_is_managed = match kill_on_close_job.assign(&child) {
                            Ok(()) => {
                                diagnostic(
                                    "JOB_ASSIGN_OK",
                                    format!("component={} pid={pid}", spec.component),
                                );
                                true
                            }
                            Err(error) => {
                                diagnostic(
                                    "JOB_ASSIGN_ERR",
                                    format!("component={} pid={pid} error={error}", spec.component),
                                );
                                let _ = child.kill();
                                let _ = child.wait();
                                restart_count = restart_count.saturating_add(1);
                                let _ = app.emit(
                                    EVENT_SUPERVISOR_COMPONENT_CHANGED,
                                    SupervisorEvent {
                                        component: spec.component,
                                        status: "RESTART_PENDING",
                                        pid: None,
                                        restart_count,
                                        error_code: Some("SUPERVISOR.JOB_ASSIGN_FAILED"),
                                    },
                                );
                                false
                            }
                        };
                        #[cfg(not(windows))]
                        let child_is_managed = true;

                        if !child_is_managed {
                            if sleep_until_restart(&stop, backoff) {
                                return;
                            }
                            backoff =
                                std::cmp::min(backoff.saturating_mul(2), Duration::from_secs(5));
                            continue;
                        }

                        diagnostic(
                            "SPAWN_OK",
                            format!("component={} pid={pid}", spec.component),
                        );
                        *child_slot.lock().expect("supervised child poisoned") = Some(child);
                        drop(transition_guard);
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
                        drop(transition_guard);
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

fn component_spawn_allowed(stop: &AtomicBool, component_enabled: &AtomicBool) -> bool {
    !stop.load(Ordering::Acquire) && component_enabled.load(Ordering::Acquire)
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
            .unwrap_or_else(|| discover_node_program(&runtime_root));
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

fn discover_node_program(runtime_root: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let candidates = node_program_candidates(runtime_root);
        if let Some(candidate) = candidates.into_iter().find(|path| path.is_file()) {
            return candidate;
        }
    }
    PathBuf::from("node")
}

#[cfg(windows)]
fn node_program_candidates(runtime_root: &Path) -> [PathBuf; 4] {
    [
        runtime_root.join("build/runtime/node.exe"),
        runtime_root.join("node.exe"),
        PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
        PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"),
    ]
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

    fn test_voice_supervisor(
        initial_voice_enabled: bool,
        child: Option<Child>,
    ) -> ProcessSupervisor {
        ProcessSupervisor {
            stop: Arc::new(AtomicBool::new(false)),
            voice_enabled: Arc::new(AtomicBool::new(initial_voice_enabled)),
            voice_managed: true,
            workers: Mutex::new(vec![Worker {
                component: "birdie-voice",
                child: Arc::new(Mutex::new(child)),
                transition: Arc::new(Mutex::new(())),
                thread: None,
            }]),
        }
    }

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

    #[test]
    fn disabled_initial_voice_preference_blocks_spawn_until_reenabled() {
        let stop = AtomicBool::new(false);
        let voice_enabled = AtomicBool::new(false);

        assert!(!component_spawn_allowed(&stop, &voice_enabled));
        voice_enabled.store(true, Ordering::Release);
        assert!(component_spawn_allowed(&stop, &voice_enabled));
        stop.store(true, Ordering::Release);
        assert!(!component_spawn_allowed(&stop, &voice_enabled));

        let supervisor = test_voice_supervisor(false, None);
        assert_eq!(
            supervisor.component_status("birdie-voice"),
            "STOPPED_BY_USER"
        );
    }

    #[test]
    fn failed_voice_enable_keeps_privacy_gate_disabled() {
        let supervisor = test_voice_supervisor(true, None);
        let transition = supervisor.workers.lock().unwrap()[0].transition.clone();
        let poisoned = thread::spawn(move || {
            let _guard = transition.lock().unwrap();
            panic!("poison transition for fail-closed enable test");
        });
        assert!(poisoned.join().is_err());

        assert_eq!(
            supervisor.set_voice_enabled(true).unwrap_err(),
            "VOICE.SUPERVISOR.TRANSITION_POISONED"
        );
        assert!(!supervisor.voice_enabled.load(Ordering::Acquire));
        assert_eq!(
            supervisor.component_status("birdie-voice"),
            "STOPPED_BY_USER"
        );
    }

    #[cfg(windows)]
    #[test]
    fn disabling_voice_accepts_an_already_exited_child() {
        let mut child = Command::new("cmd.exe")
            .args(["/D", "/S", "/C", "exit /B 0"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .expect("short-lived child should start");
        child.wait().expect("short-lived child should exit");
        let supervisor = test_voice_supervisor(true, Some(child));

        supervisor
            .set_voice_enabled(false)
            .expect("already-exited voice is safely disabled");

        assert_eq!(
            supervisor.component_status("birdie-voice"),
            "STOPPED_BY_USER"
        );
        assert!(supervisor.workers.lock().unwrap()[0]
            .child
            .lock()
            .unwrap()
            .is_none());
    }

    #[cfg(windows)]
    #[test]
    fn disabling_voice_closes_spawn_before_store_race() {
        let supervisor = Arc::new(test_voice_supervisor(true, None));
        let (transition, child_slot) = {
            let workers = supervisor.workers.lock().unwrap();
            (workers[0].transition.clone(), workers[0].child.clone())
        };
        let transition_guard = transition.lock().unwrap();
        let disabling = {
            let supervisor = supervisor.clone();
            thread::spawn(move || supervisor.set_voice_enabled(false))
        };

        let child = Command::new("cmd.exe")
            .args(["/D", "/S", "/C", "ping -n 30 127.0.0.1 >NUL"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .expect("long-running child should start");
        *child_slot.lock().unwrap() = Some(child);
        drop(transition_guard);

        disabling
            .join()
            .expect("disable thread should not panic")
            .expect("disable should terminate the raced child");
        assert!(!supervisor.voice_enabled.load(Ordering::Acquire));
        assert!(child_slot.lock().unwrap().is_none());
    }

    #[cfg(windows)]
    #[test]
    fn kill_on_close_job_terminates_assigned_child() {
        let job = KillOnCloseJob::create().expect("job object should be created");
        let mut child = Command::new("cmd.exe")
            .args(["/D", "/S", "/C", "ping -n 30 127.0.0.1 >NUL"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .expect("long-running child should start");
        job.assign(&child)
            .expect("long-running child should join the job");

        drop(job);

        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            if child
                .try_wait()
                .expect("child status should remain readable")
                .is_some()
            {
                break;
            }
            if std::time::Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("assigned child survived closing its job object");
            }
            thread::sleep(Duration::from_millis(25));
        }
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

    #[cfg(windows)]
    #[test]
    fn bundled_node_is_the_first_runtime_candidate() {
        let runtime_root = PathBuf::from(r"C:\Birdie\resources");
        assert_eq!(
            node_program_candidates(&runtime_root)[0],
            runtime_root.join("build/runtime/node.exe")
        );
    }
}
