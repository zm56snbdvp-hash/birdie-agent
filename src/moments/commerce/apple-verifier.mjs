import { MomentCommerceError } from "./contracts.mjs";

function requireText(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new MomentCommerceError("APPLE_IAP_NOT_CONFIGURED", `${name} is required`, 503);
  }
  return value.trim();
}

function resolveEnvironment(Environment, value) {
  const normalized = requireText(value, "App Store environment").toUpperCase();
  if (normalized === "SANDBOX") return Environment.SANDBOX;
  if (normalized === "PRODUCTION") return Environment.PRODUCTION;
  throw new MomentCommerceError("APPLE_IAP_NOT_CONFIGURED", `Unsupported App Store environment ${value}`, 503);
}

/**
 * Concrete adapter for Apple's official @apple/app-store-server-library.
 * The dependency may be supplied by libraryLoader in tests; runtime defaults to dynamic import.
 */
export async function createAppleSignedTransactionVerifier({
  appleRootCertificates,
  environment,
  bundleId,
  appAppleId,
  enableOnlineChecks = true,
  libraryLoader = () => import("@apple/app-store-server-library")
}) {
  if (!Array.isArray(appleRootCertificates) || appleRootCertificates.length === 0) {
    throw new MomentCommerceError("APPLE_IAP_NOT_CONFIGURED", "Apple root certificates are required", 503);
  }
  const appBundleId = requireText(bundleId, "App bundle ID");
  const library = await libraryLoader().catch((error) => {
    throw new MomentCommerceError(
      "APPLE_IAP_LIBRARY_MISSING",
      `Install @apple/app-store-server-library before App Store runtime activation: ${error?.message ?? error}`,
      503
    );
  });
  if (!library?.SignedDataVerifier || !library?.Environment) {
    throw new MomentCommerceError("APPLE_IAP_LIBRARY_INVALID", "Apple App Store Server Library is incomplete", 503);
  }
  const resolvedEnvironment = resolveEnvironment(library.Environment, environment);
  if (resolvedEnvironment === library.Environment.PRODUCTION && !Number.isInteger(appAppleId)) {
    throw new MomentCommerceError("APPLE_IAP_NOT_CONFIGURED", "appAppleId is required in production", 503);
  }

  const verifier = new library.SignedDataVerifier(
    appleRootCertificates,
    enableOnlineChecks,
    resolvedEnvironment,
    appBundleId,
    resolvedEnvironment === library.Environment.PRODUCTION ? appAppleId : undefined
  );

  return Object.freeze({
    environment: resolvedEnvironment,
    async verifyAndDecodeTransaction(signedTransactionInfo) {
      const jws = requireText(signedTransactionInfo, "signedTransactionInfo");
      return verifier.verifyAndDecodeTransaction(jws);
    }
  });
}
