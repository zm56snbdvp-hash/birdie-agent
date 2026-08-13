import { getBirdieArrivalCopy } from "./arrivalLoop";
import type { BirdieWorldDestination } from "./birdieDestinations";

export interface ArrivalLoopGuideProps {
  destination: BirdieWorldDestination;
  arrivalNumber: number;
  onReturnToBirdie: () => void;
}

export function ArrivalLoopGuide({
  destination,
  arrivalNumber,
  onReturnToBirdie
}: ArrivalLoopGuideProps) {
  const copy = getBirdieArrivalCopy(destination);

  return (
    <aside
      className="arrival-loop-guide"
      aria-label={`Ankunft bei ${copy.title}`}
      data-arrival-loop="birdie-arrival-loop-v0.1"
      data-host-stage="invited"
    >
      <div className="arrival-loop-guide__copy">
        <p>{copy.eyebrow} · Stopp {arrivalNumber}</p>
        <strong>{copy.title}</strong>
        <span>{copy.copy}</span>
      </div>
      <button type="button" onClick={onReturnToBirdie} data-host-action="return-to-birdie">
        <span aria-hidden="true">←</span> Zurück zu Birdie
      </button>
    </aside>
  );
}
