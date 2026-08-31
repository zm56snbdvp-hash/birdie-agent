use serde::{Deserialize, Serialize};
use std::sync::{Mutex, MutexGuard};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DesktopMode {
    Ambient,
    Control,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ModuleId {
    CommandCenter,
    System,
    Focus,
    Capture,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceSnapshot {
    pub mode: DesktopMode,
    pub active_module: Option<ModuleId>,
    pub revision: u64,
    pub global_shortcut_status: String,
}

impl Default for SurfaceSnapshot {
    fn default() -> Self {
        Self {
            mode: DesktopMode::Ambient,
            active_module: None,
            revision: 0,
            global_shortcut_status: "UNKNOWN".into(),
        }
    }
}

pub struct SurfaceState {
    inner: Mutex<SurfaceSnapshot>,
    transition_guard: Mutex<()>,
}

impl Default for SurfaceState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(SurfaceSnapshot::default()),
            transition_guard: Mutex::new(()),
        }
    }
}

impl SurfaceState {
    pub fn lock_transition(&self) -> MutexGuard<'_, ()> {
        self.transition_guard
            .lock()
            .expect("surface transition state poisoned")
    }

    pub fn snapshot(&self) -> SurfaceSnapshot {
        self.inner.lock().expect("surface state poisoned").clone()
    }

    pub fn transition(
        &self,
        mode: DesktopMode,
        active_module: Option<ModuleId>,
    ) -> SurfaceSnapshot {
        let mut state = self.inner.lock().expect("surface state poisoned");
        let normalized_module = if mode == DesktopMode::Ambient {
            None
        } else {
            active_module
        };
        if state.mode != mode || state.active_module != normalized_module {
            state.mode = mode;
            state.active_module = normalized_module;
            state.revision = state.revision.saturating_add(1);
        }
        state.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ambient_always_clears_the_active_module() {
        let state = SurfaceState::default();
        let control = state.transition(DesktopMode::Control, Some(ModuleId::Focus));
        assert_eq!(control.active_module, Some(ModuleId::Focus));
        let ambient = state.transition(DesktopMode::Ambient, Some(ModuleId::Capture));
        assert_eq!(ambient.mode, DesktopMode::Ambient);
        assert_eq!(ambient.active_module, None);
        assert!(ambient.revision > control.revision);
    }

    #[test]
    fn idempotent_transition_does_not_advance_revision() {
        let state = SurfaceState::default();
        let first = state.transition(DesktopMode::Control, None);
        let replay = state.transition(DesktopMode::Control, None);
        assert_eq!(first, replay);
    }
}
