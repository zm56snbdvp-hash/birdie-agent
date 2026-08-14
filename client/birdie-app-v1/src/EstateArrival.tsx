import { useEffect, useRef } from "react";
import {
  ESTATE_AVATAR_STYLES,
  type EstateAvatarStyleId
} from "./avatarStyle";

export const ESTATE_ARRIVAL_VERSION = "taxi-arrival-v0.3.2" as const;

export interface EstateArrivalProps {
  selectedStyle: EstateAvatarStyleId;
  onSelectStyle: (style: EstateAvatarStyleId) => void;
  onArrive: () => void;
}

export function EstateArrival({
  selectedStyle,
  onSelectStyle,
  onArrive
}: EstateArrivalProps) {
  const arriveRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    arriveRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      className="estate-arrival"
      role="dialog"
      aria-modal="true"
      aria-labelledby="estate-arrival-title"
      aria-describedby="estate-arrival-copy"
      data-estate-arrival={ESTATE_ARRIVAL_VERSION}
      data-session-only="true"
    >
      <div className="estate-arrival__sky" aria-hidden="true">
        <span className="estate-arrival__golf" />
        <span className="estate-arrival__lake" />
        <span className="estate-arrival__stables" />
        <span className="estate-arrival__hotel" />
        <span className="estate-arrival__tree estate-arrival__tree--left" />
        <span className="estate-arrival__tree estate-arrival__tree--right" />
        <span className="estate-arrival__road" />
        <span className="estate-arrival__taxi">
          <i className="estate-arrival__taxi-sign">B&amp;B</i>
          <i className="estate-arrival__taxi-window" />
          <i className="estate-arrival__taxi-wheel estate-arrival__taxi-wheel--front" />
          <i className="estate-arrival__taxi-wheel estate-arrival__taxi-wheel--back" />
        </span>
      </div>

      <div className="estate-arrival__card">
        <p className="estate-arrival__eyebrow">
          <span aria-hidden="true" /> Deine erste Ankunft
        </p>
        <h2 id="estate-arrival-title">Das Taxi wartet am Tor.</h2>
        <p id="estate-arrival-copy">
          Bevor du aussteigst, suchst du dir einen Look für diesen Besuch aus.
          Birdie empfängt dich gleich persönlich am Ankunftshof.
        </p>

        <fieldset className="estate-arrival__styles">
          <legend>Dein Look für heute</legend>
          <div className="estate-arrival__style-grid">
            {ESTATE_AVATAR_STYLES.map((style) => (
              <label
                key={style.id}
                className="estate-arrival__style"
                data-avatar-style={style.id}
                data-selected={selectedStyle === style.id ? "true" : "false"}
              >
                <input
                  type="radio"
                  name="estate-avatar-style"
                  value={style.id}
                  checked={selectedStyle === style.id}
                  onChange={() => onSelectStyle(style.id)}
                />
                <span className="estate-arrival__avatar" aria-hidden="true">
                  <i />
                </span>
                <span>
                  <small>{style.eyebrow}</small>
                  <strong>{style.label}</strong>
                  <em>{style.description}</em>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className="estate-arrival__boundary">
          Nur für diese Sitzung · keine Speicherung · jederzeit neu wählbar
        </p>
        <button
          ref={arriveRef}
          className="estate-arrival__primary"
          type="button"
          onClick={onArrive}
        >
          Am Ankunftshof aussteigen
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
