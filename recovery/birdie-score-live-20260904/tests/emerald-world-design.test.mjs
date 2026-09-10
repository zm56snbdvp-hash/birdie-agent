import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
test('Emerald skin is complete and presentation-only',()=>{
 const skin=read('src/components/EmeraldWorldSkin.tsx'),css=read('src/components/emerald-world-base.ts')+read('src/components/emerald-world-collectibles.ts');
 assert.match(skin,/emerald-world-pass-06/);assert.match(skin,/export function EmeraldWorldSkin/);assert.match(css,/\.bw-world/);assert.match(css,/prefers-reduced-motion/);
 assert.doesNotMatch(skin+css,/fetch\(|localStorage|sessionStorage|COIN_TRANSACTIONS|simulateShot/);
});
test('Vault retains existing booster and starter request contracts',()=>{
 const s=read('src/features/card-vault/CardVault.tsx');
 for(const v of ['/api/starter-set/claim','/api/boosters/open','applyBoosterOpening','applyStarterSet','1. Edition · 3 Karten'])assert.ok(s.includes(v));
 assert.match(s,/idempotencyKey:\s*crypto\.randomUUID\(\)/);
});
test('Deck keeps its existing validation and PUT endpoint',()=>{
 const s=read('src/features/deck-builder/DeckBuilder.tsx');assert.match(s,/validateDeckSelection/);assert.ok(s.includes('/api/deck'));assert.match(s,/method:\s*"PUT"/);assert.match(s,/DECK_RULES\.playableCardCount/);
});
test('UI never resolves another shot or writes from the renderer',()=>{
 const game=read('src/features/game/GameApp.tsx'),scene=read('src/features/game/CourseScene.tsx');
 assert.match(game,/drawAtHoleStart\(next\)/);assert.match(scene,/createCourseScene/);assert.doesNotMatch(game+scene,/simulateShot\(|prepareCourseShot\(|fetch\(|COIN_TRANSACTIONS/);
});
