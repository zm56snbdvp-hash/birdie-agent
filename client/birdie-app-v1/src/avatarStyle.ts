export const ESTATE_AVATAR_STYLE_IDS = [
  "fairway",
  "clubhouse",
  "after-hours"
] as const;

export type EstateAvatarStyleId = (typeof ESTATE_AVATAR_STYLE_IDS)[number];

export interface EstateAvatarStyleDefinition {
  id: EstateAvatarStyleId;
  label: string;
  eyebrow: string;
  description: string;
}

export const ESTATE_AVATAR_STYLES: readonly EstateAvatarStyleDefinition[] = [
  {
    id: "fairway",
    label: "Fairway",
    eyebrow: "Waldgrün · Gold",
    description: "Der klassische Birdie & Breakfast Look."
  },
  {
    id: "clubhouse",
    label: "Clubhouse",
    eyebrow: "Creme · Waldgrün",
    description: "Hell, ruhig und direkt bereit zum Ankommen."
  },
  {
    id: "after-hours",
    label: "After Hours",
    eyebrow: "Anthrazit · Gold",
    description: "Der späte Estate-Look mit warmem Akzent."
  }
] as const;

