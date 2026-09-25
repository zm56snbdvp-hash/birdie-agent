import { buildBirdieBrandPreview } from "../src/framer-brand-preview.mjs";

if (process.env.BIRDIE_FRAMER_PREVIEW_CONFIRMATION !== "BUILD_BIRDIE_FRAMER_BRAND_PREVIEW") {
  throw new Error("Explicit confirmation required: BUILD_BIRDIE_FRAMER_BRAND_PREVIEW");
}

const result = await buildBirdieBrandPreview();

if (result.productionDeployed !== false || result.productionDeployAllowed !== false) {
  throw new Error("Preview safety invariant failed: production must remain untouched");
}

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
