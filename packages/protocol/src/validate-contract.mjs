import {
  CONTRACT_VERSION,
  PresenceState,
  EventName,
  IpcRole,
  IpcMessageType,
} from "./contract.mjs";

const expectedStates = [
  "IDLE",
  "SPEECH_DETECTED",
  "LISTENING",
  "THINKING",
  "SPEAKING",
  "WORKING",
  "SUCCESS",
  "ERROR",
  "OFFLINE",
];

const expectedRoles = ["desktop", "voice", "observer"];
const transportLevelNames = new Set(["error"]);
const actualStates = Object.values(PresenceState);
const actualRoles = Object.values(IpcRole);

if (CONTRACT_VERSION !== "1.0") {
  throw new Error(`Unexpected contract version: ${CONTRACT_VERSION}`);
}

if (JSON.stringify(actualStates) !== JSON.stringify(expectedStates)) {
  throw new Error(`PresenceState drift detected: ${JSON.stringify(actualStates)}`);
}

if (JSON.stringify(actualRoles) !== JSON.stringify(expectedRoles)) {
  throw new Error(`IpcRole drift detected: ${JSON.stringify(actualRoles)}`);
}

for (const [group, values] of [
  ["event", Object.values(EventName)],
  ["IPC message", Object.values(IpcMessageType)],
]) {
  if (new Set(values).size !== values.length) {
    throw new Error(`Duplicate ${group} name detected`);
  }
  for (const name of values) {
    if (!name.includes(".") && !transportLevelNames.has(name)) {
      throw new Error(`Invalid ${group} name: ${name}`);
    }
  }
}

if (IpcMessageType.ERROR !== "error") {
  throw new Error(`Canonical IPC error message drifted: ${IpcMessageType.ERROR}`);
}

console.log(
  `Birdie protocol ${CONTRACT_VERSION} validated: ` +
  `${actualStates.length} states, ${actualRoles.length} IPC roles, ` +
  `${Object.values(EventName).length} event names, ` +
  `${Object.values(IpcMessageType).length} transport messages.`,
);
