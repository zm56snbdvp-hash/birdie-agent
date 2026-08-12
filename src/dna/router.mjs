function resultBody(data, source = "BIRDIE_DNA") {
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

export async function routeDnaRequest({ req, res, url, json, readBody, service }) {
  if (!url.pathname.startsWith("/dna")) return false;

  if (req.method === "GET" && url.pathname === "/dna/config") {
    json(res, 200, resultBody(await service.getConfig(), "BIRDIE_DNA_CONFIG"));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/dna/objects") {
    json(res, 201, resultBody(await service.createObject(await readBody(req))));
    return true;
  }

  const objectMatch = match(url.pathname, /^\/dna\/objects\/([^/]+)$/);
  if (req.method === "GET" && objectMatch) {
    json(res, 200, resultBody(await service.getObject(objectMatch[0])));
    return true;
  }

  const passportMatch = match(url.pathname, /^\/dna\/passports\/([^/]+)$/);
  if (req.method === "GET" && passportMatch) {
    json(res, 200, resultBody(await service.getPassport(passportMatch[0]), "BIRDIE_DNA_PASSPORT"));
    return true;
  }

  const eventCreateMatch = match(url.pathname, /^\/dna\/objects\/([^/]+)\/events$/);
  if (req.method === "POST" && eventCreateMatch) {
    json(
      res,
      201,
      resultBody(await service.createEvent(eventCreateMatch[0], await readBody(req)))
    );
    return true;
  }

  const eventDecisionMatch = match(url.pathname, /^\/dna\/events\/([^/]+)\/decision$/);
  if (req.method === "POST" && eventDecisionMatch) {
    json(
      res,
      200,
      resultBody(await service.decideEvent(eventDecisionMatch[0], await readBody(req)))
    );
    return true;
  }

  const transferCreateMatch = match(url.pathname, /^\/dna\/objects\/([^/]+)\/transfers$/);
  if (req.method === "POST" && transferCreateMatch) {
    json(
      res,
      201,
      resultBody(await service.initiateTransfer(transferCreateMatch[0], await readBody(req)))
    );
    return true;
  }

  const transferAcceptMatch = match(url.pathname, /^\/dna\/transfers\/([^/]+)\/accept$/);
  if (req.method === "POST" && transferAcceptMatch) {
    json(
      res,
      200,
      resultBody(await service.acceptTransfer(transferAcceptMatch[0], await readBody(req)))
    );
    return true;
  }

  json(res, 404, { success: false, error: "DNA_ROUTE_NOT_FOUND" });
  return true;
}
