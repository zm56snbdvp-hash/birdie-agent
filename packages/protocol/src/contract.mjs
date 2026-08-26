export const CONTRACT_VERSION = "1.0";

export const PresenceState = Object.freeze({
  IDLE: "IDLE",
  SPEECH_DETECTED: "SPEECH_DETECTED",
  LISTENING: "LISTENING",
  THINKING: "THINKING",
  SPEAKING: "SPEAKING",
  WORKING: "WORKING",
  SUCCESS: "SUCCESS",
  ERROR: "ERROR",
  OFFLINE: "OFFLINE",
});

export const RuntimeLifecycle = Object.freeze({
  STARTING: "STARTING",
  READY: "READY",
  DEGRADED: "DEGRADED",
  STOPPING: "STOPPING",
  STOPPED: "STOPPED",
});

export const SurfaceState = Object.freeze({
  COLLAPSED: "COLLAPSED",
  EXPANDED: "EXPANDED",
});

export const MicrophoneState = Object.freeze({
  ENABLED: "ENABLED",
  MUTED_BY_USER: "MUTED_BY_USER",
  UNAVAILABLE: "UNAVAILABLE",
  PERMISSION_DENIED: "PERMISSION_DENIED",
});

export const TurnStatus = Object.freeze({
  CREATED: "CREATED",
  CAPTURING: "CAPTURING",
  PROCESSING: "PROCESSING",
  OUTPUTTING: "OUTPUTTING",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
});

export const DataClassification = Object.freeze({
  OPERATIONAL: "operational",
  CONTENT: "content",
  SENSITIVE: "sensitive",
});

export const IpcRole = Object.freeze({
  DESKTOP: "desktop",
  VOICE: "voice",
  OBSERVER: "observer",
});

export const IpcMessageType = Object.freeze({
  COMPONENT_HELLO: "component.hello",
  COMPONENT_HELLO_ACK: "component.hello.ack",
  RUNTIME_SNAPSHOT_REQUEST: "runtime.snapshot.request",
  RUNTIME_SNAPSHOT: "runtime.snapshot",
  RUNTIME_EVENT_PUBLISH: "runtime.event.publish",
  RUNTIME_EVENT_ACK: "runtime.event.ack",
  RUNTIME_COMMAND: "runtime.command",
  RUNTIME_COMMAND_ACK: "runtime.command.ack",
  RUNTIME_PRESENCE_CHANGED: "runtime.presence.changed",
  RUNTIME_AUDIO_INPUT: "runtime.audio.input",
  RUNTIME_AUDIO_OUTPUT: "runtime.audio.output",
  VOICE_COMMAND: "voice.command",
  ERROR: "error",
});

export const EventName = Object.freeze({
  COMPONENT_READY: "component.ready",
  COMPONENT_HEALTH_CHANGED: "component.health.changed",
  RUNTIME_SNAPSHOT_REQUEST: "runtime.snapshot.request",
  RUNTIME_SNAPSHOT: "runtime.snapshot",
  RUNTIME_PRESENCE_CHANGED: "runtime.presence.changed",
  UI_CORE_CLICKED: "ui.core.clicked",
  UI_MICROPHONE_SET_ENABLED: "ui.microphone.set_enabled",
  VOICE_ACTIVITY_STARTED: "voice.activity.started",
  VOICE_ACTIVITY_ENDED: "voice.activity.ended",
  VOICE_ACTIVATION_ACCEPTED: "voice.activation.accepted",
  VOICE_ACTIVATION_REJECTED: "voice.activation.rejected",
  VOICE_ACTIVATION_ABSTAINED: "voice.activation.abstained",
  VOICE_UTTERANCE_FINALIZED: "voice.utterance.finalized",
  VOICE_INPUT_LEVEL: "voice.input.level",
  VOICE_INPUT_CANCELLED: "voice.input.cancelled",
  VOICE_PRIVACY_CHANGED: "voice.privacy.changed",
  BRAIN_TURN_START: "brain.turn.start",
  BRAIN_RESPONSE_COMPLETED: "brain.response.completed",
  BRAIN_TURN_CANCEL: "brain.turn.cancel",
  BRAIN_TURN_FAILED: "brain.turn.failed",
  VOICE_OUTPUT_PLAY: "voice.output.play",
  VOICE_OUTPUT_DUCK: "voice.output.duck",
  VOICE_OUTPUT_RESUME: "voice.output.resume",
  VOICE_OUTPUT_CANCEL: "voice.output.cancel",
  VOICE_OUTPUT_STARTED: "voice.output.started",
  VOICE_OUTPUT_LEVEL: "voice.output.level",
  VOICE_OUTPUT_COMPLETED: "voice.output.completed",
  VOICE_OUTPUT_CANCELLED: "voice.output.cancelled",
  VOICE_OUTPUT_FAILED: "voice.output.failed",
  RUNTIME_TURN_COMPLETED: "runtime.turn.completed",
  RUNTIME_TURN_CANCELLED: "runtime.turn.cancelled",
  RUNTIME_TURN_FAILED: "runtime.turn.failed",
});

export function createEnvelope({
  kind = "event",
  name,
  eventId,
  source,
  timestampUtc = new Date().toISOString(),
  monotonicMs,
  sourceSequence,
  traceId,
  sessionId,
  turnId = null,
  dataClassification = DataClassification.OPERATIONAL,
  payload = {},
}) {
  return {
    contract_version: CONTRACT_VERSION,
    kind,
    name,
    event_id: eventId,
    source,
    timestamp_utc: timestampUtc,
    monotonic_ms: monotonicMs,
    source_sequence: sourceSequence,
    trace_id: traceId,
    session_id: sessionId,
    turn_id: turnId,
    data_classification: dataClassification,
    payload,
  };
}
