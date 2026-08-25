use std::sync::Mutex;
use serde::Serialize;
use tauri::{Emitter, Manager, State, menu::{Menu, MenuItem}, tray::TrayIconBuilder};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PresenceSnapshot {
  revision: u64,
  state: String,
  reason: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSnapshot {
  lifecycle: String,
  presence: PresenceSnapshot,
  microphone_state: String,
}

struct RuntimeState(Mutex<RuntimeSnapshot>);

#[tauri::command]
fn runtime_get_snapshot(state: State<'_, RuntimeState>, _last_revision: i64) -> RuntimeSnapshot {
  state.0.lock().expect("runtime state poisoned").clone()
}

#[tauri::command]
fn runtime_set_microphone_enabled(app: tauri::AppHandle, state: State<'_, RuntimeState>, enabled: bool) -> RuntimeSnapshot {
  let mut snapshot = state.0.lock().expect("runtime state poisoned");
  snapshot.microphone_state = if enabled { "ENABLED".into() } else { "MUTED_BY_USER".into() };
  let result = snapshot.clone();
  let _ = app.emit("runtime.snapshot", &result);
  result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(RuntimeState(Mutex::new(RuntimeSnapshot {
      lifecycle: "STARTING".into(),
      presence: PresenceSnapshot { revision: 0, state: "OFFLINE".into(), reason: "runtime.not_connected".into() },
      microphone_state: "ENABLED".into(),
    })))
    .invoke_handler(tauri::generate_handler![runtime_get_snapshot, runtime_set_microphone_enabled])
    .plugin(tauri_plugin_single_instance::init(|app, _, _| {
      if let Some(window) = app.get_webview_window("core") {
        let _ = window.show();
        let _ = window.set_focus();
      }
    }))
    .plugin(tauri_plugin_autostart::Builder::new().build())
    .setup(|app| {
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
