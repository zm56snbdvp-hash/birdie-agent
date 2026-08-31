use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

const STORE_SCHEMA_VERSION: u32 = 1;
const FOCUS_SCHEMA_VERSION: u32 = 1;
const MAX_FOCUS_TASK_CHARS: usize = 1_000;
const MAX_FOCUS_DURATION_MS: u64 = 24 * 60 * 60 * 1_000;
const MAX_CAPTURE_TEXT_CHARS: usize = 4_000;
const MAX_CAPTURE_ENTRIES: usize = 500;

fn default_microphone_enabled() -> bool {
    true
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FocusState {
    pub schema_version: u32,
    pub task: String,
    pub duration_ms: u64,
    pub remaining_ms: u64,
    pub status: String,
    pub started_at_ms: Option<u64>,
    pub deadline_at_ms: Option<u64>,
    pub updated_at_ms: u64,
}

impl Default for FocusState {
    fn default() -> Self {
        Self {
            schema_version: FOCUS_SCHEMA_VERSION,
            task: String::new(),
            duration_ms: 0,
            remaining_ms: 0,
            status: "IDLE".into(),
            started_at_ms: None,
            deadline_at_ms: None,
            updated_at_ms: now_ms(),
        }
    }
}

impl FocusState {
    fn validate(&self) -> Result<(), String> {
        if self.schema_version != FOCUS_SCHEMA_VERSION {
            return Err("FOCUS.SCHEMA_VERSION_UNSUPPORTED".into());
        }
        if self.task.chars().count() > MAX_FOCUS_TASK_CHARS {
            return Err("FOCUS.TASK_TOO_LONG".into());
        }
        if self.duration_ms > MAX_FOCUS_DURATION_MS || self.remaining_ms > self.duration_ms {
            return Err("FOCUS.DURATION_INVALID".into());
        }
        match self.status.as_str() {
            "IDLE" if self.deadline_at_ms.is_none() => Ok(()),
            "RUNNING"
                if !self.task.trim().is_empty()
                    && self.duration_ms > 0
                    && self.deadline_at_ms.is_some() =>
            {
                Ok(())
            }
            "PAUSED"
                if !self.task.trim().is_empty()
                    && self.duration_ms > 0
                    && self.remaining_ms > 0
                    && self.deadline_at_ms.is_none() =>
            {
                Ok(())
            }
            "COMPLETED" if self.remaining_ms == 0 && self.deadline_at_ms.is_none() => Ok(()),
            _ => Err("FOCUS.STATE_INVALID".into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CaptureEntry {
    pub id: String,
    pub text: String,
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PersistedData {
    schema_version: u32,
    focus: FocusState,
    captures: Vec<CaptureEntry>,
    #[serde(default = "default_microphone_enabled")]
    microphone_enabled: bool,
}

impl Default for PersistedData {
    fn default() -> Self {
        Self {
            schema_version: STORE_SCHEMA_VERSION,
            focus: FocusState::default(),
            captures: Vec::new(),
            microphone_enabled: default_microphone_enabled(),
        }
    }
}

struct StoreState {
    data: PersistedData,
    load_error: Option<String>,
    capture_sequence: u64,
}

pub struct LocalStore {
    path: PathBuf,
    state: Mutex<StoreState>,
}

impl LocalStore {
    pub fn open(path: PathBuf) -> Self {
        let (data, load_error) = match fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<PersistedData>(&bytes) {
                Ok(data)
                    if data.schema_version == STORE_SCHEMA_VERSION
                        && validate_persisted(&data).is_ok() =>
                {
                    (data, None)
                }
                Ok(_) => (PersistedData::default(), Some("LOCAL.STORE.INVALID".into())),
                Err(_) => (PersistedData::default(), Some("LOCAL.STORE.CORRUPT".into())),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                (PersistedData::default(), None)
            }
            Err(_) => (
                PersistedData::default(),
                Some("LOCAL.STORE.READ_FAILED".into()),
            ),
        };
        Self {
            path,
            state: Mutex::new(StoreState {
                data,
                load_error,
                capture_sequence: 0,
            }),
        }
    }

    pub fn focus(&self) -> Result<FocusState, String> {
        let state = self.state.lock().map_err(|_| "LOCAL.STORE.LOCK_POISONED")?;
        ensure_healthy(&state)?;
        Ok(state.data.focus.clone())
    }

    pub fn save_focus(&self, focus: FocusState) -> Result<FocusState, String> {
        focus.validate()?;
        let mut state = self.state.lock().map_err(|_| "LOCAL.STORE.LOCK_POISONED")?;
        ensure_healthy(&state)?;
        let mut next = state.data.clone();
        next.focus = focus.clone();
        write_atomic(&self.path, &next)?;
        state.data = next;
        Ok(focus)
    }

    pub fn microphone_enabled(&self) -> Result<bool, String> {
        let state = self.state.lock().map_err(|_| "LOCAL.STORE.LOCK_POISONED")?;
        ensure_healthy(&state)?;
        Ok(state.data.microphone_enabled)
    }

    pub fn save_microphone_enabled(&self, enabled: bool) -> Result<bool, String> {
        let mut state = self.state.lock().map_err(|_| "LOCAL.STORE.LOCK_POISONED")?;
        ensure_healthy(&state)?;
        let mut next = state.data.clone();
        next.microphone_enabled = enabled;
        write_atomic(&self.path, &next)?;
        state.data = next;
        Ok(enabled)
    }

    pub fn captures(&self) -> Result<Vec<CaptureEntry>, String> {
        let state = self.state.lock().map_err(|_| "LOCAL.STORE.LOCK_POISONED")?;
        ensure_healthy(&state)?;
        Ok(state.data.captures.clone())
    }

    pub fn add_capture(&self, text: String) -> Result<CaptureEntry, String> {
        let text = text.trim().to_string();
        let length = text.chars().count();
        if length == 0 {
            return Err("CAPTURE.TEXT_REQUIRED".into());
        }
        if length > MAX_CAPTURE_TEXT_CHARS {
            return Err("CAPTURE.TEXT_TOO_LONG".into());
        }
        let mut state = self.state.lock().map_err(|_| "LOCAL.STORE.LOCK_POISONED")?;
        ensure_healthy(&state)?;
        if state.data.captures.len() >= MAX_CAPTURE_ENTRIES {
            return Err("CAPTURE.LIMIT_REACHED".into());
        }
        state.capture_sequence = state.capture_sequence.saturating_add(1);
        let created_at = now_ms();
        let entry = CaptureEntry {
            id: format!(
                "capture-{}-{created_at}-{}",
                std::process::id(),
                state.capture_sequence,
            ),
            text,
            created_at,
        };
        let mut next = state.data.clone();
        next.captures.insert(0, entry.clone());
        write_atomic(&self.path, &next)?;
        state.data = next;
        Ok(entry)
    }

    pub fn delete_capture(&self, id: &str) -> Result<bool, String> {
        if id.is_empty() || id.len() > 160 {
            return Err("CAPTURE.ID_INVALID".into());
        }
        let mut state = self.state.lock().map_err(|_| "LOCAL.STORE.LOCK_POISONED")?;
        ensure_healthy(&state)?;
        let mut next = state.data.clone();
        let previous_length = next.captures.len();
        next.captures.retain(|entry| entry.id != id);
        if next.captures.len() == previous_length {
            return Ok(false);
        }
        write_atomic(&self.path, &next)?;
        state.data = next;
        Ok(true)
    }

    #[cfg(test)]
    fn path(&self) -> &Path {
        &self.path
    }
}

fn ensure_healthy(state: &StoreState) -> Result<(), String> {
    match &state.load_error {
        Some(error) => Err(error.clone()),
        None => Ok(()),
    }
}

fn validate_persisted(data: &PersistedData) -> Result<(), String> {
    data.focus.validate()?;
    if data.captures.len() > MAX_CAPTURE_ENTRIES {
        return Err("CAPTURE.LIMIT_EXCEEDED".into());
    }
    let mut ids = HashSet::with_capacity(data.captures.len());
    for entry in &data.captures {
        let text_length = entry.text.chars().count();
        if entry.created_at == 0
            || entry.id.is_empty()
            || entry.id.len() > 160
            || text_length == 0
            || text_length > MAX_CAPTURE_TEXT_CHARS
            || !ids.insert(entry.id.as_str())
        {
            return Err("CAPTURE.ENTRY_INVALID".into());
        }
    }
    Ok(())
}

fn write_atomic(path: &Path, data: &PersistedData) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "LOCAL.STORE.PATH_INVALID".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "LOCAL.STORE.CREATE_DIR_FAILED".to_string())?;
    let temporary = parent.join(format!(
        ".birdie-function-layer-{}-{}.tmp",
        std::process::id(),
        now_ms(),
    ));
    let bytes = serde_json::to_vec(data).map_err(|_| "LOCAL.STORE.SERIALIZE_FAILED".to_string())?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|_| "LOCAL.STORE.TEMP_OPEN_FAILED".to_string())?;
        file.write_all(&bytes)
            .map_err(|_| "LOCAL.STORE.WRITE_FAILED".to_string())?;
        file.sync_all()
            .map_err(|_| "LOCAL.STORE.SYNC_FAILED".to_string())?;
        replace_file(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(windows)]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    if !destination.exists() {
        return fs::rename(temporary, destination)
            .map_err(|_| "LOCAL.STORE.RENAME_FAILED".to_string());
    }
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let temporary_wide: Vec<u16> = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let moved = unsafe {
        windows_sys::Win32::Storage::FileSystem::MoveFileExW(
            temporary_wide.as_ptr(),
            destination_wide.as_ptr(),
            0x0000_0001 | 0x0000_0008,
        )
    };
    if moved == 0 {
        Err("LOCAL.STORE.REPLACE_FAILED".into())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temporary, destination).map_err(|_| "LOCAL.STORE.RENAME_FAILED".to_string())
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "birdie-local-store-{label}-{}-{}.json",
            std::process::id(),
            now_ms(),
        ))
    }

    #[test]
    fn focus_and_capture_round_trip_without_external_services() {
        let path = test_path("roundtrip");
        let store = LocalStore::open(path.clone());
        assert_eq!(store.path(), path.as_path());
        assert!(store.microphone_enabled().unwrap());
        let focus = FocusState {
            schema_version: 1,
            task: "Ship Function Layer".into(),
            duration_ms: 60_000,
            remaining_ms: 60_000,
            status: "RUNNING".into(),
            started_at_ms: Some(1_000),
            deadline_at_ms: Some(61_000),
            updated_at_ms: 1_000,
        };
        store.save_focus(focus.clone()).expect("focus persists");
        let capture = store
            .add_capture("Only local".into())
            .expect("capture persists");
        assert!(!store.save_microphone_enabled(false).unwrap());
        let reopened = LocalStore::open(path.clone());
        assert_eq!(reopened.focus().unwrap(), focus);
        assert_eq!(reopened.captures().unwrap(), vec![capture.clone()]);
        assert!(!reopened.microphone_enabled().unwrap());
        assert!(reopened.delete_capture(&capture.id).unwrap());
        assert!(reopened.captures().unwrap().is_empty());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn legacy_store_without_microphone_preference_defaults_to_enabled() {
        let path = test_path("legacy-microphone-default");
        let mut data = serde_json::to_value(PersistedData::default()).unwrap();
        data.as_object_mut().unwrap().remove("microphoneEnabled");
        fs::write(&path, serde_json::to_vec(&data).unwrap()).unwrap();

        let store = LocalStore::open(path.clone());
        assert!(store.microphone_enabled().unwrap());
        assert!(!store.save_microphone_enabled(false).unwrap());
        assert!(!LocalStore::open(path.clone()).microphone_enabled().unwrap());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn corrupt_store_fails_closed_instead_of_overwriting_data() {
        let path = test_path("corrupt");
        fs::write(&path, b"not-json").unwrap();
        let store = LocalStore::open(path.clone());
        assert_eq!(store.focus().unwrap_err(), "LOCAL.STORE.CORRUPT");
        assert_eq!(
            store.microphone_enabled().unwrap_err(),
            "LOCAL.STORE.CORRUPT"
        );
        assert_eq!(
            store.add_capture("must not overwrite".into()).unwrap_err(),
            "LOCAL.STORE.CORRUPT",
        );
        assert_eq!(fs::read(&path).unwrap(), b"not-json");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn semantically_invalid_store_fails_closed() {
        let path = test_path("invalid");
        let mut data = PersistedData::default();
        data.focus = FocusState {
            schema_version: 1,
            task: "Invalid running state".into(),
            duration_ms: 60_000,
            remaining_ms: 60_000,
            status: "RUNNING".into(),
            started_at_ms: Some(1_000),
            deadline_at_ms: None,
            updated_at_ms: 1_000,
        };
        fs::write(&path, serde_json::to_vec(&data).unwrap()).unwrap();
        let store = LocalStore::open(path.clone());
        assert_eq!(store.focus().unwrap_err(), "LOCAL.STORE.INVALID");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn capture_capacity_requires_explicit_deletion() {
        let path = test_path("capacity");
        let mut data = PersistedData::default();
        data.captures = (0..MAX_CAPTURE_ENTRIES)
            .map(|index| CaptureEntry {
                id: format!("capture-capacity-{index}"),
                text: format!("Entry {index}"),
                created_at: index as u64 + 1,
            })
            .collect();
        fs::write(&path, serde_json::to_vec(&data).unwrap()).unwrap();
        let store = LocalStore::open(path.clone());
        assert_eq!(
            store.add_capture("One too many".into()).unwrap_err(),
            "CAPTURE.LIMIT_REACHED",
        );
        assert_eq!(store.captures().unwrap().len(), MAX_CAPTURE_ENTRIES);
        let _ = fs::remove_file(path);
    }
}
