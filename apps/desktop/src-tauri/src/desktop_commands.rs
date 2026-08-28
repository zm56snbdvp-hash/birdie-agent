use crate::surface::{DesktopMode, ModuleId};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

const MAX_COMMAND_LIFETIME_MS: u64 = 30_000;
const MAX_LEDGER_ENTRIES: usize = 512;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum CommandName {
    #[serde(rename = "desktop.module.open")]
    ModuleOpen,
    #[serde(rename = "desktop.surface.set_mode")]
    SurfaceSetMode,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ModuleArgs {
    pub module_id: ModuleId,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ModeArgs {
    pub mode: DesktopMode,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CommandArgs {
    Module(ModuleArgs),
    Mode(ModeArgs),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommandTarget {
    pub instance_id: String,
    pub connection_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommandProvenance {
    pub origin: String,
    pub source_component: String,
    pub source_instance_id: String,
    #[serde(deserialize_with = "required_nullable")]
    pub session_id: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub event_id: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub turn_id: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub trace_id: Option<String>,
}

fn required_nullable<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopCommand {
    pub command_id: String,
    pub name: CommandName,
    pub args: CommandArgs,
    pub issued_at_ms: u64,
    pub expires_at_ms: u64,
    pub target: CommandTarget,
    pub provenance: CommandProvenance,
}

impl DesktopCommand {
    pub fn module(&self) -> Result<ModuleId, &'static str> {
        match (&self.name, &self.args) {
            (CommandName::ModuleOpen, CommandArgs::Module(args)) => Ok(args.module_id),
            _ => Err("DESKTOP.COMMAND.ARGS_INVALID"),
        }
    }

    pub fn mode(&self) -> Result<DesktopMode, &'static str> {
        match (&self.name, &self.args) {
            (CommandName::SurfaceSetMode, CommandArgs::Mode(args)) => Ok(args.mode),
            _ => Err("DESKTOP.COMMAND.ARGS_INVALID"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CommandResultStatus {
    Acknowledged,
    Rejected,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCommandResult {
    pub command_id: String,
    pub connection_id: String,
    pub status: CommandResultStatus,
    pub error_code: Option<String>,
    pub completed_at_ms: u64,
}

impl DesktopCommandResult {
    pub fn rejected_for_id(
        command_id: impl Into<String>,
        connection_id: &str,
        now_ms: u64,
        error_code: impl Into<String>,
    ) -> Self {
        Self {
            command_id: command_id.into(),
            connection_id: connection_id.into(),
            status: CommandResultStatus::Rejected,
            error_code: Some(error_code.into()),
            completed_at_ms: now_ms,
        }
    }

    pub fn acknowledged(command: &DesktopCommand, connection_id: &str, now_ms: u64) -> Self {
        Self {
            command_id: command.command_id.clone(),
            connection_id: connection_id.into(),
            status: CommandResultStatus::Acknowledged,
            error_code: None,
            completed_at_ms: now_ms,
        }
    }

    pub fn rejected(
        command: &DesktopCommand,
        connection_id: &str,
        now_ms: u64,
        error_code: impl Into<String>,
    ) -> Self {
        Self::rejected_for_id(
            command.command_id.clone(),
            connection_id,
            now_ms,
            error_code,
        )
    }

    pub fn failed(
        command: &DesktopCommand,
        connection_id: &str,
        now_ms: u64,
        error_code: impl Into<String>,
    ) -> Self {
        Self {
            command_id: command.command_id.clone(),
            connection_id: connection_id.into(),
            status: CommandResultStatus::Failed,
            error_code: Some(error_code.into()),
            completed_at_ms: now_ms,
        }
    }
}

#[derive(Clone, Debug)]
struct LedgerEntry {
    fingerprint: String,
    result: DesktopCommandResult,
}

pub enum CommandDisposition {
    Execute,
    Replay(DesktopCommandResult),
    Reject(DesktopCommandResult),
}

pub struct DesktopExecutionLedger {
    entries: HashMap<String, LedgerEntry>,
    order: VecDeque<String>,
}

impl Default for DesktopExecutionLedger {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
        }
    }
}

impl DesktopExecutionLedger {
    pub fn prepare(
        &self,
        command: &DesktopCommand,
        expected_instance_id: &str,
        expected_connection_id: &str,
        now_ms: u64,
    ) -> CommandDisposition {
        if command.target.instance_id != expected_instance_id
            || command.target.connection_id != expected_connection_id
        {
            return CommandDisposition::Reject(DesktopCommandResult::rejected(
                command,
                expected_connection_id,
                now_ms,
                "DESKTOP.COMMAND.TARGET_MISMATCH",
            ));
        }
        if !valid_identifier(&command.command_id, 128)
            || !valid_identifier(&command.target.instance_id, 128)
            || !valid_identifier(&command.target.connection_id, 128)
        {
            return CommandDisposition::Reject(DesktopCommandResult::rejected(
                command,
                expected_connection_id,
                now_ms,
                "DESKTOP.COMMAND.ID_INVALID",
            ));
        }
        if let Some(existing) = self.entries.get(&command.command_id) {
            let fingerprint = semantic_fingerprint(command);
            if existing.fingerprint != fingerprint {
                return CommandDisposition::Reject(DesktopCommandResult::rejected(
                    command,
                    expected_connection_id,
                    now_ms,
                    "DESKTOP.COMMAND.REPLAY_CONFLICT",
                ));
            }
            let mut replay = existing.result.clone();
            replay.connection_id = expected_connection_id.into();
            replay.completed_at_ms = now_ms;
            return CommandDisposition::Replay(replay);
        }
        if command.expires_at_ms <= command.issued_at_ms
            || command.expires_at_ms.saturating_sub(command.issued_at_ms) > MAX_COMMAND_LIFETIME_MS
        {
            return CommandDisposition::Reject(DesktopCommandResult::rejected(
                command,
                expected_connection_id,
                now_ms,
                "DESKTOP.COMMAND.DEADLINE_INVALID",
            ));
        }
        if command.issued_at_ms > now_ms.saturating_add(5_000) {
            return CommandDisposition::Reject(DesktopCommandResult::rejected(
                command,
                expected_connection_id,
                now_ms,
                "DESKTOP.COMMAND.FUTURE",
            ));
        }
        if command.expires_at_ms <= now_ms {
            return CommandDisposition::Reject(DesktopCommandResult::rejected(
                command,
                expected_connection_id,
                now_ms,
                "DESKTOP.COMMAND.EXPIRED",
            ));
        }
        if !matches!(
            (&command.name, &command.args),
            (CommandName::ModuleOpen, CommandArgs::Module(_))
                | (CommandName::SurfaceSetMode, CommandArgs::Mode(_))
        ) {
            return CommandDisposition::Reject(DesktopCommandResult::rejected(
                command,
                expected_connection_id,
                now_ms,
                "DESKTOP.COMMAND.ARGS_INVALID",
            ));
        }
        if !valid_provenance(&command.provenance) {
            return CommandDisposition::Reject(DesktopCommandResult::rejected(
                command,
                expected_connection_id,
                now_ms,
                "DESKTOP.COMMAND.PROVENANCE_INVALID",
            ));
        }
        CommandDisposition::Execute
    }

    pub fn record(&mut self, command: &DesktopCommand, result: DesktopCommandResult) {
        if self.entries.contains_key(&command.command_id) {
            return;
        }
        self.order.push_back(command.command_id.clone());
        self.entries.insert(
            command.command_id.clone(),
            LedgerEntry {
                fingerprint: semantic_fingerprint(command),
                result,
            },
        );
        while self.order.len() > MAX_LEDGER_ENTRIES {
            if let Some(command_id) = self.order.pop_front() {
                self.entries.remove(&command_id);
            }
        }
    }
}

fn semantic_fingerprint(command: &DesktopCommand) -> String {
    serde_json::to_string(&(
        command.name,
        &command.args,
        command.issued_at_ms,
        command.expires_at_ms,
        &command.target.instance_id,
        &command.provenance,
    ))
    .unwrap_or_else(|_| "DESKTOP.COMMAND.FINGERPRINT_FAILED".into())
}

fn valid_provenance(provenance: &CommandProvenance) -> bool {
    let valid_required = |value: &str, maximum: usize| {
        let length = value.trim().len();
        (1..=maximum).contains(&length)
    };
    let valid_optional = |value: &Option<String>| {
        value
            .as_ref()
            .is_none_or(|value| valid_required(value, 256))
    };
    if !valid_required(&provenance.source_component, 128)
        || !valid_identifier(&provenance.source_instance_id, 128)
        || !valid_optional(&provenance.session_id)
        || !valid_optional(&provenance.event_id)
        || !valid_optional(&provenance.turn_id)
        || !valid_optional(&provenance.trace_id)
    {
        return false;
    }
    match provenance.origin.as_str() {
        "VOICE" => {
            provenance.source_component == "birdie-voice"
                && provenance.session_id.is_some()
                && provenance.event_id.is_some()
                && provenance.turn_id.is_some()
                && provenance.trace_id.is_some()
        }
        "COMMAND_CENTER" => {
            provenance.source_component == "birdie-desktop"
                && provenance.session_id.is_some()
                && provenance.event_id.is_none()
                && provenance.turn_id.is_none()
                && provenance.trace_id.is_none()
        }
        _ => false,
    }
}

fn valid_identifier(value: &str, maximum: usize) -> bool {
    let length = value.len();
    (8..=maximum).contains(&length)
        && value.chars().enumerate().all(|(index, character)| {
            character.is_ascii_alphanumeric()
                || (index > 0 && matches!(character, '.' | '_' | ':' | '-'))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn command(id: &str, connection: &str) -> DesktopCommand {
        serde_json::from_value(json!({
          "commandId": id,
          "name": "desktop.module.open",
          "args": { "moduleId": "FOCUS" },
          "issuedAtMs": 1_000,
          "expiresAtMs": 6_000,
          "target": { "instanceId": "desktop-instance", "connectionId": connection },
          "provenance": {
            "origin": "VOICE",
            "sourceComponent": "birdie-voice",
            "sourceInstanceId": "voice-instance",
            "sessionId": "voice-session",
            "eventId": "event-1",
            "turnId": "turn-1",
            "traceId": "trace-1"
          }
        }))
        .expect("valid command")
    }

    #[test]
    fn strict_schema_rejects_unknown_fields() {
        let value = json!({
          "commandId": "command-1234",
          "name": "desktop.module.open",
          "args": { "moduleId": "FOCUS", "shell": "no" },
          "issuedAtMs": 1_000,
          "expiresAtMs": 6_000,
          "target": { "instanceId": "desktop-instance", "connectionId": "connection-1234" },
          "provenance": {
            "origin": "VOICE", "sourceComponent": "voice", "sourceInstanceId": "voice-instance",
            "sessionId": null, "eventId": null, "turnId": null, "traceId": null
          }
        });
        assert!(serde_json::from_value::<DesktopCommand>(value).is_err());
    }

    #[test]
    fn strict_schema_requires_nullable_provenance_keys_to_be_present() {
        let mut value = serde_json::to_value(command("command-1234", "connection-1234"))
            .expect("serialize command");
        value["provenance"]
            .as_object_mut()
            .expect("provenance object")
            .remove("traceId");
        assert!(serde_json::from_value::<DesktopCommand>(value).is_err());
    }

    #[test]
    fn replay_returns_cached_result_without_execution() {
        let mut ledger = DesktopExecutionLedger::default();
        let first = command("command-1234", "connection-1234");
        assert!(matches!(
            ledger.prepare(&first, "desktop-instance", "connection-1234", 2_000),
            CommandDisposition::Execute
        ));
        ledger.record(
            &first,
            DesktopCommandResult::acknowledged(&first, "connection-1234", 2_100),
        );
        assert!(matches!(
            ledger.prepare(&first, "desktop-instance", "connection-1234", 2_200),
            CommandDisposition::Replay(DesktopCommandResult {
                status: CommandResultStatus::Acknowledged,
                ..
            })
        ));
    }

    #[test]
    fn same_instance_reconnect_replays_but_foreign_instance_conflicts() {
        let mut ledger = DesktopExecutionLedger::default();
        let first = command("command-1234", "connection-1234");
        ledger.record(
            &first,
            DesktopCommandResult::acknowledged(&first, "connection-1234", 2_100),
        );
        let mut reconnect = first.clone();
        reconnect.target.connection_id = "connection-5678".into();
        assert!(matches!(
            ledger.prepare(&reconnect, "desktop-instance", "connection-5678", 2_200),
            CommandDisposition::Replay(_)
        ));
        let mut foreign = reconnect;
        foreign.target.instance_id = "desktop-foreign".into();
        assert!(matches!(
            ledger.prepare(&foreign, "desktop-foreign", "connection-5678", 2_300),
            CommandDisposition::Reject(_)
        ));
    }

    #[test]
    fn invalid_provenance_is_rejected_before_execution() {
        let ledger = DesktopExecutionLedger::default();
        let mut value = command("command-1234", "connection-1234");
        value.provenance.source_component = "foreign-voice".into();
        assert!(matches!(
            ledger.prepare(&value, "desktop-instance", "connection-1234", 2_000),
            CommandDisposition::Reject(DesktopCommandResult {
                status: CommandResultStatus::Rejected,
                ..
            })
        ));
    }

    #[test]
    fn expired_and_foreign_commands_fail_closed() {
        let ledger = DesktopExecutionLedger::default();
        let value = command("command-1234", "connection-1234");
        assert!(matches!(
            ledger.prepare(&value, "desktop-instance", "connection-1234", 7_000),
            CommandDisposition::Reject(_)
        ));
        assert!(matches!(
            ledger.prepare(&value, "other-instance", "connection-1234", 2_000),
            CommandDisposition::Reject(_)
        ));
    }
}
