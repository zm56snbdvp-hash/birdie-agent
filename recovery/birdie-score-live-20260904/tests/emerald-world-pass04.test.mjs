import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
test('HUD cannot write game data',()=>{const s=read('src/components/EmeraldCourseHud.tsx');assert.match(s,/presentation-only/);assert.doesNotMatch(s,/fetch\(|simulateShot|localStorage|COIN_TRANSACTIONS/)});
test('play stage mounts HUD and motion source without second resolution',()=>{const s=read('src/features/game/GameApp.tsx');assert.match(s,/EmeraldCourseHud/);assert.match(s,/bw-floating-hand/);assert.match(s,/shot=\{visibleShot\}/);assert.doesNotMatch(s,/simulateShot\(/)});
test('world portal remains navigation only',()=>{const s=read('src/features/home/EmeraldWorldHome.tsx');assert.match(s,/presentation-only/);assert.match(s,/EmeraldWorldPass04Skin/);assert.doesNotMatch(s,/fetch\(|localStorage|sessionStorage/)});
test('world skin retains portal, hand and result surfaces',()=>{const s=read('src/components/EmeraldWorldPass04Skin.tsx');for(const v of ['bw-world-portal','bw-course-hud','bw-floating-hand','bw-result-rift','prefers-reduced-motion'])assert.ok(s.includes(v))});
