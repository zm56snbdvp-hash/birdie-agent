import crypto from "node:crypto";

const OUTREACH_FIELDS = ["outreachEventId","channel","recipientScopedId","instagramHandle","triggerEventId","intentType","templateContentId","templateVersion","assetReleaseId","provider","providerMessageId","echoMessageId","eligibilityState","sendStatus","sentAt","echoAt","repliedAt","optedInAt","correlationConfidence","failureCode","idempotencyKey","notes"];

function err(code, message = code, status = 400) { const e = new Error(message); e.code = code; e.status = status; return e; }
function clean(v) { return String(v ?? "").trim(); }
function handle(v) { const x=clean(v).toLowerCase().replace(/^@/,""); if(!/^[a-z0-9._]{1,30}$/.test(x)) throw err("OUTREACH_HANDLE_INVALID"); return x; }
function mid(v) { const x=clean(v); if(!/^[A-Za-z0-9._:-]{1,200}$/.test(x)) throw err("OUTREACH_MESSAGE_ID_INVALID"); return x; }
function key(parts) { return crypto.createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0,32); }
function eventId(k){ return `OUT-${k.slice(0,20).toUpperCase()}`; }
function nowIso(now){ return new Date(now()).toISOString(); }

export function createOutreachPlane({ledger, assetRegistry, eligibilityReader, providerSend, permissionReader, now=()=>Date.now()}) {
  for (const [n,v] of Object.entries({ledger,assetRegistry,eligibilityReader,providerSend,permissionReader})) if(!v) throw new Error(`${n} is required`);
  async function append(row){ const safe={}; for(const f of OUTREACH_FIELDS) safe[f]=row[f] ?? ""; return ledger.appendIdempotent(safe); }

  async function sendRegisteredImage({recipientScopedId, instagramHandle, triggerEventId="", intentType="COIN_IMAGE", templateContentId="", templateVersion="", assetReleaseId}) {
    const recipient=mid(recipientScopedId); const ig=handle(instagramHandle); const asset=await assetRegistry.get(clean(assetReleaseId));
    if(!asset || asset.state!=="RELEASED" || !["image/png","image/jpeg"].includes(asset.mimeType) || !asset.providerUrl) throw err("OUTREACH_ASSET_NOT_RELEASED", "Only registered released PNG/JPEG assets may be sent", 403);
    const permission=await permissionReader(); if(permission?.instagram_manage_messages!==true) throw err("OUTREACH_MESSAGING_PERMISSION_MISSING","instagram_manage_messages is not proven",403);
    const eligibility=await eligibilityReader({recipientScopedId:recipient}); if(eligibility?.state!=="ELIGIBLE") throw err("OUTREACH_CONVERSATION_INELIGIBLE","Conversation is not currently eligible",403);
    const idem=`ig:image:${key([recipient,clean(assetReleaseId),clean(triggerEventId),clean(intentType)])}`;
    const existing=await ledger.findByIdempotencyKey(idem); if(existing) return {idempotent:true,event:existing,providerCalled:false};
    const intent=await append({outreachEventId:eventId(key([idem,"intent"])),channel:"INSTAGRAM",recipientScopedId:recipient,instagramHandle:ig,triggerEventId:clean(triggerEventId),intentType:clean(intentType),templateContentId:clean(templateContentId),templateVersion:clean(templateVersion),assetReleaseId:clean(assetReleaseId),provider:"META",eligibilityState:"ELIGIBLE",sendStatus:"SEND_INTENT",idempotencyKey:idem,notes:"Registered image send intent; non-economic."});
    let response; try { response=await providerSend({recipient:{id:recipient},messaging_type:"RESPONSE",message:{attachment:{type:"image",payload:{url:asset.providerUrl}}}}); } catch(e) { await ledger.patch(intent.outreachEventId,{sendStatus:"PROVIDER_AMBIGUOUS",failureCode:"PROVIDER_ERROR_NO_RETRY",notes:"Provider response unclear; automatic retry prohibited."}); throw e; }
    const providerMessageId=clean(response?.message_id ?? response?.messageId); if(!providerMessageId){ await ledger.patch(intent.outreachEventId,{sendStatus:"PROVIDER_AMBIGUOUS",failureCode:"MISSING_PROVIDER_MESSAGE_ID"}); throw err("OUTREACH_PROVIDER_RESPONSE_AMBIGUOUS","Provider did not return message_id",502); }
    const sentAt=nowIso(now); const updated=await ledger.patch(intent.outreachEventId,{providerMessageId:mid(providerMessageId),sendStatus:"SENT",sentAt});
    return {idempotent:false,event:updated,providerCalled:true};
  }

  async function recordEcho({providerMessageId,echoMessageId,recipientScopedId="",timestamp}) {
    const pmid=mid(providerMessageId); const echo=mid(echoMessageId); const existing=await ledger.findByProviderMessageId(pmid);
    if(!existing || existing.sendStatus!=="SENT") return append({outreachEventId:eventId(key(["quarantine",pmid,echo])),channel:"INSTAGRAM",recipientScopedId:clean(recipientScopedId),provider:"META",providerMessageId:pmid,echoMessageId:echo,eligibilityState:"UNKNOWN",sendStatus:"ECHO_QUARANTINED",echoAt:new Date(timestamp).toISOString(),correlationConfidence:"0",failureCode:"ECHO_UNCORRELATED",idempotencyKey:`ig:echo-quarantine:${key([pmid,echo])}`,notes:"Unknown or contradictory outbound echo; non-economic quarantine."});
    if(existing.echoMessageId && existing.echoMessageId!==echo) return append({outreachEventId:eventId(key(["conflict",pmid,echo])),channel:"INSTAGRAM",recipientScopedId:existing.recipientScopedId,instagramHandle:existing.instagramHandle,provider:"META",providerMessageId:pmid,echoMessageId:echo,eligibilityState:existing.eligibilityState,sendStatus:"ECHO_QUARANTINED",echoAt:new Date(timestamp).toISOString(),correlationConfidence:"0",failureCode:"ECHO_CONFLICT",idempotencyKey:`ig:echo-conflict:${key([pmid,echo])}`,notes:"Conflicting echo quarantined; no identity or Coin effect."});
    return ledger.patch(existing.outreachEventId,{echoMessageId:echo,echoAt:new Date(timestamp).toISOString(),correlationConfidence:"100",sendStatus:"ECHO_CONFIRMED"});
  }

  async function stickerSent({instagramHandle,assetReleaseId,operator="FOUNDER"}) { const ig=handle(instagramHandle); const asset=await assetRegistry.get(clean(assetReleaseId)); if(!asset || asset.state!=="RELEASED") throw err("OUTREACH_ASSET_NOT_RELEASED"); const idem=`ig:manual-sticker:${key([ig,clean(assetReleaseId)])}`; const existing=await ledger.findByIdempotencyKey(idem); if(existing) return {idempotent:true,event:existing}; return {idempotent:false,event:await append({outreachEventId:eventId(key([idem,"manual"])),channel:"INSTAGRAM",instagramHandle:ig,intentType:"MANUAL_STICKER_SENT",assetReleaseId:clean(assetReleaseId),provider:"MANUAL_FOUNDER_ATTESTATION",eligibilityState:"FOUNDER_ATTESTED",sendStatus:"SENT_ATTESTED",sentAt:nowIso(now),correlationConfidence:"FOUNDER_ATTESTED",idempotencyKey:idem,notes:`${operator} attested STICKER_SENT; non-economic receipt only.`})}; }

  function onboardingIntent(text){ const t=clean(text).toUpperCase(); if(t!=="BIRDIE" && t!=="CLAIM MY BIRDIE") return null; return {intentType:"BIRDIE_OPT_IN",keyword:t,claimType:"IDENTITY_WELCOME_CLAIM",coinWriteAllowed:false,safeCopy:"Eligible, verified interactions can earn Birdie Coins."}; }
  return {sendRegisteredImage,recordEcho,stickerSent,onboardingIntent,OUTREACH_FIELDS};
}
