import { useEffect, useRef, type KeyboardEvent } from "react";
import type { BirdieWorldDestination } from "./birdieDestinations";
import type { EstateInteractionEvent } from "./estateContract";

export interface EstateNpcDialogueProps {
  interaction: EstateInteractionEvent;
  onClose: () => void;
  onOpenDestination: (destination: BirdieWorldDestination) => void;
}

export function EstateNpcDialogue({
  interaction,
  onClose,
  onOpenDestination
}: EstateNpcDialogueProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <aside
      className="estate-npc-dialogue"
      role="dialog"
      aria-modal="false"
      aria-labelledby="estate-npc-title"
      aria-describedby="estate-npc-copy"
      data-estate-interaction={interaction.id}
      data-session-only="true"
      onKeyDown={handleKeyDown}
    >
      <div className="estate-npc-dialogue__portrait" aria-hidden="true">
        {interaction.speaker.slice(0, 1)}
      </div>
      <div className="estate-npc-dialogue__content">
        <p>{interaction.speaker}</p>
        <h2 id="estate-npc-title">{interaction.title}</h2>
        <span id="estate-npc-copy">{interaction.dialogue}</span>
        <div className="estate-npc-dialogue__actions">
          {interaction.suggestedDestination ? (
            <button
              type="button"
              className="estate-npc-dialogue__primary"
              onClick={() => onOpenDestination(interaction.suggestedDestination!)}
            >
              {interaction.suggestedDestination === "golf-history"
                ? "Golf History öffnen"
                : interaction.suggestedDestination === "ball-vault"
                  ? "Ball Vault öffnen"
                  : "Birdie fragen"}
            </button>
          ) : null}
          <button
            ref={closeRef}
            type="button"
            className="estate-npc-dialogue__secondary"
            onClick={onClose}
          >
            Weiter erkunden
          </button>
        </div>
      </div>
      <small>Geskriptete Begegnung · nur diese Sitzung</small>
    </aside>
  );
}
