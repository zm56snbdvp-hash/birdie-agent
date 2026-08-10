function resultBody(data, source = "BIRDIE_OS") {
  return {
    success: true,
    authoritative: true,
    source,
    data
  };
}

function match(pathname, expression) {
  const result = pathname.match(expression);
  return result ? result.slice(1).map(decodeURIComponent) : null;
}

export async function routeCoinRequest({ req, res, url, json, readBody, service }) {
  if (!url.pathname.startsWith("/coin")) {
    return false;
  }

  if (req.method === "GET" && url.pathname === "/coin/config") {
    json(res, 200, resultBody(service.getConfig(), "BIRDIE_COIN_CONFIG"));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/coin/profiles") {
    json(res, 201, resultBody(await service.createProfile(await readBody(req))));
    return true;
  }

  const profileMatch = match(url.pathname, /^\/coin\/profiles\/([^/]+)$/);
  if (req.method === "GET" && profileMatch) {
    json(res, 200, resultBody(await service.getProfile(profileMatch[0])));
    return true;
  }

  const ledgerMatch = match(url.pathname, /^\/coin\/profiles\/([^/]+)\/ledger$/);
  if (req.method === "GET" && ledgerMatch) {
    json(res, 200, resultBody(await service.getLedger(ledgerMatch[0])));
    return true;
  }

  const badgeMatch = match(url.pathname, /^\/coin\/profiles\/([^/]+)\/badges$/);
  if (req.method === "POST" && badgeMatch) {
    json(
      res,
      201,
      resultBody(await service.awardBadge(badgeMatch[0], await readBody(req)))
    );
    return true;
  }

  if (req.method === "POST" && url.pathname === "/coin/claims") {
    json(res, 201, resultBody(await service.createClaim(await readBody(req))));
    return true;
  }

  const claimDecisionMatch = match(
    url.pathname,
    /^\/coin\/claims\/([^/]+)\/decision$/
  );
  if (req.method === "POST" && claimDecisionMatch) {
    json(
      res,
      200,
      resultBody(
        await service.decideClaim(claimDecisionMatch[0], await readBody(req))
      )
    );
    return true;
  }

  if (req.method === "GET" && url.pathname === "/coin/rewards") {
    json(
      res,
      200,
      resultBody(await service.listRewards(url.searchParams.get("accountType")))
    );
    return true;
  }

  if (req.method === "GET" && url.pathname === "/coin/admin/queue") {
    json(res, 200, resultBody(await service.getAdminQueue()));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/coin/redemptions") {
    json(res, 201, resultBody(await service.createRedemption(await readBody(req))));
    return true;
  }

  const redemptionDecisionMatch = match(
    url.pathname,
    /^\/coin\/redemptions\/([^/]+)\/decision$/
  );
  if (req.method === "POST" && redemptionDecisionMatch) {
    json(
      res,
      200,
      resultBody(
        await service.decideRedemption(
          redemptionDecisionMatch[0],
          await readBody(req)
        )
      )
    );
    return true;
  }

  if (req.method === "POST" && url.pathname === "/coin/opening-balances") {
    json(
      res,
      201,
      resultBody(await service.importOpeningBalance(await readBody(req)))
    );
    return true;
  }

  json(res, 404, {
    success: false,
    error: "COIN_ROUTE_NOT_FOUND"
  });
  return true;
}
