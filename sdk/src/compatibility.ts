/**
 * SDK version-compatibility support (Issue #888).
 *
 * The SDK is versioned independently from the Soroban contract and the
 * backend REST API. This module publishes the compatibility matrix (also
 * rendered in sdk/README.md) and provides the runtime check the clients use
 * to detect a known-incompatible deployment and warn about it.
 *
 * Version sources at runtime:
 *  - Contract: `get_contract_metadata()` → `version` field (see
 *    contracts/src/lib.rs, `contractmeta key = "version"`).
 *  - REST API: `GET /api-docs.json` → `info.version` (see
 *    backend/src/config/openapi.js).
 */

/** Current SDK version — keep in sync with sdk/package.json (`version`). */
export const SDK_VERSION = '0.1.0';

export interface CompatibilityRow {
  /** SDK semver range this row covers, e.g. ">=0.1.0 <0.2.0". */
  sdk: string;
  /** Supported contract `get_contract_metadata().version` values. */
  contractVersions: string[];
  /** Supported backend REST API versions (`/api-docs.json` `info.version`). */
  apiVersions: string[];
  notes: string;
}

/**
 * Compatibility matrix for published SDK versions.
 *
 * Update this table (and sdk/README.md, which mirrors it) whenever a new SDK
 * version is cut or a supported contract/API version changes. The SDK CI
 * workflow (.github/workflows/sdk.yml) runs on `sdk/**` changes so a matrix
 * update is always exercised by the SDK build and tests.
 */
export const COMPATIBILITY_MATRIX: CompatibilityRow[] = [
  {
    sdk: '>=0.1.0 <0.2.0',
    contractVersions: ['>=0.4.0 <0.5.0'],
    apiVersions: ['>=2.0.0 <3.0.0'],
    notes:
      'Developed and tested against contract 0.4.0 (contracts/src/lib.rs) '
      + 'and backend REST API v1 served by API 2.0.0 (backend OpenAPI info.version).',
  },
];

export interface CompatibilityInput {
  sdkVersion?: string;
  /** `get_contract_metadata().version`, when it could be determined. */
  contractVersion?: string | null;
  /** `/api-docs.json` `info.version`, when it could be determined. */
  apiVersion?: string | null;
}

export interface CompatibilityReport {
  sdkVersion: string;
  contractVersion: string | null;
  apiVersion: string | null;
  compatible: boolean;
  warnings: string[];
}

/** Parse a strict `major.minor.patch` version; returns null when unparseable. */
export function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? '').trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Compare two `major.minor.patch` versions (-1, 0, 1). Throws on bad input. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) {
    throw new Error(`compareVersions: invalid version ("${a}", "${b}")`);
  }
  for (let i = 0; i < 3; i += 1) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

/**
 * Does `version` satisfy `spec`? Spec is a space-separated (AND) list of:
 *  - an exact version          "0.4.0"
 *  - a wildcard prefix         "0.4.x" / "0.4.*"
 *  - a comparator              ">=0.4.0", ">0.4.0", "<0.5.0", "<=0.4.2"
 * An unparseable version never satisfies; an empty spec satisfies nothing.
 */
export function versionSatisfies(version: string, spec: string): boolean {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  const parts = String(spec ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;

  return parts.every((part) => {
    const wildcard = /^(\d+)\.(\d+)\.(?:x|\*)$/.exec(part);
    if (wildcard) {
      return parsed[0] === Number(wildcard[1]) && parsed[1] === Number(wildcard[2]);
    }
    const comparator = /^(>=|<=|>|<|=)?(.+)$/.exec(part);
    if (!comparator) return false;
    const op = comparator[1] ?? '=';
    const cmp = compareVersions(version, comparator[2].trim());
    switch (op) {
      case '>=': return cmp >= 0;
      case '<=': return cmp <= 0;
      case '>': return cmp > 0;
      case '<': return cmp < 0;
      default: return cmp === 0;
    }
  });
}

/** Matrix row covering this SDK version, if any. */
export function findMatrixRow(sdkVersion: string = SDK_VERSION): CompatibilityRow | null {
  return COMPATIBILITY_MATRIX.find((row) => versionSatisfies(sdkVersion, row.sdk)) ?? null;
}

function checkSide(
  label: string,
  version: string | null | undefined,
  supported: string[],
  warnings: string[],
): boolean {
  if (version === null || version === undefined || version === '') {
    // Not determined (endpoint unavailable / not feasible) — nothing to warn about.
    return true;
  }
  if (!parseVersion(version)) {
    warnings.push(`Could not parse deployed ${label} version "${version}".`);
    return false;
  }
  if (!supported.some((spec) => versionSatisfies(version, spec))) {
    warnings.push(
      `Deployed ${label} version "${version}" is outside the range supported by this SDK `
      + `(${supported.join(', ')}). See the compatibility matrix in sdk/README.md.`,
    );
    return false;
  }
  return true;
}

/**
 * Check a deployed version combination against the compatibility matrix.
 * Versions that could not be determined (`null`/`undefined`) are skipped —
 * the check is best-effort by design ("where feasible").
 */
export function checkCompatibility(input: CompatibilityInput = {}): CompatibilityReport {
  const sdkVersion = input.sdkVersion ?? SDK_VERSION;
  const warnings: string[] = [];

  const row = findMatrixRow(sdkVersion);
  if (!row) {
    warnings.push(
      `SDK version "${sdkVersion}" has no entry in the compatibility matrix `
      + '(sdk/src/compatibility.ts). Supported versions may have changed.',
    );
  }

  const contractOk = row
    ? checkSide('contract', input.contractVersion, row.contractVersions, warnings)
    : true;
  const apiOk = row
    ? checkSide('REST API', input.apiVersion, row.apiVersions, warnings)
    : true;

  return {
    sdkVersion,
    contractVersion: input.contractVersion ?? null,
    apiVersion: input.apiVersion ?? null,
    compatible: warnings.length === 0 && contractOk && apiOk,
    warnings,
  };
}

/**
 * Run the check and emit any warnings through `warn` (default `console.warn`).
 * Never throws — the SDK keeps working on known-incompatible combinations;
 * it only warns.
 */
export function warnOnIncompatibleCombination(
  input: CompatibilityInput = {},
  warn: (message: string) => void = console.warn,
): CompatibilityReport {
  let report: CompatibilityReport;
  try {
    report = checkCompatibility(input);
  } catch (error) {
    warn(`SDK compatibility check failed: ${(error as Error).message}`);
    return {
      sdkVersion: input.sdkVersion ?? SDK_VERSION,
      contractVersion: input.contractVersion ?? null,
      apiVersion: input.apiVersion ?? null,
      compatible: false,
      warnings: [`Compatibility check failed: ${(error as Error).message}`],
    };
  }
  for (const message of report.warnings) warn(message);
  return report;
}

/**
 * Best-effort extraction of the `version` string from a
 * `get_contract_metadata()` result. The on-chain value is an ScVal that may
 * already have been converted to a native JS object/array by the caller.
 */
export function extractContractVersion(metadata: unknown): string | null {
  if (metadata === null || metadata === undefined) return null;
  if (typeof metadata === 'string') {
    return parseVersion(metadata) ? metadata : null;
  }
  if (typeof metadata === 'object' && 'version' in (metadata as Record<string, unknown>)) {
    const version = (metadata as Record<string, unknown>).version;
    if (typeof version === 'string' && parseVersion(version)) return version;
  }
  // Compiled Soroban structs surface as ScVec arrays; the metadata struct
  // ends with the version string field.
  if (Array.isArray(metadata)) {
    for (let i = metadata.length - 1; i >= 0; i -= 1) {
      const candidate = metadata[i];
      if (typeof candidate === 'string' && parseVersion(candidate)) return candidate;
    }
  }
  return null;
}
