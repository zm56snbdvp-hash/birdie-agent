use std::{fs::OpenOptions, io::{BufRead, BufReader, Write}, sync::{Arc, Mutex}, thread, time::Duration};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Manager, State, menu::{Menu, MenuItem}, tray::TrayIconBuilder};

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

fn default_lifecycle() -> String { "READY".into() }
fn default_microphone_state() -> String { "ENABLED".into() }

struct RuntimeState {
  snapshot: Mutex<RuntimeSnapshot>,
  writer: Mutex<Option<std::fs::File>>,
}

#[tauri::command]
fn runtime_get_snapshot(state: State<'_, RuntimeState>, last_revision: i64) -> RuntimeSnapshot {
  let _ = last_revision;
  state.snapshot.lock().expect("runtime state poisoned").clone()
}

#[tauri::command]
fn runtime_set_microphone_enabled(state: State<'_, RuntimeState>, enabled: bool) -> Result<RuntimeSnapshot, String> {
  let command = json!({
    "type": "runtime.command",
    "requestId": format!("desktop-mic-{}", std::process::id()),
    "payload": { "name": "ui.microphone.set_enabled", "enabled": enabled }
  });
  send_pipe_message(&state.writer, &command)?;
  let mut snapshot = state.snapshot.lock().map_err(|_| "runtime state poisoned".to_string())?;
  snapshot.microphone_state = if enabled { "ENABLED".into() } else { "MUTED_BY_USER".into() };
  Ok(snapshot.clone())
}

fn send_pipe_message(writer: &Mutex<Option<std::fs::File>>, value: &Value) -> Result<(), String> {
  let mut guard = writer.lock().map_err(|_| "runtime writer poisoned".to_string())?;
  let file = guard.as_mut().ok_or_else(|| "RUNTIME.IPC.DISCONNECTED".to_string())?;
  writeln!(file, "{}", value).map_err(|e| format!("RUNTIME.IPC.WRITE_FAILED:{e}"))?;
  file.flush().map_err(|e| format!("RUNTIME.IPC.FLUSH_FAILED:{e}"))
}

fn start_core_ipc(app: tauri::AppHandle, shared: Arc<RuntimeState>) {
  thread::spawn(move || loop {
    match OpenOptions::new().read(true).write(true).open(CORE_PIPE) {
      Ok(file) => {
        let writer = match file.try_clone() {
          Ok(w) => w,
          Err(_) => { thread::sleep(Duration::from_millis(500)); continue; }
        };
        *shared.writer.lock().expect("runtime writer poisoned") = Some(writer);
        let _ = app.emit("runtime.connected", json!({ "pipe": CORE_PIPE }));
        let _ = send_pipe_message(&shared.writer, &json!({ "type": "runtime.snapshot.request" }));

        let reader = BufReader::new(file);
        for line in reader.lines() {
          let Ok(line) = line else { break; };
          let Ok(message) = serde_json::from_str::<Value>(&line) else { continue; };
          match message.get("type").and_then(Value::as_str) {
            Some("runtime.snapshot") => {
              if let Some(payload) = message.get("payload") {
                if let Some(presence_value) = payload.get("presence") {
                  if let Ok(presence) = serde_json::from_value::<PresenceSnapshot>(presence_value.clone()) {
                    let mut snapshot = shared.snapshot.lock().expect("runtime state poisoned");
                    snapshot.lifecycle = "READY".into();
                    snapshot.presence = presence;
                    let _ = app.emit("runtime.snapshot", &*snapshot);
                  }
                }
              }
            }
            Some("runtime.presence.changed") => {
              if let Some(payload) = message.get("payload") {
                if let Ok(presence) = serde_json::from_value::<PresenceSnapshot>(payload.clone()) {
                  let mut snapshot = shared.snapshot.lock().expect("runtime state poisoned");
                  if presence.revision > snapshot.presence.revision {
                    snapshot.presence = presence.clone();
                    let _ = app.emit("runtime.presence.changed", &presence);
                  }
                }
              }
            }
            _ => {}
          }
        }
      }
      Err(_) => {}
    }

    *shared.writer.lock().expect("runtime writer poisoned") = None;
    {
      let mut snapshot = shared.snapshot.lock().expect("runtime state poisoned");
      snapshot.lifecycle = "DEGRADED".into();
      snapshot.presence.revision = snapshot.presence.revision.saturating_add(1);
      snapshot.presence.state = "OFFLINE".into();
      snapshot.presence.reason = "runtime.ipc.disconnected".into();
      let _ = app.emit("runtime.disconnected", json!({ "reason": "RUNTIME.IPC.DISCONNECTED" }));
      let _ = app.emit("runtime.snapshot", &*snapshot);
    }
    thread::sleep(Duration::from_millis(750));
  });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let runtime = Arc::new(RuntimeState {
    snapshot: Mutex::new(RuntimeSnapshot {
      lifecycle: "STARTING".into(),
      presence: PresenceSnapshot { revision: 0, state: "OFFLINE".into(), reason: "runtime.not_connected".into() },
      microphone_state: "ENABLED".into(),
    }),
    writer: Mutex::new(None),
  });

  tauri::Builder::default()
    .manage(runtime.clone())
    .invoke_handler(tauri::generate_handler![runtime_get_snapshot, runtime_set_microphone_enabled])
    .plugin(tauri_plugin_single_instance::init(|app, _, _| {
      if let Some(window) = app.get_webview_window("core") {
        let _ = window.show();
        let _ = window.set_focus();
      }
    }))
    .plugin(tauri_plugin_autostart::Builder::new().build())
    .setup(move |app| {
      start_core_ipc(app.handle().clone(), runtime.clone());
      let show = MenuItem::with_id(app, "show", "Birdie anzeigen", true, None::<&str>)?;
      let hide = MenuItem::with_id(app, "hide", "Birdie verbergen", true, None::<&str>)?;
      let quit = MenuItem::with_id(app, "quit", "Birdie beenden", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
      TrayIconBuilder::new().menu(&menu).on_menu_event(|app, event| {
        match event.id.as_ref() {
          "show" => if let Some(w) = app.get_webview_window("core") { let _ = w.show(); },
          "hide" => if let Some(w) = app.get_webview_window("core") { let _ = w.hide(); },
          "quit" => app.exit(0),
          _ => {}
        }
      }).build(app)?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("Birdie desktop runtime failed");
}
