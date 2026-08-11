export async function routeCommunityIdentityRequest({
  req,
  res,
  url,
  json,
  readBody,
  service
}) {
  if (req.method === "POST" && url.pathname === "/community/identity/resolve") {
    const body = await readBody(req);
    const result = await service.resolveByWorkItemId(body.workItemId);

    return json(res, 200, {
      success: true,
      source: "BIRDIE_OS",
      module: "COMMUNITY_IDENTITY_RESOLUTION",
      data: result
    });
  }

  return false;
}
