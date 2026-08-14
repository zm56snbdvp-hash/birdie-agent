export async function routeCommunityIdentityRequest({
  req,
  res,
  url,
  json,
  readBody,
  service
}) {
  if (req.method === "POST" && url.pathname === "/community/identity/evidence") {
    const body = await readBody(req);
    const result = await service.produceEvidenceByWorkItemId(
      body.workItemId,
      body.providerIdentity
    );

    json(res, 200, {
      success: true,
      source: "PROVIDER_EVIDENCE_V1",
      module: "COMMUNITY_IDENTITY_EVIDENCE",
      data: result
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/community/identity/resolve") {
    const body = await readBody(req);
    const result = await service.resolveByWorkItemId(body.workItemId, body.evidence);

    json(res, 200, {
      success: true,
      source: "BIRDIE_OS",
      module: "COMMUNITY_IDENTITY_RESOLUTION",
      data: result
    });
    return true;
  }

  return false;
}
