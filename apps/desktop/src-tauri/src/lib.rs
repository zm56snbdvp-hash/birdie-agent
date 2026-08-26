mod process_supervisor;

use process_supervisor::ProcessSupervisor;
use std::{
  fs::OpenOptions,
  io::{BufRead, BufReader, Write},
  sync::Mutex,
  thread,
  time::{Duration, SystemTime, UNIX_EPOCH},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{
  menu::{Menu, MenuItem},
  tray::TrayIconBuilder,
  Emitter, Manager, State,
};

const CONTRACT_VERSION: &str = "1.0";
const CORE_PIPE: &str = r"\\.\pipe\birdie.core.control.v1";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresenceSnapshot {
  revision: u64,
  state: String,
  #[serde(default)]
  reason: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSnapshot {
  #[serde(default = "default_lifecycle")]
  lifecycle: String,
  presence: PresenceSnapshot,
  #[serde(default = "default_microphone_state")]
  microphone_state: String,
}

fn default_lifecycle() -> String {
  "READY".into()
}

fn default_microphone_state() -> String {
  "UNAVAILABLE".into()
}

struct RuntimeState {
  snapshot: Mutex<RuntimeSnapshot>,
  writer: Mutex<Option<std::fs::File>>,
}

#[tauri::command]
fn runtime_get_snapshot(
  state: State<'_, RuntimeState>,
  last_revision: i64,
) -> RuntimeSnapshot {
  let _ = last_revision;
  state
    .snapshot
    .lock()
    .expect("runtime state poisoned")
    .clone()
}

#[tauri::command]
fn runtime_set_microphone_enabled(
  state: State<'_, RuntimeState>,
  enabled: bool,
) -> Result<(), String> {
  let nonce = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|error| format!("SYSTEM.CLOCK_ERROR:{error}"))?
    .as_millis();
  let command = json!({
    "type": "runtime.command",
    "requestId": format!("desktop-mic-{}-{nonce}", std::process::id()),
    "payload": {
      "name": "ui.microphone.set_enabled",
      "enabled": enabled,
    },
  });
  send_pipe_message(&state.writer, &command)
}

fn send_pipe_message(
  writer: &Mutex<Option<std::fs::File>>,
  value: &Value,
) -> Result<(), String> {
  let mut guard = writer
    .lock()
    .map_err(|_| "runtime writer poisoned".to_string())?;
  let file = guard
    .as_mut()
    .ok_or_else(|| "RUNTIME.IPC.DISCONNECTED".to_string())?;
  writeln!(file, "{}", value)
    .map_err(|error| format!("RUNTIME.IPC.WRITE_FAILED:{error}"))?;
  file
    .flush()
    .map_err(|error| format!("RUNTIME.IPC.FLUSH_FAILED:{error}"))
}

fn desktop_hello() -> Value {
  json!({
    "type": "component.hello",
    "requestId": format!("desktop-hello-{}", std::process::id()),
    "payload": {
      "component": "birdie-desktop",
      "role": "desktop",
      "instanceId": format!("birdie-desktop-{}", std::process::id()),
      "contractVersion": CONTRACT_VERSION,
    },
  })
}

fn desktop_snapshot_request() -> Value {
  json!({
    "type": "runtime.snapshot.request",
    "requestId": format!("desktop-snapshot-{}", std::process::id()),
    "payload": {},
  })
}

fn clear_runtime_writer(app: &tauri::AppHandle) {
  let runtime = app.state::<RuntimeState>();
  *runtime
    .writer
    .lock()
    .expect("runtime writer poisoned") = None;
}

fn mark_runtime_disconnected(app: &tauri::AppHandle) {
  let snapshot = {
    let runtime = app.state::<RuntimeState>();
    let mut snapshot = runtime
      .snapshot
      .lock()
      .expect("runtime state poisoned");
    snapshot.lifecycle = "DEGRADED".into();
    snapshot.microphone_state = "UNAVAILABLE".into();
    snapshot.presence.revision = snapshot.presence.revision.saturating_add(1);
    snapshot.presence.state = "OFFLINE".into();
    snapshot.presence.reason = "runtime.ipc.disconnected".into();
    snapshot.clone()
  };

  let _ = app.emit(
    "runtime.disconnected",
    json!({ "reason": "RUNTIME.IPC.DISCONNECTED" }),
  );
  let _ = app.emit("runtime.snapshot", snapshot);
}

fn start_core_ipc(app: tauri::AppHandle) {
  thread::spawn(move || loop {
    match OpenOptions::new().read(true).write(true).open(CORE_PIPE) {
      Ok(file) => {
        let writer = match file.try_clone() {
          Ok(writer) => writer,
          Err(_) => {
            thread::sleep(Duration::from_millis(500));
            continue;
          }
        };

        {
          let runtime = app.state::<RuntimeState>();
          *runtime
            .writer
            .lock()
            .expect("runtime writer poisoned") = Some(writer);
        }

        let hello_result = {
          let runtime = app.state::<RuntimeState>();
          send_pipe_message(&runtime.writer, &desktop_hello())
        };
        if hello_result.is_err() {
          clear_runtime_writer(&app);
          thread::sleep(Duration::from_millis(500));
          continue;
        }

        let reader = BufReader::new(file);
        for line in reader.lines() {
          let Ok(line) = line else { break };
          let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
          };

          match message.get("type").and_then(Value::as_str) {
            Some("component.hello.ack") => {
              let accepted = message
                .pointer("/payload/accepted")
                .and_then(Value::as_bool)
                .unwrap_or(false);
              if accepted {
                let _ = app.emit(
                  "runtime.connected",
                  json!({
                    "pipe": CORE_PIPE,
                    "contractVersion": CONTRACT_VERSION,
                    "role": "desktop",
                  }),
                );
                let runtime = app.state::<RuntimeState>();
                let _ = send_pipe_message(
                  &runtime.writer,
                  &desktop_snapshot_request(),
                );
              }
            }
            Some("runtime.snapshot") => {
              if let Some(payload) = message.get("payload") {
                if let Ok(next) =
                  serde_json::from_value::<RuntimeSnapshot>(payload.clone())
                {
                  let snapshot = {
                    let runtime = app.state::<RuntimeState>();
                    let mut snapshot = runtime
                      .snapshot
                      .lock()
                      .expect("runtime state poisoned");
                    *snapshot = next;
                    snapshot.clone()
                  };
                  let _ = app.emit("runtime.snapshot", snapshot);
                }
              }
            }
            Some("runtime.presence.changed") => {
              if let Some(payload) = message.get("payload") {
                if let Ok(presence) =
                  serde_json::from_value::<PresenceSnapshot>(payload.clone())
                {
                  let changed = {
                    let runtime = app.state::<RuntimeState>();
                    let mut snapshot = runtime
                      .snapshot
                      .lock()
                      .expect("runtime state poisoned");
                    if presence.revision > snapshot.presence.revision {
                      snapshot.presence = presence.clone();
                      true
                    } else {
                      false
                    }
                  };
                  if changed {
                    let _ = app.emit("runtime.presence.changed", presence);
                  }
                }
              }
            }
            Some("runtime.audio.input") => {
              if let Some(payload) = message.get("payload") {
                let _ = app.emit("runtime.audio.input", payload.clone());
              }
            }
            Some("runtime.audio.output") => {
              if let Some(payload) = message.get("payload") {
                let _ = app.emit("runtime.audio.output", payload.clone());
              }
            }
            Some("error") => {
              let error = message
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("RUNTIME.IPC.ERROR");
              let _ = app.emit(
                "runtime.ipc.error",
                json!({ "error": error }),
              );
              if error.starts_with("CONTRACT.") {
                break;
              }
            }
            _ => {}
          }
        }
      }
      Err(_) => {}
    }

    clear_runtime_writer(&app);
    mark_runtime_disconnected(&app);
    thread::sleep(Duration::from_millis(750));
  });
}

fn recover_dev_webview(app: tauri::AppHandle) {
  let Ok(frontend_url) = std::env::var("BIRDIE_DEV_FRONTEND_URL") else {
    return;
  };
  if !frontend_url.starts_with("http://127.0.0.1:") {
    return;
  }

  thread::spawn(move || {
    thread::sleep(Duration::from_millis(900));
    if let Some(window) = app.get_webview_window("core") {
      let script = format!(
        "if (window.location.href !== {url}) window.location.replace({url});",
        url = serde_json::to_string(&frontend_url)
          .unwrap_or_else(|_| "\"http://127.0.0.1:1420\"".into()),
      );
      let _ = window.eval(&script);
    }
  });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(RuntimeState {
      snapshot: Mutex::new(RuntimeSnapshot {
        lifecycle: "STARTING".into(),
        presence: PresenceSnapshot {
          revision: 0,
          state: "OFFLINE".into(),
          reason: "runtime.not_connected".into(),
        },
        microphone_state: "UNAVAILABLE".into(),
      }),
      writer: Mutex::new(None),
    })
    .invoke_handler(tauri::generate_handler![
      runtime_get_snapshot,
      runtime_set_microphone_enabled,
    ])
    .plugin(tauri_plugin_single_instance::init(|app, _, _| {
      if let Some(window) = app.get_webview_window("core") {
        let _ = window.show();
        let _ = window.set_focus();
      }
    }))
    .plugin(tauri_plugin_autostart::Builder::new().build())
    .setup(|app| {
      let supervisor = ProcessSupervisor::start(app.handle().clone());
      let _ = app.manage(supervisor);
      start_core_ipc(app.handle().clone());
      recover_dev_webview(app.handle().clone());

      let show = MenuItem::with_id(
        app,
        "show",
        "Birdie anzeigen",
        true,
        None::<&str>,
      )?;
      let hide = MenuItem::with_id(
        app,
        "hide",
        "Birdie verbergen",
        true,
        None::<&str>,
      )?;
      let quit = MenuItem::with_id(
        app,
        "quit",
        "Birdie beenden",
        true,
        None::<&str>,
      )?;
      let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
      TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "show" => {
            if let Some(window) = app.get_webview_window("core") {
              let _ = window.show();
            }
          }
          "hide" => {
            if let Some(window) = app.get_webview_window("core") {
              let _ = window.hide();
            }
          }
          "quit" => {
            app.state::<ProcessSupervisor>().shutdown();
            app.exit(0);
          }
          _ => {}
        })
        .build(app)?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("Birdie desktop runtime failed");
}
