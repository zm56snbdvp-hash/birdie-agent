import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const stateTransitions = new Map([
  ["voice.activity.started", "SPEECH_DETECTED"],
  ["voice.activation.accepted", "LISTENING"],
  ["voice.activation.rejected", "__REJECT__"],
  ["voice.utterance.finalized", "THINKING"],
  ["voice.output.started", "SPEAKING"],
  ["voice.output.completed", "IDLE"],
]);

function simulate(trace) {
  const states = [];
  let current = trace.expected_presence_trace?.[0] ?? "IDLE";
  states.push(current);

  for (const event of trace.events ?? []) {
    const next = stateTransitions.get(event.name);
    if (!next) continue;

    if (next === "__REJECT__") {
      current = trace.name === "barge-in-rejected" ? "SPEAKING" : "IDLE";
    } else {
      current = next;
    }

    if (states.at(-1) !== current) states.push(current);
  }

  return states;
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: node tests/desktop-alpha/event-simulator.mjs <golden-trace.json>");
  process.exit(2);
}

const resolved = path.resolve(file);
const trace = JSON.parse(fs.readFileSync(resolved, "utf8"));
const actual = simulate(trace);
const expected = trace.expected_presence_trace;

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  console.error("Golden trace mismatch");
  console.error("expected:", expected);
  console.error("actual:  ", actual);
  process.exit(1);
}

console.log(`PASS ${trace.name}: ${actual.join(" -> ")}`);
