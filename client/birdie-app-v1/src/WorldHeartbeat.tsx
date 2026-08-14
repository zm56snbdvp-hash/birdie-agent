import { getBirdieWorldCue } from "./birdieWorldCue";
import type { BirdieWorldDestination } from "./birdieDestinations";
import type { BirdieWorldContextProjection } from "./worldContext";

export interface WorldHeartbeatProps {
  worldContext: BirdieWorldContextProjection;
  activeDestination: BirdieWorldDestination | null;
}

const DESTINATION_LABELS: Record<BirdieWorldDestination, string> = {
  "golf-history": "Golf History ist offen",
  "ball-vault": "Ball Vault ist offen",
  "personal-birdie": "Personal Birdie ist offen"
};

export function WorldHeartbeat({
  worldContext,
  activeDestination
}: WorldHeartbeatProps) {
  const cue = getBirdieWorldCue(worldContext);

  return (
    <aside
      className="world-heartbeat"
      aria-label="Leiser Herzschlag der BirdieWorld"
      data-world-heartbeat="living-world-heartbeat-v0.2"
    >
      <span className="world-heartbeat__signal" aria-hidden="true" />
      <div>
        <small>Die Welt ist wach · nur in dieser Sitzung</small>
        <strong>{cue?.launcher ?? "Birdie bleibt in deiner Nähe"}</strong>
      </div>
      <span className="world-heartbeat__place">
        {activeDestination
          ? DESTINATION_LABELS[activeDestination]
          : `${cue?.eyebrow ?? "Bei Birdie"} · nichts wird gespeichert`}
      </span>
    </aside>
  );
}
