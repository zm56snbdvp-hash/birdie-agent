use serde::Serialize;
use std::{
  env,
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
  },
  thread::{self, JoinHandle},
  time::Duration,
};
use tauri::{AppHandle, Emitter};

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
  child: Arc<Mutex<Option<Child>>>,
  thread: Option<JoinHandle<()>>,
}

pub struct ProcessSupervisor {
  stop: Arc<AtomicBool>,
  workers: Mutex<Vec<Worker>>,
}

impl ProcessSupervisor {
  pub fn start(app: AppHandle) -> Self {
    let stop = Arc::new(AtomicBool::new(false));
    let mut workers = Vec::new();

    let specs = discover_specs();
    if specs.is_empty() {
      let _ = app.emit(
        "supervisor.component.changed",
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
      let thread = spawn_worker(app.clone(), stop.clone(), child.clone(), spec);
      workers.push(Worker {
        child,
        thread: Some(thread),
      });
    }

    Self {
      stop,
      workers: Mutex::new(workers),
    }
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
  child_slot: Arc<Mutex<Option<Child>>>,
  spec: ProcessSpec,
) -> JoinHandle<()> {
  thread::Builder::new()
    .name(format!("birdie-supervisor-{}", spec.component))
    .spawn(move || {
      let mut restart_count = 0_u32;
      let mut backoff = Duration::from_millis(500);

      while !stop.load(Ordering::Acquire) {
        let mut command = Command::new(&spec.program);
        command
          .args(&spec.args)
          .stdin(Stdio::null())
          .stdout(Stdio::null())
          .stderr(Stdio::null())
          .env("BIRDIE_SUPERVISED_BY", "birdie-desktop");

        if let Some(directory) = &spec.working_directory {
          command.current_dir(directory);
        }

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        match command.spawn() {
          Ok(child) => {
            let pid = child.id();
            *child_slot.lock().expect("supervised child poisoned") = Some(child);
            let _ = app.emit(
              "supervisor.component.changed",
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
                let mut guard = child_slot.lock().expect("supervised child poisoned");
                if let Some(child) = guard.as_mut() {
                  let _ = child.kill();
                  let _ = child.wait();
                }
                *guard = None;
                let _ = app.emit(
                  "supervisor.component.changed",
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

              let status = {
                let mut guard = child_slot.lock().expect("supervised child poisoned");
                guard
                  .as_mut()
                  .and_then(|child| child.try_wait().ok())
                  .flatten()
              };

              if status.is_some() {
                *child_slot.lock().expect("supervised child poisoned") = None;
                restart_count = restart_count.saturating_add(1);
                let _ = app.emit(
                  "supervisor.component.changed",
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

              thread::sleep(Duration::from_millis(200));
            }
          }
          Err(_) => {
            restart_count = restart_count.saturating_add(1);
            let _ = app.emit(
              "supervisor.component.changed",
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

fn discover_specs() -> Vec<ProcessSpec> {
  if !cfg!(debug_assertions) && !env_flag("BIRDIE_ENABLE_DEV_SUPERVISOR") {
    return Vec::new();
  }

  let Some(repo_root) = repo_root() else {
    return Vec::new();
  };

  let mut specs = Vec::new();
  if !env_disabled("BIRDIE_MANAGE_CORE") {
    let core_program = env::var_os("BIRDIE_CORE_PROGRAM")
      .map(PathBuf::from)
      .unwrap_or_else(|| PathBuf::from("node"));
    let core_script = env::var_os("BIRDIE_CORE_SCRIPT")
      .map(PathBuf::from)
      .unwrap_or_else(|| repo_root.join("services/core/src/server-main.mjs"));
    specs.push(ProcessSpec {
      component: "birdie-core",
      program: core_program,
      args: vec![core_script.to_string_lossy().into_owned()],
      working_directory: Some(repo_root.clone()),
    });
  }

  if !env_disabled("BIRDIE_MANAGE_VOICE") {
    if let Some(voice_program) = discover_voice_executable(&repo_root) {
      let mut args = vec!["--mic".to_string()];
      if env_flag("BIRDIE_DEV_AUTO_ACCEPT") {
        args.push("--dev-auto-accept".to_string());
      }
      specs.push(ProcessSpec {
        component: "birdie-voice",
        program: voice_program,
        args,
        working_directory: Some(repo_root),
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
  ]
  .into_iter()
  .find(|candidate| candidate.is_file())
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
    .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
    .unwrap_or(false)
}

fn env_disabled(name: &str) -> bool {
  env::var(name)
    .map(|value| matches!(value.to_ascii_lowercase().as_str(), "0" | "false" | "no" | "off"))
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
}
