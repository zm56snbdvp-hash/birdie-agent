import React from "react";
import { CARD_BY_ID, type CanonicalCard } from "../domain/card-catalog";
import { resolveArtwork } from "../domain/card-artwork";
import { DEPLOYED_ARTWORK_MANIFEST } from "../domain/deployed-artwork-manifest";

export interface CardArtworkProps {
  id?: string;
  physicalNumber?: string;
  name: string;
  alt?: string;
  decorative?: boolean;
  back?: boolean;
  priority?: boolean;
  className?: string;
}

const CARD_BACK = "/assets/cards/edition-01/card-back.png";

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function resolveCanonicalCard(id?: string): CanonicalCard | null {
  return id ? CARD_BY_ID.get(id) ?? null : null;
}

/**
 * Fail-safe card renderer.
 *
 * Front artwork is rendered only after exact identity verification through
 * `resolveArtwork`. An existing physical-number JPEG is NOT sufficient.
 */
export function CardArtwork({
  id,
  physicalNumber,
  name,
  alt,
  decorative = false,
  back = false,
  priority = false,
  className,
}: CardArtworkProps) {
  const card = resolveCanonicalCard(id);

  if (back) {
    return (
      <span className={classNames("block aspect-[69/94] overflow-hidden rounded-[inherit] bg-[#07130d]", className)}>
        <img
          src={CARD_BACK}
          alt={decorative ? "" : alt ?? "Verdeckte BirdieWorld First-Edition-Karte"}
          width={1380}
          height={1880}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          className="size-full object-cover object-center"
        />
      </span>
    );
  }

  const resolution = card
    ? resolveArtwork(card, DEPLOYED_ARTWORK_MANIFEST)
    : { status: "MISSING" as const, assetPath: null, reason: "CARD_ID_UNKNOWN" };

  if (resolution.status === "VERIFIED" && resolution.assetPath) {
    return (
      <span className={classNames("block aspect-[69/94] overflow-hidden rounded-[inherit] bg-[#07130d]", className)}>
        <img
          src={resolution.assetPath}
          alt={decorative ? "" : alt ?? `BirdieWorld First Edition: ${name}`}
          width={1380}
          height={1880}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          className="size-full object-cover object-center"
        />
      </span>
    );
  }

  const family = card?.family ?? "INVALID";
  const number = card?.physicalNumber ?? physicalNumber ?? "—";

  return (
    <span
      className={classNames(
        "grid aspect-[69/94] overflow-hidden rounded-[inherit] border border-gold-soft/20",
        "bg-[radial-gradient(circle_at_50%_20%,rgba(215,173,88,.18),transparent_45%),linear-gradient(145deg,#173c27,#07130d)]",
        "px-3 py-4 text-center",
        className,
      )}
      data-card-artwork-status={resolution.status}
      data-card-artwork-reason={resolution.reason ?? undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `${family} ${number}: ${name}. Artwork noch nicht verifiziert.`}
      aria-hidden={decorative ? true : undefined}
    >
      <span className="self-start text-[9px] font-bold uppercase tracking-[.16em] text-gold-soft">{family}</span>
      <span className="self-center text-sm font-semibold leading-tight text-cream-dim">{name}</span>
      <span className="self-end text-[9px] uppercase tracking-[.14em] text-moss">{number} · Artwork wird geprüft</span>
    </span>
  );
}
