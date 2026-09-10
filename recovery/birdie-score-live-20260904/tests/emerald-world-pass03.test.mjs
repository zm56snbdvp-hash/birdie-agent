import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
test("artifact card frame derives family and rarity from canonical card",()=>{const source=read("src/components/EmeraldCardFrame.tsx");assert.match(source,/card\.family/);assert.match(source,/card\.rarity/);assert.match(source,/CardArtwork/);assert.doesNotMatch(source,/fetch\(|localStorage|sessionStorage|simulateShot/)});
test("booster pack is presentation only",()=>{const source=read("src/components/EmeraldBoosterPack.tsx");assert.match(source,/FIRST EDITION/);assert.match(source,/3 DIGITAL CARDS/);assert.doesNotMatch(source,/fetch\(|crypto\.randomUUID|COIN_TRANSACTIONS/)});
test("vault preserves booster authority and idempotency",()=>{const source=read("src/features/card-vault/CardVault.tsx");assert.match(source,/fetch\("\/api\/boosters\/open"/);assert.match(source,/idempotencyKey:crypto\.randomUUID\(\)/);assert.match(source,/applyBoosterOpening/);assert.match(source,/EmeraldCardFrame/);assert.match(source,/EmeraldBoosterPack/)});
test("gameplay keeps draw authority while adopting artifact cards",()=>{const source=read("src/features/game/GameApp.tsx");assert.match(source,/drawAtHoleStart\(next\)/);assert.match(source,/CourseScene hole=\{COURSE_HOLES\[hole-1\]\} shot=\{courseShot\}/);assert.match(source,/EmeraldCardFrame/);assert.doesNotMatch(source,/simulateShot\(/)});
