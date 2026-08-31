mod desktop_commands;
mod local_store;
mod process_supervisor;
mod surface;

use desktop_commands::{
    CommandDisposition, CommandName, DesktopApp, DesktopCommand, DesktopCommandResult,
    DesktopExecutionLedger,
};
use local_store::{now_ms, CaptureEntry, FocusState, LocalStore};
use process_supervisor::ProcessSupervisor;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env,
    fs::{File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use surface::{DesktopMode, ModuleId, SurfaceSnapshot, SurfaceState};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, State,
};

const CONTRACT_VERSION: &str = "1.0";
const CORE_PIPE: &str = r"\\.\pipe\birdie.core.control.v1";
const BUILD_ID: &str = match option_env!("BIRDIE_DESKTOP_BUILD_ID") {
    Some(value) => value,
    None => "development-unversioned",
};
pub(crate) const EVENT_RUNTIME_PRESENCE_CHANGED: &str = "runtime:presence-changed";
pub(crate) const EVENT_RUNTIME_SNAPSHOT: &str = "runtime:snapshot";
pub(crate) const EVENT_RUNTIME_DISCONNECTED: &str = "runtime:disconnected";
pub(crate) const EVENT_RUNTIME_CONNECTED: &str = "runtime:connected";
pub(crate) const EVENT_RUNTIME_AUDIO_INPUT: &str = "runtime:audio-input";
pub(crate) const EVENT_RUNTIME_AUDIO_OUTPUT: &str = "runtime:audio-output";
pub(crate) const EVENT_RUNTIME_IPC_ERROR: &str = "runtime:ipc-error";
pub(crate) const EVENT_DESKTOP_SURFACE_CHANGED: &str = "desktop:surface-changed";
pub(crate) const EVENT_DESKTOP_COMMAND_STATUS: &str = "desktop:command-status";

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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemSnapshot {
    runtime_lifecycle: String,
    core_status: String,
    voice_status: String,
    microphone_state: String,
    presence_state: String,
    brain_state: String,
    ipc_state: String,
    connection_id: Option<String>,
    last_core_message_at: Option<u64>,
    mode: DesktopMode,
    active_module: Option<ModuleId>,
    global_shortcut_status: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DesktopCommandMessage {
    #[serde(rename = "type")]
    message_type: String,
    request_id: String,
    payload: DesktopCommand,
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
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Birdie")
        .join("logs")
        .join("desktop-runtime-diagnostic.log")
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

fn replace_authoritative_snapshot(current: &mut RuntimeSnapshot, mut next: RuntimeSnapshot) {
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
    instance_id: String,
    connection_id: Mutex<Option<String>>,
    ipc_state: Mutex<String>,
    last_core_message_at: AtomicU64,
    execution_ledger: Mutex<DesktopExecutionLedger>,
    diagnostic: DiagnosticLog,
}

#[tauri::command]
fn runtime_get_snapshot(state: State<'_, RuntimeState>, last_revision: i64) -> RuntimeSnapshot {
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
        format!(
            "command=runtime_get_snapshot {}",
            snapshot_summary(&snapshot)
        ),
    );
    snapshot
}

#[tauri::command]
fn runtime_get_system_snapshot(
    runtime: State<'_, RuntimeState>,
    surface: State<'_, SurfaceState>,
    supervisor: State<'_, ProcessSupervisor>,
) -> SystemSnapshot {
    let snapshot = runtime
        .snapshot
        .lock()
        .expect("runtime state poisoned")
        .clone();
    let ipc_state = runtime
        .ipc_state
        .lock()
        .expect("runtime IPC state poisoned")
        .clone();
    let connection_id = runtime
        .connection_id
        .lock()
        .expect("runtime connection state poisoned")
        .clone();
    let last_message = runtime.last_core_message_at.load(Ordering::Acquire);
    let surface = surface.snapshot();
    let core_process_status = supervisor.component_status("birdie-core");
    let core_status = if ipc_state == "CONNECTED" {
        "READY".into()
    } else if core_process_status == "RUNNING" {
        "RUNNING_NO_IPC".into()
    } else if core_process_status == "UNMANAGED" {
        if ipc_state == "CONNECTING" {
            "CONNECTING".into()
        } else {
            "OFFLINE".into()
        }
    } else {
        core_process_status
    };
    let voice_process_status = supervisor.component_status("birdie-voice");
    let voice_status = match voice_process_status.as_str() {
        "UNMANAGED" => match snapshot.microphone_state.as_str() {
            "ENABLED" | "MUTED_BY_USER" | "PERMISSION_DENIED" => "CONNECTED".into(),
            "UNAVAILABLE" => "UNAVAILABLE".into(),
            _ => "UNKNOWN".into(),
        },
        _ => voice_process_status,
    };
    SystemSnapshot {
        runtime_lifecycle: snapshot.lifecycle.clone(),
        core_status,
        voice_status,
        microphone_state: snapshot.microphone_state,
        presence_state: snapshot.presence.state,
        brain_state: snapshot.brain_state,
        ipc_state,
        connection_id,
        last_core_message_at: (last_message > 0).then_some(last_message),
        mode: surface.mode,
        active_module: surface.active_module,
        global_shortcut_status: surface.global_shortcut_status,
    }
}

fn set_runtime_microphone_enabled(state: &RuntimeState, enabled: bool) -> Result<(), String> {
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

fn stored_microphone_enabled(store: &LocalStore) -> bool {
    // A missing store uses LocalStore's backward-compatible default. A corrupt
    // or unreadable store cannot prove consent, so startup remains fail-closed.
    store.microphone_enabled().unwrap_or(false)
}

fn apply_microphone_preference(
    store: &LocalStore,
    runtime: &RuntimeState,
    supervisor: &ProcessSupervisor,
    enabled: bool,
) -> Result<(), String> {
    if enabled {
        let activation = if supervisor.manages_voice() {
            // The explicit tray action authorizes the managed worker to launch
            // with --mic. Sending the runtime command before Voice reconnects
            // would introduce an ordering race, so managed activation starts it
            // directly and persists only after the transition succeeds.
            supervisor.set_voice_enabled(true)
        } else {
            set_runtime_microphone_enabled(runtime, true)
        };
        activation?;

        if let Err(error) = store.save_microphone_enabled(true) {
            // Do not leave capture enabled when its consent cannot survive a
            // restart. Both paths are best-effort rollbacks to the safe state.
            if supervisor.manages_voice() {
                let _ = supervisor.set_voice_enabled(false);
            }
            let _ = set_runtime_microphone_enabled(runtime, false);
            return Err(format!("MICROPHONE.PREFERENCE_SAVE_FAILED:{error}"));
        }
        return Ok(());
    }

    // Persist Off before touching the process so even an interruption between
    // these operations prevents the next startup from spawning Voice with --mic.
    let persistence = store
        .save_microphone_enabled(false)
        .map(|_| ())
        .map_err(|error| format!("MICROPHONE.PREFERENCE_SAVE_FAILED:{error}"));
    let process_disable = if supervisor.manages_voice() {
        // Stop capture before a potentially blocking pipe round-trip. The
        // runtime command then preserves the existing Core-facing mute path;
        // its failure is safe because the managed process is already gated.
        let result = supervisor.set_voice_enabled(false);
        let _ = set_runtime_microphone_enabled(runtime, false);
        result
    } else {
        set_runtime_microphone_enabled(runtime, false)
    };

    match (persistence, process_disable) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
        (Err(persistence_error), Err(disable_error)) => {
            Err(format!("{persistence_error};{disable_error}"))
        }
    }
}

#[tauri::command]
fn runtime_set_microphone_enabled(
    state: State<'_, RuntimeState>,
    enabled: bool,
) -> Result<(), String> {
    set_runtime_microphone_enabled(state.inner(), enabled)
}

#[tauri::command]
fn runtime_submit_desktop_intent(
    state: State<'_, RuntimeState>,
    command_id: String,
    text: String,
    issued_at_ms: u64,
    expires_at_ms: u64,
) -> Result<Value, String> {
    if !valid_transport_id(&command_id) {
        return Err("DESKTOP.COMMAND.ID_INVALID".into());
    }
    let text = text.trim();
    if text.is_empty() || text.chars().count() > 500 {
        return Err("DESKTOP.INTENT.TEXT_INVALID".into());
    }
    let current = now_ms();
    if expires_at_ms <= issued_at_ms
        || expires_at_ms.saturating_sub(issued_at_ms) > 30_000
        || expires_at_ms <= current
        || issued_at_ms > current.saturating_add(5_000)
    {
        return Err("DESKTOP.COMMAND.DEADLINE_INVALID".into());
    }
    let message = json!({
      "type": "desktop.intent.submit",
      "requestId": format!("desktop-intent-{command_id}"),
      "payload": {
        "commandId": &command_id,
        "text": text,
        "issuedAtMs": issued_at_ms,
        "expiresAtMs": expires_at_ms,
      },
    });
    send_pipe_message(&state.writer, &message)?;
    Ok(json!({
      "commandId": command_id,
      "status": "SENT",
      "errorCode": Value::Null,
    }))
}

#[tauri::command]
fn focus_get_state(store: State<'_, LocalStore>) -> Result<FocusState, String> {
    store.focus()
}

#[tauri::command]
fn focus_save_state(store: State<'_, LocalStore>, state: FocusState) -> Result<FocusState, String> {
    store.save_focus(state)
}

#[tauri::command]
fn capture_list(store: State<'_, LocalStore>) -> Result<Vec<CaptureEntry>, String> {
    store.captures()
}

#[tauri::command]
fn capture_add(store: State<'_, LocalStore>, text: String) -> Result<CaptureEntry, String> {
    store.add_capture(text)
}

#[tauri::command]
fn capture_delete(store: State<'_, LocalStore>, id: String) -> Result<bool, String> {
    store.delete_capture(&id)
}

fn valid_transport_id(value: &str) -> bool {
    (8..=128).contains(&value.len())
        && value.chars().enumerate().all(|(index, character)| {
            character.is_ascii_alphanumeric()
                || (index > 0 && matches!(character, '.' | '_' | ':' | '-'))
        })
}

#[tauri::command]
fn runtime_log_frontend(state: State<'_, RuntimeState>, stage: String, detail: String) {
    state
        .diagnostic
        .append(&stage, format!("source=js {detail}"));
}

fn send_pipe_message(writer: &Mutex<Option<std::fs::File>>, value: &Value) -> Result<(), String> {
    let mut guard = writer
        .lock()
        .map_err(|_| "runtime writer poisoned".to_string())?;
    let file = guard
        .as_mut()
        .ok_or_else(|| "RUNTIME.IPC.DISCONNECTED".to_string())?;
    writeln!(file, "{}", value).map_err(|error| format!("RUNTIME.IPC.WRITE_FAILED:{error}"))?;
    file.flush()
        .map_err(|error| format!("RUNTIME.IPC.FLUSH_FAILED:{error}"))
}

fn desktop_hello() -> Value {
    let instance_id = desktop_instance_id();
    json!({
      "type": "component.hello",
      "requestId": format!("desktop-hello-{}", std::process::id()),
      "payload": {
        "component": "birdie-desktop",
        "role": "desktop",
        "instanceId": instance_id,
        "contractVersion": CONTRACT_VERSION,
      },
    })
}

fn desktop_instance_id() -> String {
    format!("birdie-desktop-{}", std::process::id())
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
    *runtime.writer.lock().expect("runtime writer poisoned") = None;
    *runtime
        .connection_id
        .lock()
        .expect("runtime connection state poisoned") = None;
    *runtime
        .ipc_state
        .lock()
        .expect("runtime IPC state poisoned") = "DISCONNECTED".into();
}

fn mark_runtime_disconnected(app: &tauri::AppHandle) {
    let snapshot = {
        let runtime = app.state::<RuntimeState>();
        let mut snapshot = runtime.snapshot.lock().expect("runtime state poisoned");
        transition_to_disconnected(&mut snapshot);
        snapshot.clone()
    };

    app.state::<RuntimeState>()
        .diagnostic
        .append("RUNTIME_DISCONNECTED", snapshot_summary(&snapshot));

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
            *app.state::<RuntimeState>()
                .ipc_state
                .lock()
                .expect("runtime IPC state poisoned") = "CONNECTING".into();
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
                            app.state::<RuntimeState>()
                                .diagnostic
                                .append("ERROR", format!("stage=pipe.try_clone error={error}"));
                            clear_runtime_writer(&app);
                            mark_runtime_disconnected(&app);
                            thread::sleep(Duration::from_millis(750));
                            continue;
                        }
                    };

                    {
                        let runtime = app.state::<RuntimeState>();
                        *runtime.writer.lock().expect("runtime writer poisoned") = Some(writer);
                    }

                    let hello_result = {
                        let runtime = app.state::<RuntimeState>();
                        send_pipe_message(&runtime.writer, &desktop_hello())
                    };
                    match hello_result {
            Ok(()) => app.state::<RuntimeState>().diagnostic.append(
              "HELLO_SENT",
              format!("component=birdie-desktop role=desktop contractVersion={CONTRACT_VERSION}"),
            ),
            Err(error) => {
              app
                .state::<RuntimeState>()
                .diagnostic
                .append("ERROR", format!("stage=hello.write error={error}"));
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
                                app.state::<RuntimeState>()
                                    .diagnostic
                                    .append("ERROR", format!("stage=pipe.read error={error}"));
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
                        app.state::<RuntimeState>()
                            .last_core_message_at
                            .store(now_ms(), Ordering::Release);

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
                                    let connection_id = message
                                        .pointer("/payload/connectionId")
                                        .and_then(Value::as_str)
                                        .filter(|value| valid_transport_id(value))
                                        .map(str::to_owned);
                                    let Some(connection_id) = connection_id else {
                                        app.state::<RuntimeState>().diagnostic.append(
                                            "ERROR",
                                            "stage=hello.ack error=CONTRACT.CONNECTION_ID_INVALID",
                                        );
                                        break;
                                    };
                                    {
                                        let runtime = app.state::<RuntimeState>();
                                        *runtime
                                            .connection_id
                                            .lock()
                                            .expect("runtime connection state poisoned") =
                                            Some(connection_id.clone());
                                        *runtime
                                            .ipc_state
                                            .lock()
                                            .expect("runtime IPC state poisoned") =
                                            "CONNECTED".into();
                                    }
                                    if let Err(error) = app.emit(
                                        EVENT_RUNTIME_CONNECTED,
                                        json!({
                                          "pipe": CORE_PIPE,
                                          "connectionId": connection_id,
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
                                    app.state::<RuntimeState>()
                                        .diagnostic
                                        .append("SNAPSHOT_RECEIVED", format!("payload={payload}"));
                                    match serde_json::from_value::<RuntimeSnapshot>(payload.clone()) {
                    Ok(next) => {
                      let snapshot = {
                        let runtime = app.state::<RuntimeState>();
                        let mut snapshot = runtime.snapshot.lock().expect("runtime state poisoned");
                        replace_authoritative_snapshot(&mut snapshot, next);
                        snapshot.clone()
                      };
                      app
                        .state::<RuntimeState>()
                        .diagnostic
                        .append("RUST_STATE_UPDATED", snapshot_summary(&snapshot));
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
                        let mut snapshot = runtime.snapshot.lock().expect("runtime state poisoned");
                        if presence.revision > snapshot.presence.revision {
                          snapshot.presence = presence.clone();
                          snapshot.bridge_revision = snapshot.bridge_revision.saturating_add(1);
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
                                    if let Err(error) =
                                        app.emit(EVENT_RUNTIME_AUDIO_INPUT, payload.clone())
                                    {
                                        app.state::<RuntimeState>().diagnostic.append(
                                            "ERROR",
                                            format!("stage=emit.runtime.audio.input error={error}"),
                                        );
                                    }
                                }
                            }
                            Some("runtime.audio.output") => {
                                if let Some(payload) = message.get("payload") {
                                    if let Err(error) =
                                        app.emit(EVENT_RUNTIME_AUDIO_OUTPUT, payload.clone())
                                    {
                                        app.state::<RuntimeState>().diagnostic.append(
                                            "ERROR",
                                            format!(
                                                "stage=emit.runtime.audio.output error={error}"
                                            ),
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
                            Some("desktop.command") => {
                                let parsed = serde_json::from_value::<DesktopCommandMessage>(
                                    message.clone(),
                                )
                                .map_err(|_| "DESKTOP.COMMAND.MESSAGE_SCHEMA_INVALID".to_string())
                                .and_then(|message| {
                                    if message.message_type != "desktop.command"
                                        || message.request_id != message.payload.command_id
                                    {
                                        return Err(
                                            "DESKTOP.COMMAND.CORRELATION_MISMATCH".to_string()
                                        );
                                    }
                                    Ok(message.payload)
                                });
                                let result = parsed
                                    .and_then(|command| execute_desktop_command(&app, command));
                                match result {
                                    Ok(result) => {
                                        let response = json!({
                                          "type": "desktop.command.result",
                                          "requestId": result.command_id.clone(),
                                          "payload": result,
                                        });
                                        let runtime = app.state::<RuntimeState>();
                                        if let Err(error) =
                                            send_pipe_message(&runtime.writer, &response)
                                        {
                                            runtime.diagnostic.append(
                                                "ERROR",
                                                format!(
                                                    "stage=desktop.command.result error={error}"
                                                ),
                                            );
                                        }
                                    }
                                    Err(error) => {
                                        app.state::<RuntimeState>().diagnostic.append(
                                            "ERROR",
                                            format!("stage=desktop.command.validate error={error}"),
                                        );
                                        reject_invalid_desktop_command_message(
                                            &app, &message, &error,
                                        );
                                    }
                                }
                            }
                            Some("desktop.intent.ack") | Some("desktop.command.status") => {
                                if let Some(payload) = message.get("payload") {
                                    if let Err(error) =
                                        app.emit(EVENT_DESKTOP_COMMAND_STATUS, payload.clone())
                                    {
                                        app.state::<RuntimeState>().diagnostic.append(
                                            "ERROR",
                                            format!(
                                                "stage=emit.desktop.command.status error={error}"
                                            ),
                                        );
                                    }
                                }
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
                                if let Err(emit_error) =
                                    app.emit(EVENT_RUNTIME_IPC_ERROR, json!({ "error": error }))
                                {
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
                                format!(
                                    "stage=pipe.message error=UNKNOWN_TYPE type={message_type}"
                                ),
                            ),
                            None => app.state::<RuntimeState>().diagnostic.append(
                                "ERROR",
                                format!("stage=pipe.message error=MISSING_TYPE message={message}"),
                            ),
                        }
                    }
                    app.state::<RuntimeState>()
                        .diagnostic
                        .append("ERROR", "stage=pipe.read error=EOF");
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

fn place_on_primary_monitor(window: &tauri::WebviewWindow) -> tauri::Result<Option<String>> {
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

fn report_window_error(app: &tauri::AppHandle, stage: &str, error: impl std::fmt::Display) {
    app.state::<RuntimeState>()
        .diagnostic
        .append("ERROR", format!("stage={stage} error={error}"));
}

fn force_overlay_fail_closed(app: &tauri::AppHandle, window: &tauri::WebviewWindow, context: &str) {
    if let Err(error) = window.set_ignore_cursor_events(true) {
        report_window_error(app, &format!("{context}.rollback.pass_through"), error);
    }
    if let Err(error) = window.set_focusable(false) {
        report_window_error(app, &format!("{context}.rollback.focusable"), error);
    }
    if let Err(error) = window.hide() {
        report_window_error(app, &format!("{context}.rollback.hide"), &error);
        if let Err(close_error) = window.close() {
            report_window_error(app, &format!("{context}.rollback.close"), close_error);
            app.exit(70);
        }
    }
    app.state::<RuntimeState>().diagnostic.append(
        "WINDOW_INTERACTION_FAIL_CLOSED",
        format!("context={context} action=HIDE_OR_CLOSE"),
    );
    let snapshot = app
        .state::<SurfaceState>()
        .transition(DesktopMode::Ambient, None);
    emit_surface_snapshot(app, &snapshot);
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

fn set_overlay_interaction_mode(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
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
    if let Err(error) = window.eval("window.__birdieSetInteractionMode?.(false);") {
        report_window_error(app, "window.ambient.renderer_sync", error);
    }
    app.state::<RuntimeState>().diagnostic.append(
        "WINDOW_INTERACTION_MODE",
        "mode=AMBIENT cursorEvents=IGNORED",
    );
    Ok(())
}

fn emit_surface_snapshot(app: &tauri::AppHandle, snapshot: &SurfaceSnapshot) {
    if let Err(error) = app.emit(EVENT_DESKTOP_SURFACE_CHANGED, snapshot.clone()) {
        report_window_error(app, "emit.desktop.surface.changed", error);
    }
}

fn apply_surface_transition(
    app: &tauri::AppHandle,
    mode: DesktopMode,
    active_module: Option<ModuleId>,
) -> Result<SurfaceSnapshot, String> {
    let surface = app.state::<SurfaceState>();
    let _transition = surface.lock_transition();
    set_overlay_interaction_mode(app, mode == DesktopMode::Control)?;
    let snapshot = surface.transition(mode, active_module);
    emit_surface_snapshot(app, &snapshot);
    Ok(snapshot)
}

fn compact_error_code(error: &str) -> String {
    error
        .split(':')
        .next()
        .unwrap_or("DESKTOP.COMMAND.EXECUTION_FAILED")
        .chars()
        .take(128)
        .collect()
}

fn launch_desktop_app(app_id: DesktopApp) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (program, args): (&str, &[&str]) = match app_id {
            // Explorer delegates URLs to the user's configured default browser.
            DesktopApp::Browser => ("explorer.exe", &["https://www.google.com"]),
            DesktopApp::Calculator => ("calc.exe", &[]),
            DesktopApp::Files => ("explorer.exe", &[]),
            DesktopApp::Notepad => ("notepad.exe", &[]),
            DesktopApp::Settings => ("explorer.exe", &["ms-settings:"]),
            DesktopApp::Terminal => ("powershell.exe", &["-NoLogo"]),
        };
        Command::new(program)
            .args(args)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("DESKTOP.APP.SPAWN_FAILED:{error}"))
    }
    #[cfg(not(windows))]
    {
        let _ = app_id;
        Err("DESKTOP.APP.UNSUPPORTED_PLATFORM".to_string())
    }
}

fn reject_invalid_desktop_command_message(
    app: &tauri::AppHandle,
    message: &Value,
    error_code: &str,
) {
    let Some(command_id) = message
        .get("payload")
        .and_then(|payload| payload.get("commandId"))
        .and_then(Value::as_str)
        .filter(|command_id| valid_transport_id(command_id))
    else {
        return;
    };
    let runtime = app.state::<RuntimeState>();
    let Some(connection_id) = runtime
        .connection_id
        .lock()
        .ok()
        .and_then(|connection_id| connection_id.clone())
    else {
        return;
    };
    let result = DesktopCommandResult::rejected_for_id(
        command_id,
        &connection_id,
        now_ms(),
        compact_error_code(error_code),
    );
    let response = json!({
      "type": "desktop.command.result",
      "requestId": command_id,
      "payload": result,
    });
    if let Err(error) = send_pipe_message(&runtime.writer, &response) {
        runtime.diagnostic.append(
            "ERROR",
            format!("stage=desktop.command.reject error={error}"),
        );
    }
}

fn execute_desktop_command(
    app: &tauri::AppHandle,
    command: DesktopCommand,
) -> Result<DesktopCommandResult, String> {
    let runtime = app.state::<RuntimeState>();
    let connection_id = runtime
        .connection_id
        .lock()
        .map_err(|_| "RUNTIME.CONNECTION.LOCK_POISONED".to_string())?
        .clone()
        .ok_or_else(|| "RUNTIME.IPC.DISCONNECTED".to_string())?;
    let now = now_ms();
    let disposition = runtime
        .execution_ledger
        .lock()
        .map_err(|_| "DESKTOP.COMMAND.LEDGER_POISONED".to_string())?
        .prepare(&command, &runtime.instance_id, &connection_id, now);
    match disposition {
        CommandDisposition::Replay(result) | CommandDisposition::Reject(result) => {
            return Ok(result);
        }
        CommandDisposition::Execute => {}
    }

    let transition = match command.name {
        CommandName::ModuleOpen | CommandName::SurfaceSetMode => {
            Err("DESKTOP.UI_REMOVED".to_string())
        }
        CommandName::AppOpen => command
            .app()
            .map_err(str::to_string)
            .and_then(launch_desktop_app),
    };
    let result = match transition {
        Ok(_) => DesktopCommandResult::acknowledged(&command, &connection_id, now_ms()),
        Err(error) => DesktopCommandResult::failed(
            &command,
            &connection_id,
            now_ms(),
            compact_error_code(&error),
        ),
    };
    runtime
        .execution_ledger
        .lock()
        .map_err(|_| "DESKTOP.COMMAND.LEDGER_POISONED".to_string())?
        .record(&command, result.clone());
    Ok(result)
}

#[tauri::command]
fn desktop_get_surface_state(surface: State<'_, SurfaceState>) -> SurfaceSnapshot {
    surface.snapshot()
}

#[tauri::command]
fn desktop_open_module(
    app: tauri::AppHandle,
    module_id: ModuleId,
) -> Result<SurfaceSnapshot, String> {
    apply_surface_transition(&app, DesktopMode::Control, Some(module_id))
}

#[tauri::command]
fn desktop_set_interaction_mode(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<SurfaceSnapshot, String> {
    apply_surface_transition(
        &app,
        if enabled {
            DesktopMode::Control
        } else {
            DesktopMode::Ambient
        },
        None,
    )
}

fn reset_overlay_after_page_load(app: &tauri::AppHandle) {
    let surface = app.state::<SurfaceState>();
    let _transition = surface.lock_transition();
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
    if let Err(error) = window.eval("window.__birdieSetInteractionMode?.(false);") {
        report_window_error(app, "window.page_load.renderer_sync", error);
    }
    app.state::<RuntimeState>().diagnostic.append(
        "WINDOW_PAGE_LOAD_RESET",
        format!("mode=AMBIENT visibilityPreserved={was_visible}"),
    );
    let snapshot = surface.transition(DesktopMode::Ambient, None);
    emit_surface_snapshot(app, &snapshot);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let diagnostic = DiagnosticLog::open().unwrap_or_else(|error| panic!("{error}"));
    diagnostic.append(
        "DESKTOP_START",
        format!("pid={} buildId={BUILD_ID}", std::process::id()),
    );
    tauri::Builder::default()
        .manage(SurfaceState::default())
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
            instance_id: desktop_instance_id(),
            connection_id: Mutex::new(None),
            ipc_state: Mutex::new("CONNECTING".into()),
            last_core_message_at: AtomicU64::new(0),
            execution_ledger: Mutex::new(DesktopExecutionLedger::default()),
            diagnostic,
        })
        .invoke_handler(tauri::generate_handler![
            runtime_get_snapshot,
            runtime_get_system_snapshot,
            runtime_set_microphone_enabled,
            runtime_submit_desktop_intent,
            runtime_log_frontend,
            desktop_get_surface_state,
            desktop_open_module,
            desktop_set_interaction_mode,
            focus_get_state,
            focus_save_state,
            capture_list,
            capture_add,
            capture_delete,
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
            app.state::<RuntimeState>()
                .diagnostic
                .append("SINGLE_INSTANCE", "duplicate_launch=ignored mode=HEADLESS");
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            let local_data_path = app
                .path()
                .app_local_data_dir()?
                .join("function-layer-v1.json");
            let local_store = LocalStore::open(local_data_path);
            let microphone_enabled = stored_microphone_enabled(&local_store);
            let _ = app.manage(local_store);

            let supervisor = ProcessSupervisor::start(app.handle().clone(), microphone_enabled);
            let _ = app.manage(supervisor);
            start_core_ipc(app.handle().clone());
            let microphone = CheckMenuItem::with_id(
                app,
                "microphone",
                "Mikrofon verwenden",
                true,
                microphone_enabled,
                None::<&str>,
            )?;
            let microphone_control = microphone.clone();
            let quit = MenuItem::with_id(app, "quit", "Birdie beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&microphone, &quit])?;
            TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Birdie – Mikrofoneinstellung im Menü")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "microphone" => {
                        let requested = microphone_control.is_checked().unwrap_or(false);
                        let supervisor = app.state::<ProcessSupervisor>();
                        let runtime = app.state::<RuntimeState>();
                        let store = app.state::<LocalStore>();
                        let result = apply_microphone_preference(
                            store.inner(),
                            runtime.inner(),
                            supervisor.inner(),
                            requested,
                        );
                        if let Err(error) = result {
                            // A failed privacy-off request stays visibly off and
                            // the supervisor flag stays disabled. Enabling errors
                            // also fail closed to the unchecked preference.
                            let _ = microphone_control.set_checked(false);
                            app.state::<RuntimeState>().diagnostic.append(
                                "ERROR",
                                format!(
                                    "stage=tray.microphone requested={requested} error={error}"
                                ),
                            );
                        } else {
                            app.state::<RuntimeState>()
                                .diagnostic
                                .append("TRAY_MICROPHONE", format!("enabled={requested}"));
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

    #[test]
    fn stored_microphone_preference_drives_fail_closed_startup_state() {
        let path = std::env::temp_dir().join(format!(
            "birdie-startup-microphone-{}-{}.json",
            std::process::id(),
            now_ms()
        ));
        let store = LocalStore::open(path.clone());
        assert!(stored_microphone_enabled(&store));
        store
            .save_microphone_enabled(false)
            .expect("explicit Off should persist");
        assert!(!stored_microphone_enabled(&LocalStore::open(path.clone())));

        std::fs::write(&path, b"corrupt").expect("test store should be writable");
        assert!(!stored_microphone_enabled(&LocalStore::open(path.clone())));
        let _ = std::fs::remove_file(path);
    }

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
    fn system_snapshot_serializes_runtime_transport_and_capability_separately() {
        let snapshot = SystemSnapshot {
            runtime_lifecycle: "DEGRADED".into(),
            core_status: "RUNNING_NO_IPC".into(),
            voice_status: "UNAVAILABLE".into(),
            microphone_state: "UNAVAILABLE".into(),
            presence_state: "OFFLINE".into(),
            brain_state: "READY".into(),
            ipc_state: "DISCONNECTED".into(),
            connection_id: None,
            last_core_message_at: Some(42),
            mode: DesktopMode::Ambient,
            active_module: None,
            global_shortcut_status: "REGISTERED".into(),
        };

        let encoded = serde_json::to_value(snapshot).expect("system snapshot must serialize");
        assert_eq!(encoded["runtimeLifecycle"], "DEGRADED");
        assert_eq!(encoded["ipcState"], "DISCONNECTED");
        assert_eq!(encoded["presenceState"], "OFFLINE");
        assert_eq!(encoded["microphoneState"], "UNAVAILABLE");
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
