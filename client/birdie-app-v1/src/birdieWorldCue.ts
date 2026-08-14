import type { BirdieWorldDestination } from "./birdieDestinations";
import type {
  BirdieWorldContextProjection,
  BirdieWorldZone
} from "./worldContext";

export interface BirdieWorldCue {
  zone: BirdieWorldZone;
  eyebrow: string;
  title: string;
  copy: string;
  launcher: string;
  recommendation: BirdieWorldDestination | null;
  recommendationReason: string;
}

const WORLD_CUES: Readonly<Record<BirdieWorldZone, BirdieWorldCue>> = {
  "arrival-path": {
    zone: "arrival-path",
    eyebrow: "Du bist angekommen",
    title: "Die Lichter führen dich nach Hause.",
    copy:
      "Ich sehe nur die grobe Weltzone. Von hier aus kann ich dich orientieren, ohne eine Route, Position oder Entscheidung zu speichern.",
    launcher: "Am Ankunftsweg · ich orientiere dich",
    recommendation: "personal-birdie",
    recommendationReason:
      "Personal Birdie ist der natürliche erste Gesprächsort, bevor du tiefer in deine Geschichte gehst."
  },
  "hotel-entrance": {
    zone: "hotel-entrance",
    eyebrow: "Vor dem Hotel",
    title: "Die Tür reagiert auf dich.",
    copy:
      "Der Hotel Hub ist dein räumlicher Einstieg. Dahinter wohnen Golf History, Ball Vault und Personal Birdie – nicht mehr und nicht weniger.",
    launcher: "Am Hoteleingang · ich orientiere dich",
    recommendation: "personal-birdie",
    recommendationReason:
      "Personal Birdie kann dich hier zuerst orientieren, bevor du einen der drei bestehenden Bereiche öffnest."
  },
  "putting-green": {
    zone: "putting-green",
    eyebrow: "Am Putting Green",
    title: "Jeder Schlag hat eine Vorgeschichte.",
    copy:
      "Dieser Ort erinnert an Training und Fortschritt. Ich kann dich zu den Runden führen, aus denen dieser Fortschritt entstanden ist.",
    launcher: "Am Putting Green · Fortschritt im Blick",
    recommendation: "golf-history",
    recommendationReason:
      "Golf History ist hier die passendste Fortsetzung von Training und Entwicklung."
  },
  terrace: {
    zone: "terrace",
    eyebrow: "Auf der Terrasse",
    title: "Das ist ein guter Ort für ein Gespräch.",
    copy:
      "Die Terrasse steht für Ankommen, Austausch und Gemeinschaft. Ich kann hier deinen freigegebenen Golf-Kontext öffnen – und nichts Internes.",
    launcher: "Auf der Terrasse · Zeit für ein Gespräch",
    recommendation: "personal-birdie",
    recommendationReason:
      "Personal Birdie passt zur warmen, persönlichen Gesprächssituation dieses Ortes."
  },
  "hotel-grounds": {
    zone: "hotel-grounds",
    eyebrow: "Auf dem Gelände",
    title: "Manche Dinge tragen ihre Reise mit sich.",
    copy:
      "Während du die Welt erkundest, kann ich dich zu den eigenen Birdie-Bällen führen, deren Pässe und Reisen bereits sicher abgegrenzt sind.",
    launcher: "Auf dem Gelände · deine Begleiter sind nah",
    recommendation: "ball-vault",
    recommendationReason:
      "Der Ball Vault macht aus Bewegung durch die Welt eine sichtbare Objektgeschichte."
  }
} as const;

export function getBirdieWorldCue(
  context: BirdieWorldContextProjection | null | undefined
): BirdieWorldCue | null {
  if (!context) return null;
  const cue = WORLD_CUES[context.zone];

  // The projection remains the source of truth for the optional suggestion.
  // Mismatch does not navigate automatically; it simply suppresses the badge.
  return cue.recommendation === context.suggestedDestination
    ? cue
    : { ...cue, recommendation: null };
}
