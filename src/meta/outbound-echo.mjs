function clean(v){return String(v??"").trim()}
function ref(v){const x=clean(v);if(!/^[A-Za-z0-9._:-]{1,200}$/.test(x)){const e=new Error("Invalid Instagram message reference");e.code="META_ECHO_REFERENCE_INVALID";throw e}return x}
export function normalizeInstagramOutboundEcho(item,{providerMessageId}={}){
 const message=item?.message??{}; if(message.is_echo!==true)return null;
 const echoMessageId=ref(message.mid); const correlatedProviderMessageId=ref(providerMessageId??message.metadata?.provider_message_id??message.reply_to?.mid??message.mid);
 const attachments=Array.isArray(message.attachments)?message.attachments:[];
 const hasNativeStickerOrGif=attachments.some(a=>["sticker","gif"].includes(clean(a?.type).toLowerCase()));
 return {eventType:"IG_OUTBOUND_ECHO",providerMessageId:correlatedProviderMessageId,echoMessageId,recipientScopedId:clean(item?.recipient?.id),detectedAt:new Date(Number(item?.timestamp)||Date.now()).toISOString(),nativeAssetUnverifiable:hasNativeStickerOrGif,coinWriteAllowed:false,identityProofAllowed:false,idempotencyKey:`ig:outbound-echo:${correlatedProviderMessageId}:${echoMessageId}`};
}
