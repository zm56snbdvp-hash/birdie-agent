import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSaleAttributionReport,
  renderSaleAttributionReportMarkdown,
} from '../apps/desktop/src/stream-sale-attribution.js';
import {
  validateAttributionShowMapping,
  validateSaleShowVariants,
} from '../apps/desktop/src/stream-sale-show-contract.js';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PATHS = Object.freeze({
  manifest: path.join(REPOSITORY_ROOT, 'ops', 'stream', 'birdie-stream-attribution-fixtures.json'),
  shows: path.join(REPOSITORY_ROOT, 'ops', 'stream', 'birdie-stream-sale-shows.json'),
  outputJson: path.join(REPOSITORY_ROOT, 'ops', 'evidence', 'birdie-stream-sale-attribution-20260831.json'),
  outputMarkdown: path.join(REPOSITORY_ROOT, 'ops', 'evidence', 'birdie-stream-sale-attribution-20260831.md'),
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function readJsonWithDigest(filePath) {
  const bytes = await readFile(filePath);
  return Object.freeze({ value: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes) });
}

export function computeAttributionComparisonFingerprint(manifest) {
  return sha256(Buffer.from(stableJson({
    schemaVersion: manifest?.schemaVersion,
    scope: manifest?.scope,
    eventSchema: manifest?.eventSchema,
    policy: manifest?.policy,
    allowed: manifest?.allowed,
    attributionMapping: manifest?.attributionMapping,
  }), 'utf8'));
}

export async function runStreamSaleAttribution({
  synthetic = false,
  write = false,
  paths = DEFAULT_PATHS,
} = {}) {
  if (!synthetic) throw new Error('Only the explicit --synthetic local attribution fixture is supported.');
  const [manifest, shows] = await Promise.all([
    readJsonWithDigest(paths.manifest),
    readJsonWithDigest(paths.shows),
  ]);
  const comparisonFingerprintSha256 = computeAttributionComparisonFingerprint(manifest.value);
  if (String(manifest.value?.comparisonFingerprintSha256).toLowerCase() !== comparisonFingerprintSha256) {
    throw new Error('Attribution comparison fingerprint does not match the canonical schema/policy surface.');
  }
  const showValidation = validateSaleShowVariants(shows.value);
  const attributionShowMapping = validateAttributionShowMapping(manifest.value, shows.value);
  if (showValidation.status !== 'PASS' || attributionShowMapping.status !== 'PASS') {
    throw new Error('Stream-to-sale show or attribution mapping contract failed.');
  }
  const report = createSaleAttributionReport({
    manifest: manifest.value,
    showValidation,
    attributionShowMapping,
    sourceDigests: {
      attributionFixtures: manifest.sha256,
      saleShowVariants: shows.sha256,
    },
  });
  const canonicalSha256 = sha256(Buffer.from(stableJson(report), 'utf8'));
  const finalReport = Object.freeze({ ...report, canonicalSha256 });
  const markdown = renderSaleAttributionReportMarkdown(finalReport);
  if (write) {
    await Promise.all([
      writeFile(paths.outputJson, `${JSON.stringify(finalReport, null, 2)}\n`, 'utf8'),
      writeFile(paths.outputMarkdown, markdown, 'utf8'),
    ]);
  }
  return Object.freeze({ report: finalReport, markdown, paths });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const synthetic = process.argv.includes('--synthetic');
  const write = process.argv.includes('--write');
  try {
    const { report, paths } = await runStreamSaleAttribution({ synthetic, write });
    process.stdout.write(`${JSON.stringify({
      evidenceId: report.evidenceId,
      canonicalSha256: report.canonicalSha256,
      comparisonFingerprintSha256: report.comparisonFingerprintSha256,
      localSyntheticAttribution: report.decisions.localSyntheticAttribution,
      syntheticBaselineRegression: report.decisions.syntheticBaselineRegression,
      realViewToSaleAttribution: report.decisions.realViewToSaleAttribution,
      supervisedPrivateTest: report.decisions.supervisedPrivateTest,
      publicStream: report.decisions.publicStream,
      publication: report.decisions.publication,
      wrote: write ? {
        json: path.relative(REPOSITORY_ROOT, paths.outputJson).replaceAll('\\', '/'),
        markdown: path.relative(REPOSITORY_ROOT, paths.outputMarkdown).replaceAll('\\', '/'),
      } : false,
    }, null, 2)}\n`);
    process.exitCode = report.decisions.localSyntheticAttribution === 'PASS'
      && report.decisions.syntheticBaselineRegression === 'PASS' ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Birdie stream-to-sale attribution failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
