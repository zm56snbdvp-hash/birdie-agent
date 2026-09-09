import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_HOLES, simulateShot } from '../src/features/game/shot-engine.ts';
import { prepareCourseShot, sampleCourseShot, isPreparedCourseShot } from '../src/features/game/course-flight.ts';
const input = (hole = COURSE_HOLES[0], extra = {}) => ({ remaining: hole.distance, lie: 'TEE', strokeNumber: 1, player: { power: 5, precision: 5, control: 5, recovery: 5, focus: 5 }, club: { kind: 'DRIVER', w: 1, p: 1, k: 1 }, hole, timingMeter: 50, ...extra });
const plan = (i, id = 'round:1:shot:1') => prepareCourseShot(id, i, simulateShot(i));
const deepFreeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; };

for (const hole of COURSE_HOLES) test(`hole ${hole.id}: 15 timing/mode combinations preserve exact engine endpoint`, () => {
  for (const timingMeter of [0, 20, 50, 65, 100]) for (const mode of ['CONTROL', 'STANDARD', 'ATTACK']) {
    const i = input(hole, { timingMeter, mode }), r = simulateShot(i), shot = prepareCourseShot('h'+hole.id, i, r);
    const end = sampleCourseShot(shot, shot.totalMs);
    assert.equal(end.x, r.positionLateral); assert.equal(end.z, r.positionForward); assert.equal(end.y, 0); assert.equal(end.phase, 'done');
    for (let t = 0; t <= shot.totalMs; t += 11) {
      const f = sampleCourseShot(shot, t);
      for (const n of [f.x, f.y, f.z, f.opacity, f.progress]) assert.ok(Number.isFinite(n));
      assert.ok(f.y >= -1e-10); assert.ok(f.opacity >= 0 && f.opacity <= 1);
    }
  }
});
test('frozen source input and result are not mutated by 500 samples', () => {
  const i = input(); const r = simulateShot(i); const before = JSON.stringify([i,r]); deepFreeze(i); deepFreeze(r);
  const s = prepareCourseShot('freeze',i,r);
  for (let n=0;n<500;n++) sampleCourseShot(s,n*12);
  assert.equal(JSON.stringify([i,r]),before); assert.notEqual(s.result,r); assert.ok(Object.isFrozen(s.result)); assert.ok(Object.isFrozen(s));
});
test('presentation snapshot cannot change if caller subsequently mutates its result', () => {
  const i=input(), r=simulateShot(i), s=prepareCourseShot('copy',i,r), x=s.result.positionLateral;
  r.positionLateral=900; assert.equal(sampleCourseShot(s,s.totalMs).x,x);
});
test('swing and flight meet continuously; flight and roll share the landing point', () => {
  const s=plan(input()); const a=sampleCourseShot(s,s.swingMs); assert.equal(a.x,0); assert.equal(a.y,0); assert.equal(a.z,0);
  const b=sampleCourseShot(s,s.swingMs+s.flightMs); assert.equal(b.x,s.result.flightLateral); assert.equal(b.z,s.result.flightForward); assert.equal(b.y,0);
  const c=sampleCourseShot(s,s.swingMs+s.flightMs-.001); assert.ok(Math.hypot(c.x-b.x,c.y-b.y,c.z-b.z)<.01);
});
test('putt stays on ground and has no flight or bounce', () => {
  const s=plan(input(COURSE_HOLES[4],{club:{kind:'PUTTER',w:1,p:1,k:1},lie:'GREEN',remaining:10,timingMeter:75}));
  assert.equal(s.flightMs,0); for(let t=0;t<s.totalMs;t+=7) {const f=sampleCourseShot(s,t);assert.equal(f.y,0);assert.notEqual(f.phase,'flight');}
});
test('ONE READ ends hidden at the exact holed endpoint', () => {
  const s=plan(input(COURSE_HOLES[0],{club:{kind:'PUTTER',w:1,p:1,k:1},lie:'GREEN',remaining:8,signature:true}));
  assert.equal(s.result.holed,true); const f=sampleCourseShot(s,s.totalMs);assert.equal(f.z,8);assert.equal(f.opacity,0);
});
test('water penalty fades at impact then returns to official spot, never rolls backwards', () => {
  const s=plan(input(COURSE_HOLES[2],{timingMeter:0}));assert.equal(s.result.penalty,1);
  const f=sampleCourseShot(s,s.swingMs+s.flightMs+s.settleMs*.5);assert.equal(f.phase,'penalty');assert.equal(f.z,s.result.flightForward);assert.equal(f.opacity,.5);
  assert.equal(sampleCourseShot(s,s.totalMs).z,0);
});
test('reduced motion immediately reaches the unchanged endpoint', () => {
  const s=plan(input());assert.deepEqual(sampleCourseShot(s,0,true),sampleCourseShot(s,s.totalMs));
});
test('late and negative times are safely bounded', () => {
  const s=plan(input());assert.deepEqual(sampleCourseShot(s,-9),sampleCourseShot(s,0));assert.deepEqual(sampleCourseShot(s,1e9),sampleCourseShot(s,s.totalMs));
});
test('invalid or unprepared snapshots and non-finite times fail closed', () => {
  const s=plan(input());assert.ok(isPreparedCourseShot(s));assert.equal(isPreparedCourseShot({...s}),false);
  assert.throws(()=>sampleCourseShot({...s},0)); for(const t of [NaN,Infinity,-Infinity]) assert.throws(()=>sampleCourseShot(s,t));
});
test('bad identities, coordinates and completed-hole inputs are rejected', () => {
  const i=input(), r=simulateShot(i);
  for(const id of ['', ' ', 'x'.repeat(201)]) assert.throws(()=>prepareCourseShot(id,i,r));
  for(const remaining of [0,-1,NaN,Infinity,10001]) assert.throws(()=>prepareCourseShot('bad',{...i,remaining},r));
  for(const key of ['flightForward','flightLateral','positionForward','positionLateral','carry','roll','remaining','penalty']) assert.throws(()=>prepareCourseShot('bad',i,{...r,[key]:NaN}));
  assert.throws(()=>prepareCourseShot('bad',i,{...r,penalty:.5}));
});
test('presentation does not require browser APIs or a second engine resolution', () => {
  const i=input(), r=simulateShot(i), snapshot=JSON.stringify(r);const s=prepareCourseShot('one-resolution',i,r);
  for(let t=0;t<s.totalMs;t+=16) sampleCourseShot(s,t);assert.equal(JSON.stringify(r),snapshot);
});
