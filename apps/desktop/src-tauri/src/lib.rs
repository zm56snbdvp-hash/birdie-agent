mod process_supervisor;

use process_supervisor::ProcessSupervisor;
use std::{
  env,
  fs::{File, OpenOptions},
  io::{BufRead, BufReader, Write},
  path::PathBuf,
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
const BUILD_ID: &str = match option_env!("BIRDIE_DESKTOP_BUILD_ID") {
  Some(value) => value,
  None => "development-unversioned",
};
pub(crate) const EVENT_RUNTIME_PRESENCE_CHANGED: &str =
  "runtime:presence-changed";
pub(crate) const EVENT_RUNTIME_SNAPSHOT: &str = "runtime:snapshot";
pub(crate) const EVENT_RUNTIME_DISCONNECTED: &str = "runtime:disconnected";
pub(crate) const EVENT_RUNTIME_CONNECTED: &str = "runtime:connected";
pub(crate) const EVENT_RUNTIME_AUDIO_INPUT: &str = "runtime:audio-input";
pub(crate) const EVENT_RUNTIME_AUDIO_OUTPUT: &str = "runtime:audio-output";
pub(crate) const EVENT_RUNTIME_IPC_ERROR: &str = "runtime:ipc-error";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresenceSnapshot {
  revision: u64,
  state: String,
  #[serde(default)]
  reason: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSnapshot {
  #[serde(default = "default_lifecycle")]
  lifecycle: String,
  presence: PresenceSnapshot,
  #[serde(default = "default_microphone_state")]
  microphone_state: String,
  #[serde(default = "default_brain_state")]
  brain_state: String,
  #[serde(default)]
  bridge_revision: u64,
}

fn default_lifecycle() -> String {
  "READY".into()
}

fn default_microphone_state() -> String {
  "UNAVAILABLE".into()
}

fn default_brain_state() -> String {
  "UNAVAILABLE".into()
}

struct DiagnosticLog {
  path: PathBuf,
  file: Mutex<File>,
}

impl DiagnosticLog {
  fn open() -> Result<Self, String> {
    let path = env::var_os("BIRDIE_DESKTOP_DIAGNOSTIC_LOG")
      .map(PathBuf::from)
      .unwrap_or_else(default_diagnostic_path);
    if let Some(parent) = path.parent() {
      std::fs::create_dir_all(parent).map_err(|error| {
        format!(
          "DESKTOP.DIAGNOSTIC.CREATE_DIR_FAILED path={} error={error}",
          parent.display(),
        )
      })?;
    }
    let file = OpenOptions::new()
      .create(true)
      .append(true)
      .open(&path)
      .map_err(|error| {
        format!(
          "DESKTOP.DIAGNOSTIC.OPEN_FAILED path={} error={error}",
          path.display(),
        )
      })?;
    Ok(Self {
      path,
      file: Mutex::new(file),
    })
  }

  fn append(&self, event: &str, detail: impl AsRef<str>) {
    let timestamp = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|duration| duration.as_millis())
      .unwrap_or(0);
    let detail = compact_detail(detail.as_ref());
    let line = format!("{timestamp} {event} {detail}\n");
    let mut file = self.file.lock().unwrap_or_else(|_| {
      panic!(
        "DESKTOP.DIAGNOSTIC.LOCK_POISONED path={}",
        self.path.display(),
      )
    });
    file.write_all(line.as_bytes()).unwrap_or_else(|error| {
      panic!(
        "DESKTOP.DIAGNOSTIC.WRITE_FAILED path={} error={error}",
        self.path.display(),
      )
    });
    file.flush().unwrap_or_else(|error| {
      panic!(
        "DESKTOP.DIAGNOSTIC.FLUSH_FAILED path={} error={error}",
        self.path.display(),
      )
    });
  }
}

fn default_diagnostic_path() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("../../..")
    .join(".birdie/logs/desktop-runtime-diagnostic.log")
}

fn compact_detail(detail: &str) -> String {
  detail
    .replace('\r', " ")
    .replace('\n', " ")
    .chars()
    .take(2_000)
    .collect()
}

fn snapshot_summary(snapshot: &RuntimeSnapshot) -> String {
  format!(
    "bridgeRevision={} lifecycle={} presence.state={} presence.revision={} microphoneState={} brainState={}",
    snapshot.bridge_revision,
    snapshot.lifecycle,
    snapshot.presence.state,
    snapshot.presence.revision,
    snapshot.microphone_state,
    snapshot.brain_state,
  )
}

fn replace_authoritative_snapshot(
  current: &mut RuntimeSnapshot,
  mut next: RuntimeSnapshot,
) {
  next.bridge_revision = current.bridge_revision.saturating_add(1);
  *current = next;
}

fn transition_to_disconnected(snapshot: &mut RuntimeSnapshot) {
  snapshot.bridge_revision = snapshot.bridge_revision.saturating_add(1);
  snapshot.lifecycle = "DEGRADED".into();
  snapshot.microphone_state = "UNAVAILABLE".into();
  snapshot.presence.state = "OFFLINE".into();
  snapshot.presence.reason = "runtime.ipc.disconnected".into();
}

struct RuntimeState {
  snapshot: Mutex<RuntimeSnapshot>,
  writer: Mutex<Option<std::fs::File>>,
  diagnostic: DiagnosticLog,
}

#[tauri::command]
fn runtime_get_snapshot(
  state: State<'_, RuntimeState>,
  last_revision: i64,
) -> RuntimeSnapshot {
  state.diagnostic.append(
    "TAURI_INVOKE",
    format!("command=runtime_get_snapshot lastRevision={last_revision}"),
  );
  let snapshot = state
    .snapshot
    .lock()
    .expect("runtime state poisoned")
    .clone();
  state.diagnostic.append(
    "TAURI_INVOKE_RESULT",
    format!("command=runtime_get_snapshot {}", snapshot_summary(&snapshot)),
  );
  snapshot
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
  state.diagnostic.append(
    "TAURI_INVOKE",
    format!("command=runtime_set_microphone_enabled enabled={enabled}"),
  );
  let result = send_pipe_message(&state.writer, &command);
  match &result {
    Ok(()) => state.diagnostic.append(
      "TAURI_INVOKE_RESULT",
      "command=runtime_set_microphone_enabled result=OK",
    ),
    Err(error) => state.diagnostic.append(
      "ERROR",
      format!("stage=runtime_set_microphone_enabled error={error}"),
    ),
  }
  result
}

#[tauri::command]
fn runtime_log_frontend(
  state: State<'_, RuntimeState>,
  stage: String,
  detail: String,
) {
  state.diagnostic.append(&stage, format!("source=js {detail}"));
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
    transition_to_disconnected(&mut snapshot);
    snapshot.clone()
  };

  app.state::<RuntimeState>().diagnostic.append(
    "RUNTIME_DISCONNECTED",
    snapshot_summary(&snapshot),
  );

  if let Err(error) = app.emit(
    EVENT_RUNTIME_DISCONNECTED,
    json!({
      "reason": "RUNTIME.IPC.DISCONNECTED",
      "bridgeRevision": snapshot.bridge_revision,
    }),
  ) {
    app.state::<RuntimeState>().diagnostic.append(
      "ERROR",
      format!("stage=emit.runtime.disconnected error={error}"),
    );
  }
  if let Err(error) = app.emit(EVENT_RUNTIME_SNAPSHOT, snapshot) {
    app.state::<RuntimeState>().diagnostic.append(
      "ERROR",
      format!("stage=emit.runtime.snapshot.disconnected error={error}"),
    );
  }
}

fn start_core_ipc(app: tauri::AppHandle) {
  thread::spawn(move || {
    let mut attempt = 0_u64;
    loop {
      attempt = attempt.saturating_add(1);
      app.state::<RuntimeState>().diagnostic.append(
        "PIPE_CONNECT_ATTEMPT",
        format!("attempt={attempt} pipe={CORE_PIPE}"),
      );
      let mut opened_session = false;

      match OpenOptions::new().read(true).write(true).open(CORE_PIPE) {
        Ok(file) => {
          opened_session = true;
          app.state::<RuntimeState>().diagnostic.append(
            "PIPE_CONNECTED",
            format!("attempt={attempt} pipe={CORE_PIPE}"),
          );
          let writer = match file.try_clone() {
            Ok(writer) => writer,
            Err(error) => {
              app.state::<RuntimeState>().diagnostic.append(
                "ERROR",
                format!("stage=pipe.try_clone error={error}"),
              );
              clear_runtime_writer(&app);
              mark_runtime_disconnected(&app);
              thread::sleep(Duration::from_millis(750));
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
          match hello_result {
            Ok(()) => app.state::<RuntimeState>().diagnostic.append(
              "HELLO_SENT",
              format!(
                "component=birdie-desktop role=desktop contractVersion={CONTRACT_VERSION}"
              ),
            ),
            Err(error) => {
              app.state::<RuntimeState>().diagnostic.append(
                "ERROR",
                format!("stage=hello.write error={error}"),
              );
              clear_runtime_writer(&app);
              mark_runtime_disconnected(&app);
              thread::sleep(Duration::from_millis(750));
              continue;
            }
          }

          let reader = BufReader::new(file);
          for line_result in reader.lines() {
            let line = match line_result {
              Ok(line) => line,
              Err(error) => {
                app.state::<RuntimeState>().diagnostic.append(
                  "ERROR",
                  format!("stage=pipe.read error={error}"),
                );
                break;
              }
            };
            let message = match serde_json::from_str::<Value>(&line) {
              Ok(message) => message,
              Err(error) => {
                app.state::<RuntimeState>().diagnostic.append(
                  "ERROR",
                  format!(
                    "stage=pipe.json error={error} line={}",
                    compact_detail(&line)
                  ),
                );
                continue;
              }
            };

            match message.get("type").and_then(Value::as_str) {
              Some("component.hello.ack") => {
                let accepted = message
                  .pointer("/payload/accepted")
                  .and_then(Value::as_bool)
                  .unwrap_or(false);
                app.state::<RuntimeState>().diagnostic.append(
                  "HELLO_ACK",
                  format!("accepted={accepted} payload={}", message["payload"]),
                );
                if accepted {
                  if let Err(error) = app.emit(
                    EVENT_RUNTIME_CONNECTED,
                    json!({
                      "pipe": CORE_PIPE,
                      "contractVersion": CONTRACT_VERSION,
                      "role": "desktop",
                    }),
                  ) {
                    app.state::<RuntimeState>().diagnostic.append(
                      "ERROR",
                      format!("stage=emit.runtime.connected error={error}"),
                    );
                  }
                  let runtime = app.state::<RuntimeState>();
                  match send_pipe_message(
                    &runtime.writer,
                    &desktop_snapshot_request(),
                  ) {
                    Ok(()) => runtime.diagnostic.append(
                      "SNAPSHOT_REQUEST_SENT",
                      "type=runtime.snapshot.request",
                    ),
                    Err(error) => runtime.diagnostic.append(
                      "ERROR",
                      format!("stage=snapshot.request error={error}"),
                    ),
                  }
                } else {
                  app.state::<RuntimeState>().diagnostic.append(
                    "ERROR",
                    "stage=hello.ack error=CONTRACT.HELLO_REJECTED",
                  );
                }
              }
              Some("runtime.snapshot") => {
                if let Some(payload) = message.get("payload") {
                  app.state::<RuntimeState>().diagnostic.append(
                    "SNAPSHOT_RECEIVED",
                    format!("payload={payload}"),
                  );
                  match serde_json::from_value::<RuntimeSnapshot>(payload.clone()) {
                    Ok(next) => {
                      let snapshot = {
                        let runtime = app.state::<RuntimeState>();
                        let mut snapshot = runtime
                          .snapshot
                          .lock()
                          .expect("runtime state poisoned");
                        replace_authoritative_snapshot(&mut snapshot, next);
                        snapshot.clone()
                      };
                      app.state::<RuntimeState>().diagnostic.append(
                        "RUST_STATE_UPDATED",
                        snapshot_summary(&snapshot),
                      );
                      if let Err(error) = app.emit(EVENT_RUNTIME_SNAPSHOT, snapshot) {
                        app.state::<RuntimeState>().diagnostic.append(
                          "ERROR",
                          format!("stage=emit.runtime.snapshot error={error}"),
                        );
                      }
                    }
                    Err(error) => app.state::<RuntimeState>().diagnostic.append(
                      "ERROR",
                      format!("stage=snapshot.deserialize error={error} payload={payload}"),
                    ),
                  }
                }
              }
              Some("runtime.presence.changed") => {
                if let Some(payload) = message.get("payload") {
                  match serde_json::from_value::<PresenceSnapshot>(payload.clone()) {
                    Ok(presence) => {
                      let changed = {
                        let runtime = app.state::<RuntimeState>();
                        let mut snapshot = runtime
                          .snapshot
                          .lock()
                          .expect("runtime state poisoned");
                        if presence.revision > snapshot.presence.revision {
                          snapshot.presence = presence.clone();
                          snapshot.bridge_revision =
                            snapshot.bridge_revision.saturating_add(1);
                          Some(snapshot.bridge_revision)
                        } else {
                          None
                        }
                      };
                      if let Some(bridge_revision) = changed {
                        if let Err(error) = app.emit(
                            EVENT_RUNTIME_PRESENCE_CHANGED,
                          json!({
                            "snapshot": presence,
                            "bridgeRevision": bridge_revision,
                          }),
                        ) {
                          app.state::<RuntimeState>().diagnostic.append(
                            "ERROR",
                            format!("stage=emit.runtime.presence.changed error={error}"),
                          );
                        }
                      }
                    }
                    Err(error) => app.state::<RuntimeState>().diagnostic.append(
                      "ERROR",
                      format!("stage=presence.deserialize error={error} payload={payload}"),
                    ),
                  }
                }
              }
              Some("runtime.audio.input") => {
                if let Some(payload) = message.get("payload") {
                  if let Err(error) = app.emit(EVENT_RUNTIME_AUDIO_INPUT, payload.clone()) {
                    app.state::<RuntimeState>().diagnostic.append(
                      "ERROR",
                      format!("stage=emit.runtime.audio.input error={error}"),
                    );
                  }
                }
              }
              Some("runtime.audio.output") => {
                if let Some(payload) = message.get("payload") {
                  if let Err(error) = app.emit(EVENT_RUNTIME_AUDIO_OUTPUT, payload.clone()) {
                    app.state::<RuntimeState>().diagnostic.append(
                      "ERROR",
                      format!("stage=emit.runtime.audio.output error={error}"),
                    );
                  }
                }
              }
              Some("runtime.command.ack") => {
                app.state::<RuntimeState>().diagnostic.append(
                  "RUNTIME_COMMAND_ACK",
                  format!("payload={}", message["payload"]),
                );
              }
              Some("error") => {
                let error = message
                  .get("error")
                  .and_then(Value::as_str)
                  .unwrap_or("RUNTIME.IPC.ERROR");
                app.state::<RuntimeState>().diagnostic.append(
                  "ERROR",
                  format!("stage=core.message error={error} message={message}"),
                );
                if let Err(emit_error) = app.emit(
                  EVENT_RUNTIME_IPC_ERROR,
                  json!({ "error": error }),
                ) {
                  app.state::<RuntimeState>().diagnostic.append(
                    "ERROR",
                    format!("stage=emit.runtime.ipc.error error={emit_error}"),
                  );
                }
                if error.starts_with("CONTRACT.") {
                  break;
                }
              }
              Some(message_type) => app.state::<RuntimeState>().diagnostic.append(
                "ERROR",
                format!("stage=pipe.message error=UNKNOWN_TYPE type={message_type}"),
              ),
              None => app.state::<RuntimeState>().diagnostic.append(
                "ERROR",
                format!("stage=pipe.message error=MISSING_TYPE message={message}"),
              ),
            }
          }
          app.state::<RuntimeState>().diagnostic.append(
            "ERROR",
            "stage=pipe.read error=EOF",
          );
        }
        Err(error) => app.state::<RuntimeState>().diagnostic.append(
          "ERROR",
          format!("stage=pipe.open attempt={attempt} error={error}"),
        ),
      }

      clear_runtime_writer(&app);
      if opened_session {
        mark_runtime_disconnected(&app);
      }
      thread::sleep(Duration::from_millis(750));
    }
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

fn place_on_primary_monitor(
  window: &tauri::WebviewWindow,
) -> tauri::Result<Option<String>> {
  let Some(monitor) = window.primary_monitor()? else {
    return Ok(None);
  };
  let position = monitor.position().to_owned();
  let size = monitor.size().to_owned();
  let position_changed = window.outer_position()? != position;
  let size_changed = window.outer_size()? != size;
  if position_changed {
    window.set_position(position.to_owned())?;
  }
  if size_changed {
    window.set_size(size.to_owned())?;
  }
  Ok(Some(format!(
    "position={}x{} size={}x{} changed={}",
    position.x,
    position.y,
    size.width,
    size.height,
    position_changed || size_changed,
  )))
}

fn report_window_error(
  app: &tauri::AppHandle,
  stage: &str,
  error: impl std::fmt::Display,
) {
  app.state::<RuntimeState>().diagnostic.append(
    "ERROR",
    format!("stage={stage} error={error}"),
  );
}

fn force_overlay_fail_closed(
  app: &tauri::AppHandle,
  window: &tauri::WebviewWindow,
  context: &str,
) {
  if let Err(error) = window.set_ignore_cursor_events(true) {
    report_window_error(
      app,
      &format!("{context}.rollback.pass_through"),
      error,
    );
  }
  if let Err(error) = window.set_focusable(false) {
    report_window_error(
      app,
      &format!("{context}.rollback.focusable"),
      error,
    );
  }
  if let Err(error) = window.hide() {
    report_window_error(app, &format!("{context}.rollback.hide"), &error);
    if let Err(close_error) = window.close() {
      report_window_error(
        app,
        &format!("{context}.rollback.close"),
        close_error,
      );
      app.exit(70);
    }
  }
  app.state::<RuntimeState>().diagnostic.append(
    "WINDOW_INTERACTION_FAIL_CLOSED",
    format!("context={context} action=HIDE_OR_CLOSE"),
  );
}

fn fail_overlay_transition(
  app: &tauri::AppHandle,
  window: &tauri::WebviewWindow,
  stage: &str,
  code: &str,
  error: impl std::fmt::Display,
) -> Result<(), String> {
  let detail = error.to_string();
  report_window_error(app, stage, &detail);
  force_overlay_fail_closed(app, window, stage);
  Err(format!("{code}:{detail}"))
}

fn set_overlay_interaction_mode(
  app: &tauri::AppHandle,
  enabled: bool,
) -> Result<(), String> {
  let window = app
    .get_webview_window("core")
    .ok_or_else(|| "DESKTOP.WINDOW.CORE_MISSING".to_string())?;

  if enabled {
    if let Err(error) = window.set_focusable(true) {
      return fail_overlay_transition(
        app,
        &window,
        "window.focusable.enable",
        "DESKTOP.WINDOW.FOCUSABLE_ENABLE_FAILED",
        error,
      );
    }
    if let Err(error) = window.set_ignore_cursor_events(false) {
      return fail_overlay_transition(
        app,
        &window,
        "window.pass_through.disable",
        "DESKTOP.WINDOW.CONTROL_ENABLE_FAILED",
        error,
      );
    }
    if let Err(error) = window.show() {
      return fail_overlay_transition(
        app,
        &window,
        "window.control.show",
        "DESKTOP.WINDOW.CONTROL_SHOW_FAILED",
        error,
      );
    }
    if let Err(error) = window.set_focus() {
      return fail_overlay_transition(
        app,
        &window,
        "window.control.focus",
        "DESKTOP.WINDOW.CONTROL_FOCUS_FAILED",
        error,
      );
    }
    app.state::<RuntimeState>().diagnostic.append(
      "WINDOW_INTERACTION_MODE",
      "mode=CONTROL cursorEvents=ENABLED",
    );
    return Ok(());
  }

  if let Err(error) = window.set_ignore_cursor_events(true) {
    return fail_overlay_transition(
      app,
      &window,
      "window.pass_through.enable",
      "DESKTOP.WINDOW.PASS_THROUGH_FAILED",
      error,
    );
  }
  if let Err(error) = window.set_focusable(false) {
    return fail_overlay_transition(
      app,
      &window,
      "window.focusable.disable",
      "DESKTOP.WINDOW.FOCUSABLE_DISABLE_FAILED",
      error,
    );
  }
  if let Err(error) = window.show() {
    return fail_overlay_transition(
      app,
      &window,
      "window.ambient.show",
      "DESKTOP.WINDOW.AMBIENT_SHOW_FAILED",
      error,
    );
  }
  if let Err(error) =
    window.eval("window.__birdieSetInteractionMode?.(false);")
  {
    report_window_error(app, "window.ambient.renderer_sync", error);
  }
  app.state::<RuntimeState>().diagnostic.append(
    "WINDOW_INTERACTION_MODE",
    "mode=AMBIENT cursorEvents=IGNORED",
  );
  Ok(())
}

#[tauri::command]
fn desktop_set_interaction_mode(
  app: tauri::AppHandle,
  enabled: bool,
) -> Result<(), String> {
  set_overlay_interaction_mode(&app, enabled)
}

fn reset_overlay_after_page_load(app: &tauri::AppHandle) {
  let Some(window) = app.get_webview_window("core") else {
    report_window_error(app, "window.page_load.lookup", "core window missing");
    return;
  };

  let was_visible = match window.is_visible() {
    Ok(visible) => visible,
    Err(error) => {
      report_window_error(app, "window.page_load.visibility", error);
      false
    }
  };
  if let Err(error) = window.set_ignore_cursor_events(true) {
    let _ = fail_overlay_transition(
      app,
      &window,
      "window.page_load.pass_through",
      "DESKTOP.WINDOW.PAGE_LOAD_PASS_THROUGH_FAILED",
      error,
    );
    return;
  }
  if let Err(error) = window.set_focusable(false) {
    let _ = fail_overlay_transition(
      app,
      &window,
      "window.page_load.focusable",
      "DESKTOP.WINDOW.PAGE_LOAD_FOCUSABLE_FAILED",
      error,
    );
    return;
  }
  if let Err(error) =
    window.eval("window.__birdieSetInteractionMode?.(false);")
  {
    report_window_error(app, "window.page_load.renderer_sync", error);
  }
  app.state::<RuntimeState>().diagnostic.append(
    "WINDOW_PAGE_LOAD_RESET",
    format!("mode=AMBIENT visibilityPreserved={was_visible}"),
  );
}

fn prepare_immersive_window(app: &tauri::AppHandle) {
  let Some(window) = app.get_webview_window("core") else {
    report_window_error(app, "window.lookup", "core window missing");
    return;
  };

  let _ = window.set_fullscreen(false);
  match place_on_primary_monitor(&window) {
    Ok(Some(detail)) => app.state::<RuntimeState>().diagnostic.append(
      "WINDOW_IMMERSIVE_READY",
      format!("mode=PRIMARY_MONITOR {detail}"),
    ),
    Ok(None) => match window.set_fullscreen(true) {
      Ok(()) => app.state::<RuntimeState>().diagnostic.append(
        "WINDOW_IMMERSIVE_READY",
        "mode=CURRENT_MONITOR_FULLSCREEN fallback=NO_PRIMARY_MONITOR",
      ),
      Err(error) => report_window_error(app, "window.fullscreen.fallback", error),
    },
    Err(error) => {
      report_window_error(app, "window.primary_monitor", error);
      if let Err(fallback_error) = window.set_fullscreen(true) {
        report_window_error(
          app,
          "window.fullscreen.fallback",
          fallback_error,
        );
      }
    }
  }

  let _ = set_overlay_interaction_mode(app, false);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let diagnostic = DiagnosticLog::open()
    .unwrap_or_else(|error| panic!("{error}"));
  diagnostic.append(
    "DESKTOP_START",
    format!("pid={} buildId={BUILD_ID}", std::process::id()),
  );
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
        brain_state: "UNAVAILABLE".into(),
        bridge_revision: 0,
      }),
      writer: Mutex::new(None),
      diagnostic,
    })
    .invoke_handler(tauri::generate_handler![
      runtime_get_snapshot,
      runtime_set_microphone_enabled,
      runtime_log_frontend,
      desktop_set_interaction_mode,
    ])
    .on_page_load(|webview, _payload| {
      if webview.label() == "core" {
        reset_overlay_after_page_load(webview.app_handle());
      }
    })
    .on_window_event(|window, event| {
      if window.label() != "core"
        || !matches!(
          event,
          tauri::WindowEvent::Resized(_)
            | tauri::WindowEvent::Moved(_)
            | tauri::WindowEvent::ScaleFactorChanged { .. }
        )
      {
        return;
      }
      let app = window.app_handle();
      if let Some(core) = app.get_webview_window("core") {
        if let Err(error) = place_on_primary_monitor(&core) {
          report_window_error(app, "window.monitor_change", error);
        }
      }
    })
    .plugin(tauri_plugin_single_instance::init(|app, _, _| {
      prepare_immersive_window(app);
    }))
    .plugin(tauri_plugin_autostart::Builder::new().build())
    .setup(|app| {
      let supervisor = ProcessSupervisor::start(app.handle().clone());
      let _ = app.manage(supervisor);
      start_core_ipc(app.handle().clone());
      recover_dev_webview(app.handle().clone());
      prepare_immersive_window(app.handle());

      let show = MenuItem::with_id(
        app,
        "show",
        "Birdie anzeigen",
        true,
        None::<&str>,
      )?;
      let interact = MenuItem::with_id(
        app,
        "interact",
        "Birdie bedienen",
        true,
        None::<&str>,
      )?;
      let passive = MenuItem::with_id(
        app,
        "passive",
        "Präsenzmodus",
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
      let menu = Menu::with_items(
        app,
        &[&show, &interact, &passive, &hide, &quit],
      )?;
      TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "show" => {
            prepare_immersive_window(app);
          }
          "interact" => {
            if let Some(window) = app.get_webview_window("core") {
              if let Err(error) = window.eval(
                "window.__birdieRequestControlMode?.();",
              ) {
                report_window_error(app, "window.control.request", error);
              }
            }
          }
          "passive" => {
            let _ = set_overlay_interaction_mode(app, false);
          }
          "hide" => {
            let _ = set_overlay_interaction_mode(app, false);
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

#[cfg(test)]
mod tests {
  use super::*;

  fn ready_snapshot(core_revision: u64, bridge_revision: u64) -> RuntimeSnapshot {
    RuntimeSnapshot {
      lifecycle: "READY".into(),
      presence: PresenceSnapshot {
        revision: core_revision,
        state: "IDLE".into(),
        reason: "runtime.required_components_ready".into(),
      },
      microphone_state: "ENABLED".into(),
      brain_state: "READY".into(),
      bridge_revision,
    }
  }

  #[test]
  fn real_core_ready_snapshot_deserializes_and_keeps_required_fields() {
    let payload = json!({
      "lifecycle": "READY",
      "presence": {
        "revision": 7,
        "state": "IDLE",
        "reason": "runtime.required_components_ready",
        "since": "2026-08-26T20:00:00.000Z",
        "activeTurnId": null,
        "microphone": "ENABLED",
        "connectivity": "CONNECTED"
      },
      "activeTurn": null,
      "microphoneState": "ENABLED",
      "brainState": "READY",
      "futureCoreField": { "allowed": true }
    });

    let snapshot: RuntimeSnapshot =
      serde_json::from_value(payload).expect("Core snapshot must deserialize");
    assert_eq!(snapshot.lifecycle, "READY");
    assert_eq!(snapshot.presence.state, "IDLE");
    assert_eq!(snapshot.presence.revision, 7);
    assert_eq!(snapshot.microphone_state, "ENABLED");
    assert_eq!(snapshot.brain_state, "READY");
    assert_eq!(snapshot.bridge_revision, 0);

    let encoded = serde_json::to_value(&snapshot).expect("snapshot must serialize");
    assert_eq!(encoded["microphoneState"], "ENABLED");
    assert_eq!(encoded["brainState"], "READY");
    assert_eq!(encoded["bridgeRevision"], 0);
    assert!(encoded.get("microphone_state").is_none());
  }

  #[test]
  fn authoritative_snapshot_advances_bridge_revision_without_rewriting_core_revision() {
    let mut current = ready_snapshot(9, 12);
    let next = ready_snapshot(2, 0);

    replace_authoritative_snapshot(&mut current, next);

    assert_eq!(current.bridge_revision, 13);
    assert_eq!(current.presence.revision, 2);
    assert_eq!(current.presence.state, "IDLE");
    assert_eq!(current.microphone_state, "ENABLED");
  }

  #[test]
  fn disconnect_and_reconnect_use_bridge_revision_not_core_revision() {
    let mut snapshot = ready_snapshot(9, 40);

    transition_to_disconnected(&mut snapshot);
    assert_eq!(snapshot.bridge_revision, 41);
    assert_eq!(snapshot.presence.revision, 9);
    assert_eq!(snapshot.presence.state, "OFFLINE");
    assert_eq!(snapshot.microphone_state, "UNAVAILABLE");

    replace_authoritative_snapshot(&mut snapshot, ready_snapshot(2, 0));
    assert_eq!(snapshot.bridge_revision, 42);
    assert_eq!(snapshot.presence.revision, 2);
    assert_eq!(snapshot.presence.state, "IDLE");
    assert_eq!(snapshot.microphone_state, "ENABLED");
  }

  #[test]
  fn desktop_handshake_and_snapshot_request_match_the_core_contract() {
    let hello = desktop_hello();
    assert_eq!(hello["type"], "component.hello");
    assert_eq!(hello["payload"]["component"], "birdie-desktop");
    assert_eq!(hello["payload"]["role"], "desktop");
    assert_eq!(hello["payload"]["contractVersion"], CONTRACT_VERSION);

    let request = desktop_snapshot_request();
    assert_eq!(request["type"], "runtime.snapshot.request");
    assert_eq!(request["payload"], json!({}));
  }

  #[test]
  fn emitted_event_names_satisfy_tauri_v2_grammar() {
    let names = [
      EVENT_RUNTIME_PRESENCE_CHANGED,
      EVENT_RUNTIME_SNAPSHOT,
      EVENT_RUNTIME_DISCONNECTED,
      EVENT_RUNTIME_CONNECTED,
      EVENT_RUNTIME_AUDIO_INPUT,
      EVENT_RUNTIME_AUDIO_OUTPUT,
      EVENT_RUNTIME_IPC_ERROR,
    ];
    for name in names {
      assert!(!name.is_empty());
      assert!(!name.contains('.'));
      assert!(name.chars().all(|character| {
        character.is_alphanumeric() || matches!(character, '-' | '/' | ':' | '_')
      }));
    }
  }
}
