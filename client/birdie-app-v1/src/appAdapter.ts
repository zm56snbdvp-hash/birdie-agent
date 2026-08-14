// Sandbox-only client bridge. It reuses repository domain adapters and exposes no BirdieOS company-data route.
// @ts-expect-error repository sandbox module is plain ESM without TS declarations
import { createBirdieAppSandboxAdapter } from "../../../src/app/sandbox-adapter.mjs";
// @ts-expect-error repository sandbox module is plain ESM without TS declarations
import { createBallPassportProjectionAdapter } from "../../../src/app/ball-passport-adapter.mjs";
// @ts-expect-error repository sandbox module is plain ESM without TS declarations
import { createPersonalBirdieGateway } from "../../../src/app/personal-birdie-gateway.mjs";
// @ts-expect-error repository sandbox module is plain ESM without TS declarations
import { createRoundModeSandbox } from "../../../src/round-mode/service.mjs";
// @ts-expect-error repository sandbox module is plain ESM without TS declarations
import { createDeterministicClock } from "../../../src/round-mode/simulator.mjs";

export type RoundSummaryDto = { contractVersion:"birdie-app-v1"; roundId:string; birdieId:string; courseRef:string|null; teeRef:string|null; holeCount:number; startedAt:string; finishedAt:string|null; status:"ACTIVE"|"COMPLETED"|"ABANDONED"; totals:{strokes:number;putts:number;penalties:number;scoredHoles:number} };
export type RoundHoleDto = { contractVersion:"birdie-app-v1"; roundId:string; holeNumber:number; par:null; strokes:number|null; putts:number|null; penalties:number|null; scoreRevision:number; completionState:"SCORED"|"UNSCORED" };
export type RoundDetailDto = { contractVersion:"birdie-app-v1"; round:RoundSummaryDto; holes:RoundHoleDto[]; courseDataMode:"REFERENCE_ONLY"|"UNSPECIFIED"; gpsDataUsed:false; sandbox:true };
export type ObjectEventDto = { contractVersion:"birdie-app-v1"; eventId:string; objectId:string; eventType:string; occurredAt:string; roundId:string|null; holeNumber:number|null; privacyClass:"PRIVATE"|"COARSE"|"PUBLIC"; courseName:string|null; locationLabel:string|null; ruleVersion:string };
export type BallPassportDto = { contractVersion:"birdie-app-v1"; objectId:string; ownerBirdieId:string; displayName:string; editionId:string|null; rarity:string|null; state:string; privacySafeStats:{rounds:number;holesSurvived:number;courses:number;birdiesWitnessed:number}; journey:ObjectEventDto[] };
export type PersonalBirdieReplyDto = { contractVersion:"birdie-app-v1"; birdieId:string; mode:"SANDBOX"; refused:boolean; reply:string; contextDomainsUsed?:string[] };

export interface BirdieAppAdapter {
  getGolfHistory(birdieId:string):Promise<RoundSummaryDto[]>;
  getRoundDetail(roundId:string,birdieId:string):Promise<RoundDetailDto|null>;
  getOwnedBallPassports(birdieId:string):Promise<BallPassportDto[]>;
  getBallPassport(objectId:string,birdieId:string):Promise<BallPassportDto|null>;
  chatWithPersonalBirdie(birdieId:string,message:string):Promise<PersonalBirdieReplyDto>;
}

const engine = createRoundModeSandbox({ now:createDeterministicClock() });
const demoRound = engine.startRound({ birdieId:"BIRDIE-SANDBOX-001", courseRef:"SANDBOX-COURSE", holeCount:3 });
for (const [holeNumber, score] of [[1,{strokes:4,putts:2}],[2,{strokes:5,penalties:1}],[3,{strokes:4}]] as const) {
  engine.activateHole(demoRound.roundId,holeNumber); engine.recordHoleScore(demoRound.roundId,holeNumber,score); engine.completeHole(demoRound.roundId,holeNumber);
}
engine.endRound(demoRound.roundId);
const roundAdapter = createBirdieAppSandboxAdapter({ roundEngine:engine });

const passportAdapter = createBallPassportProjectionAdapter({
  objects:[{objectId:"BALL-SANDBOX-001",objectType:"BALL",displayName:"First Edition Living Ball #001",editionCode:"FIRST_EDITION",rarity:"COMMON_RARE",state:"RESTING",holesSurvived:27}],
  ownership:[{objectId:"BALL-SANDBOX-001",ownerBirdieId:"BIRDIE-SANDBOX-001",status:"ACTIVE"}],
  events:[
    {eventId:"BALL-EVT-001",objectId:"BALL-SANDBOX-001",eventType:"COURSE_VISIT",occurredAt:"2026-08-10T10:00:00.000Z",roundId:demoRound.roundId,privacyClass:"COARSE",courseName:"SANDBOX-COURSE",locationLabel:"Private hole detail",ruleVersion:"birdie-dna-v1"},
    {eventId:"BALL-EVT-002",objectId:"BALL-SANDBOX-001",eventType:"FIRST_BIRDIE",occurredAt:"2026-08-10T10:30:00.000Z",roundId:demoRound.roundId,privacyClass:"PUBLIC",courseName:"SANDBOX-COURSE",locationLabel:"Hole 2",ruleVersion:"birdie-dna-v1"},
    {eventId:"BALL-EVT-003",objectId:"BALL-SANDBOX-001",eventType:"COMMUNITY_EVENT",occurredAt:"2026-08-11T09:00:00.000Z",privacyClass:"PRIVATE",courseName:"Hidden",locationLabel:"Exact private place",ruleVersion:"birdie-dna-v1"}
  ]
});

async function history(birdieId:string){ return roundAdapter.getGolfHistory(birdieId).rounds as RoundSummaryDto[]; }
async function passports(birdieId:string){ return passportAdapter.getOwnedBallPassports(birdieId).passports as BallPassportDto[]; }

const personalBirdieGateway = createPersonalBirdieGateway({
  async getProfile(birdieId:string){ return {contractVersion:"birdie-app-v1",birdieId,displayName:"Sandbox Golfer",golfProfile:{homeClubRef:null,handicapDisplay:null}}; },
  async getGolfHistory(birdieId:string){ return history(birdieId); },
  async getGolfStats(birdieId:string){ const rounds=await history(birdieId); return {birdieId,rounds:rounds.length,totalStrokes:rounds.reduce((sum,r)=>sum+r.totals.strokes,0)}; },
  async getOwnedBallPassports(birdieId:string){ return passports(birdieId); },
  async getAchievements(){ return [{code:"FIRST_ROUND",label:"First round recorded"}]; },
  async getPreferences(){ return {companionTone:"supportive"}; },
  async getPublicBirdieContent(){ return [{title:"Because every golfer deserves another shot."}]; }
});

export const sandboxAdapter:BirdieAppAdapter = {
  getGolfHistory: history,
  async getRoundDetail(roundId,birdieId){ return roundAdapter.getRoundDetail(roundId,birdieId) as RoundDetailDto|null; },
  getOwnedBallPassports: passports,
  async getBallPassport(objectId,birdieId){ return passportAdapter.getBallPassport(objectId,birdieId) as BallPassportDto|null; },
  async chatWithPersonalBirdie(birdieId,message){ return personalBirdieGateway.chat({birdieId,message}) as Promise<PersonalBirdieReplyDto>; }
};
