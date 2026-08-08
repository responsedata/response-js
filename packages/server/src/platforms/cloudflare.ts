import {
  boundedInteger,
  boundedIntegerArray,
  boundedString,
  compact,
  hasValues,
  isRecord,
  type NetworkEvidence,
  type PlatformEvidence,
} from "./shared";

const createBotEvidence = (cloudflare: Record<string, unknown>) => {
  const botManagement = isRecord(cloudflare.botManagement)
    ? cloudflare.botManagement
    : undefined;
  const jsDetection = isRecord(botManagement?.jsDetection)
    ? botManagement.jsDetection
    : undefined;
  const evidence = compact({
    botScore: boundedInteger(botManagement?.score, 0, 99),
    colo: boundedString(cloudflare.colo, 8),
    corporateProxy:
      typeof botManagement?.corporateProxy === "boolean"
        ? botManagement.corporateProxy
        : undefined,
    detectionIds: boundedIntegerArray(botManagement?.detectionIds, 32),
    ja3Hash: boundedString(botManagement?.ja3Hash, 128),
    ja4: boundedString(botManagement?.ja4, 128),
    jsDetectionPassed:
      typeof jsDetection?.passed === "boolean"
        ? jsDetection.passed
        : undefined,
    signedAgent:
      typeof botManagement?.signedAgent === "boolean"
        ? botManagement.signedAgent
        : undefined,
    staticResource:
      typeof botManagement?.staticResource === "boolean"
        ? botManagement.staticResource
        : undefined,
    verifiedBot:
      typeof botManagement?.verifiedBot === "boolean"
        ? botManagement.verifiedBot
        : undefined,
    verifiedBotCategory: boundedString(cloudflare.verifiedBotCategory, 64),
  });
  return hasValues(evidence) ? evidence : undefined;
};

const createNetworkEvidence = (
  cloudflare: Record<string, unknown>,
): NetworkEvidence =>
  compact({
    asn: boundedInteger(cloudflare.asn, 1, 4_294_967_295),
    city: boundedString(cloudflare.city, 128),
    continent: boundedString(cloudflare.continent, 2),
    country: boundedString(cloudflare.country, 2),
    organization: boundedString(cloudflare.asOrganization, 256),
    region: boundedString(cloudflare.region, 128),
    regionCode: boundedString(cloudflare.regionCode, 16),
    source: "cloudflare" as const,
    timezone: boundedString(cloudflare.timezone, 64),
  }) as NetworkEvidence;

const createTransportEvidence = (cloudflare: Record<string, unknown>) => {
  const transport = compact({
    clientQuicRtt: boundedInteger(cloudflare.clientQuicRtt, 0, 60_000),
    clientTcpRtt: boundedInteger(cloudflare.clientTcpRtt, 0, 60_000),
    httpProtocol: boundedString(cloudflare.httpProtocol, 32),
    tlsCipher: boundedString(cloudflare.tlsCipher, 128),
    tlsVersion: boundedString(cloudflare.tlsVersion, 32),
  });
  return hasValues(transport) ? transport : undefined;
};

export const createCloudflarePlatformEvidence = (
  cloudflare: Record<string, unknown>,
): PlatformEvidence => ({
  ...compact({
    cloudflare: createBotEvidence(cloudflare),
    network: createNetworkEvidence(cloudflare),
    transport: createTransportEvidence(cloudflare),
  }),
});
