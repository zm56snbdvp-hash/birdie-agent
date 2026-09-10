import React from "react";
import { EMERALD_BASE_CSS } from "./emerald-world-base";
import { EMERALD_COLLECTIBLE_CSS } from "./emerald-world-collectibles";
export const EMERALD_WORLD_DESIGN_VERSION = "emerald-world-pass-06";
export const EMERALD_WORLD_CSS = EMERALD_BASE_CSS + EMERALD_COLLECTIBLE_CSS;
export function EmeraldWorldSkin() {
  return <style data-birdieworld-design={EMERALD_WORLD_DESIGN_VERSION}>{EMERALD_WORLD_CSS}</style>;
}
