export const AFFILIATE_PROVIDER = Object.freeze({
  GOLF_UND_GUENSTIG_DE: Object.freeze({
    id: "golf-und-guenstig-de",
    network: "AWIN",
    advertiserId: "11742",
    region: "DE",
    enabledByDefault: false,
    catalogMode: "AWIN_DATAFEED"
  }),
  GOLF_HOUSE_DE: Object.freeze({
    id: "golf-house-de",
    network: "AWIN",
    advertiserId: "11593",
    region: "DE",
    enabledByDefault: false,
    catalogMode: "AWIN_DATAFEED"
  }),
  DECATHLON_DE: Object.freeze({
    id: "decathlon-de",
    network: "AWIN",
    advertiserId: "14353",
    region: "DE",
    enabledByDefault: false,
    catalogMode: "AWIN_DATAFEED"
  }),
  SHOT_SCOPE: Object.freeze({
    id: "shot-scope",
    network: "REFERSION",
    region: "DE",
    enabledByDefault: false,
    catalogMode: "DIRECT"
  }),
  SUPERSPEED_GOLF: Object.freeze({
    id: "superspeed-golf",
    network: "AFFILIATLY",
    region: "DE",
    enabledByDefault: false,
    catalogMode: "DIRECT"
  })
});

export function awinAdvertiserIds({ enabledProviderIds = [] } = {}) {
  const enabled = new Set(enabledProviderIds);
  return Object.values(AFFILIATE_PROVIDER)
    .filter((provider) => provider.network === "AWIN")
    .filter((provider) => provider.enabledByDefault || enabled.has(provider.id))
    .map((provider) => provider.advertiserId);
}

export function affiliateProviderById(providerId) {
  return Object.values(AFFILIATE_PROVIDER).find((provider) => provider.id === providerId) ?? null;
}
