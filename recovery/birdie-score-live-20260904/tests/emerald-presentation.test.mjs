import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRendererPhase, presentationSnapshot, phaseForShot, observeCoursePresentation } from '../src/features/game/emerald-presentation.ts';
const shot = Object.freeze({id:'accepted-1',holeId:1});
const status = (phase='flight', id=shot.id) => ({shotId:id,phase,destroyed:false});
test('renderer phases map without a second clock',()=>{
 assert.deepEqual(['idle','swing','flight','roll','penalty','done','unknown'].map(mapRendererPhase),['idle','swing','flight','settle','settle','result','pending']);
});
test('a supplied shot starts pending, never as an early result',()=>assert.equal(presentationSnapshot(shot,1,null).phase,'pending'));
test('result requires matching accepted renderer identity',()=>{
 assert.equal(presentationSnapshot(shot,1,status('done','other')).phase,'pending');
 assert.equal(presentationSnapshot(shot,1,status('done')).phase,'result');
});
test('wrong-hole and blank IDs cannot animate',()=>{
 assert.equal(presentationSnapshot(shot,2,status()).phase,'idle');
 assert.equal(presentationSnapshot({id:' ',holeId:1},1,status()).shotId,null);
});
test('a destroyed renderer cannot reveal the result',()=>assert.equal(presentationSnapshot(shot,1,{...status('done'),destroyed:true}).phase,'pending'));
test('hidden and offscreen pause decoration but do not complete a shot',()=>{
 for(const options of [{hidden:true},{visible:false}]){
  const s=presentationSnapshot(shot,1,status(),options);assert.equal(s.phase,'flight');assert.equal(s.paused,true);
 }
});
test('reduced motion waits for the renderer to snap to done',()=>{
 assert.equal(presentationSnapshot(shot,1,status('swing'),{reducedMotion:true}).phase,'swing');
 const s=presentationSnapshot(shot,1,status('done'),{reducedMotion:true});assert.equal(s.phase,'result');assert.equal(s.paused,false);assert.equal(s.reducedMotion,true);
});
test('an unavailable renderer is not a fabricated success',()=>assert.equal(presentationSnapshot(shot,1,null,{unavailable:true}).phase,'unavailable'));
test('old snapshot is hidden synchronously when a new shot arrives',()=>{
 const old=presentationSnapshot(shot,1,status('done'));
 assert.equal(phaseForShot({id:'next',holeId:1},old),'pending');assert.equal(phaseForShot({id:shot.id,holeId:2},old),'pending');assert.equal(phaseForShot(undefined,old),'idle');
});
test('input shot and renderer status are not mutated',()=>{
 const original=JSON.stringify(shot),s=Object.freeze(status());presentationSnapshot(shot,1,s,{hidden:true});assert.equal(JSON.stringify(shot),original);assert.equal(s.phase,'flight');
});
function harness(){
 const listeners=new Map();let mutation=null,intersection=null;let disconnects=0;let phase='swing';const events=[];
 const doc={hidden:false,addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key)=>listeners.delete(key),defaultView:{
  MutationObserver:class{constructor(fn){mutation=fn}observe(){}disconnect(){disconnects++}},
  IntersectionObserver:class{constructor(fn){intersection=fn}observe(){}disconnect(){disconnects++}}
 }};
 const observer=observeCoursePresentation({ownerDocument:doc},()=>presentationSnapshot(shot,1,status(phase)),x=>events.push(x));
 return{doc,events,listeners,observer,setPhase:(x)=>{phase=x;mutation()},paint:()=>mutation(),intersect:(v)=>intersection([{isIntersecting:v}]),disconnects:()=>disconnects};
}
test('observer publishes phase changes, not per-frame React updates',()=>{const h=harness();for(let i=0;i<200;i++)h.paint();assert.equal(h.events.length,1);h.setPhase('flight');assert.equal(h.events.length,2);h.observer.dispose()});
test('visibility events pause and resume the same phase',()=>{const h=harness();h.doc.hidden=true;h.listeners.get('visibilitychange')();assert.equal(h.events.at(-1).paused,true);h.doc.hidden=false;h.listeners.get('visibilitychange')();assert.equal(h.events.at(-1).phase,'swing');assert.equal(h.events.at(-1).paused,false);h.observer.dispose()});
test('intersection events pause and resume without timers',()=>{const h=harness();h.intersect(false);assert.equal(h.events.at(-1).paused,true);h.intersect(true);assert.equal(h.events.at(-1).paused,false);h.observer.dispose()});
test('dispose is idempotent and late observer callbacks are ignored',()=>{const h=harness();h.observer.dispose();h.observer.dispose();h.setPhase('done');assert.equal(h.events.length,1);assert.equal(h.listeners.size,0);assert.equal(h.disconnects(),2)});

test('a different object with a reused ID cannot expose an old result',()=>{const old=presentationSnapshot(shot,1,status('done'));assert.equal(phaseForShot({...shot},old),'pending');assert.equal(phaseForShot(shot,old),'result')});
