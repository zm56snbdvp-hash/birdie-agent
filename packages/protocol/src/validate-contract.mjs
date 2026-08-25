import {
  CONTRACT_VERSION,
  PresenceState,
  EventName,
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

const actualStates = Object.values(PresenceState);

if (CONTRACT_VERSION !== "1.0") {
  throw new Error(`Unexpected contract version: ${CONTRACT_VERSION}`);
}

if (JSON.stringify(actualStates) !== JSON.stringify(expectedStates)) {
  throw new Error(`PresenceState drift detected: ${JSON.stringify(actualStates)}`);
}

const names = Object.values(EventName);
if (new Set(names).size !== names.length) {
  throw new Error("Duplicate event name detected");
}

for (const name of names) {
  if (!name.includes(".")) {
    throw new Error(`Invalid event name: ${name}`);
  }
}

console.log(`Birdie protocol ${CONTRACT_VERSION} validated: ${actualStates.length} states, ${names.length} event names.`);
