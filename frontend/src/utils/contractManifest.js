/**
 * Official contract manifest verification (Issue #792).
 *
 * The frontend reads the contract it signs transactions against from its own
 * build-time configuration (`VITE_CONTRACT_ID`). Nothing about that value is
 * self-authenticating: a misconfigured build, a compromised CI pipeline or a
 * malicious fork pointed at an attacker-controlled contract is otherwise
 * indistinguishable from the legitimate app.
 *
 * To close that gap we publish a signed, canonical manifest of the officially
 * sanctioned contract addresses (`public/official-contracts.json`, produced by
 * `scripts/sign-contract-manifest.mjs`) and cross-check the configured address
 * against it at startup. If the address is absent, or the manifest cannot be
 * verified against a pinned signer, the UI raises a prominent warning banner.
 *
 * Everything here is dependency-free and side-effect-free so the policy can be
 * unit tested in isolation; the React wiring lives in
 * `hooks/useContractManifest.js`.
 */

export const CONTRACT_MANIFEST_SCHEMA = 'rwa.official-contracts/v1';

/** Where the signed manifest is served from by default. */
export const DEFAULT_MANIFEST_URL = '/official-contracts.json';

/**
 * Public keys permitted to sign the canonical manifest, base64-encoded raw
 * Ed25519 keys. A manifest signed by any other key is rejected even if its
 * signature is otherwise valid.
 */
export const OFFICIAL_MANIFEST_SIGNERS = ['qel0kmdcMCOMh5nuUDrxHN8jpxFe1C3prEU0AKw+FJE='];

/** The placeholder used when `VITE_CONTRACT_ID` has not been set. */
export const UNCONFIGURED_CONTRACT_ID = 'C...';

/** Result vocabulary shared by the verifier, hook and banner. */
export const DEPLOYMENT_STATUS = Object.freeze({
  /** Still resolving; render nothing yet. */
  CHECKING: 'checking',
  /** Configured address is present in a valid official manifest. */
  OFFICIAL: 'official',
  /** Manifest verified, but the configured address is not in it. */
  UNOFFICIAL: 'unofficial',
  /** No manifest, or its signature could not be validated. */
  UNVERIFIED: 'unverified',
  /** No contract address is configured for this build. */
  NOT_CONFIGURED: 'not-configured',
});

function readEnv(key, fallback = '') {
  const env = import.meta.env || {};
  const value = env[key];
  return value === undefined || value === null ? fallback : String(value);
}

/** Resolve the manifest URL, allowing a deployment-time override. */
export function resolveManifestUrl() {
  return readEnv('VITE_CONTRACT_MANIFEST_URL') || DEFAULT_MANIFEST_URL;
}

/** Pinned signers, plus any deployment-time additions from the environment. */
export function resolvePinnedSigners() {
  const fromEnv = readEnv('VITE_CONTRACT_MANIFEST_SIGNERS')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set([...OFFICIAL_MANIFEST_SIGNERS, ...fromEnv])];
}

/**
 * Deterministic, key-sorted JSON serialisation. The signer and this verifier
 * must agree byte-for-byte on what was signed, so object keys are sorted
 * recursively (mirrors `scripts/sign-contract-manifest.mjs`).
 */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

/** Decode a standard (not URL-safe) base64 string to bytes. */
export function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Default signature verifier: WebCrypto Ed25519.
 *
 * Returns `{ valid }` rather than throwing so callers can degrade to the
 * "unverified" status instead of crashing the app.
 */
export async function verifyEd25519Signature({
  publicKey,
  signature,
  data,
  subtle = globalThis.crypto && globalThis.crypto.subtle,
}) {
  if (!subtle) {
    return { valid: false, reason: 'WebCrypto is unavailable in this environment.' };
  }
  try {
    const key = await subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify']);
    const valid = await subtle.verify({ name: 'Ed25519' }, key, signature, data);
    return { valid: Boolean(valid) };
  } catch (error) {
    return { valid: false, reason: error && error.message ? error.message : 'Verification error.' };
  }
}

/**
 * Verify a signed manifest envelope against the pinned signer list.
 *
 * @returns {Promise<{valid: boolean, reason?: string, payload?: object}>}
 */
export async function verifyManifest(manifest, options = {}) {
  const signers = options.signers || resolvePinnedSigners();
  const verify = options.verify || verifyEd25519Signature;

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, reason: 'Manifest is missing or not an object.' };
  }
  const { payload, signer, signature } = manifest;
  if (!payload || typeof payload !== 'object' || !signer || !signature) {
    return { valid: false, reason: 'Manifest is missing a payload, signer or signature.' };
  }
  if (Array.isArray(signers) && signers.length > 0 && !signers.includes(signer)) {
    return { valid: false, reason: 'Manifest was signed by a key that is not pinned.' };
  }

  let result;
  try {
    result = await verify({
      publicKey: decodeBase64(signer),
      signature: decodeBase64(signature),
      data: new TextEncoder().encode(canonicalize(payload)),
    });
  } catch (error) {
    return { valid: false, reason: error && error.message ? error.message : 'Verification error.' };
  }

  if (!result || !result.valid) {
    return {
      valid: false,
      reason: (result && result.reason) || 'Signature does not match payload.',
    };
  }
  return { valid: true, payload };
}

/** Every contract id listed in a manifest payload. */
export function listContractIds(payload) {
  if (!payload || !Array.isArray(payload.contracts)) return [];
  return payload.contracts
    .map((entry) => (entry && typeof entry.id === 'string' ? entry.id : null))
    .filter(Boolean);
}

/** Find the manifest entry for a contract id, if present. */
export function findContractEntry(payload, contractId) {
  if (!payload || !Array.isArray(payload.contracts)) return null;
  return payload.contracts.find((entry) => entry && entry.id === contractId) || null;
}

/**
 * Map a network passphrase (or an already-normalised name) to the short label
 * used in the manifest, e.g. 'TESTNET' / 'PUBLIC'.
 */
export function resolveNetworkName(networkOrPassphrase) {
  if (!networkOrPassphrase) return undefined;
  const value = String(networkOrPassphrase);
  if (/test/i.test(value)) return 'TESTNET';
  if (/public|global/i.test(value) || /mainnet/i.test(value)) return 'PUBLIC';
  return value.toUpperCase();
}

/**
 * Decide how a configured contract address relates to the official manifest.
 *
 * @param {object}  params
 * @param {string}  params.contractId       value of `VITE_CONTRACT_ID`
 * @param {string}  [params.network]        configured network passphrase or name
 * @param {object}  [params.payload]        verified manifest payload, if any
 * @param {boolean} [params.manifestVerified] whether `payload` passed verification
 * @returns {{status: string, reason: string, contractId?: string, entry?: object|null}}
 */
export function evaluateContractDeployment({
  contractId,
  network,
  payload,
  manifestVerified,
} = {}) {
  const configured = typeof contractId === 'string' ? contractId.trim() : '';

  if (!configured || configured === UNCONFIGURED_CONTRACT_ID) {
    return {
      status: DEPLOYMENT_STATUS.NOT_CONFIGURED,
      reason: 'No contract address is configured for this build.',
    };
  }

  if (!manifestVerified || !payload) {
    return {
      status: DEPLOYMENT_STATUS.UNVERIFIED,
      reason:
        'The official contract manifest could not be fetched or its signature could not be verified, so this build’s contract address is unconfirmed.',
      contractId: configured,
    };
  }

  const entry = findContractEntry(payload, configured);
  if (!entry) {
    return {
      status: DEPLOYMENT_STATUS.UNOFFICIAL,
      reason: 'The configured contract address is not listed in the official manifest.',
      contractId: configured,
      entry: null,
    };
  }

  const networkSource = payload.networkPassphrase || payload.network;
  const expectedNetwork = networkSource ? resolveNetworkName(networkSource) : undefined;
  const actualNetwork = network ? resolveNetworkName(network) : undefined;

  if (expectedNetwork && actualNetwork && expectedNetwork !== actualNetwork) {
    return {
      status: DEPLOYMENT_STATUS.UNOFFICIAL,
      reason: `The configured contract is official on ${expectedNetwork}, but this build targets ${actualNetwork}.`,
      contractId: configured,
      entry,
    };
  }

  return { status: DEPLOYMENT_STATUS.OFFICIAL, reason: '', contractId: configured, entry };
}

/** Fetch the signed manifest. */
export async function loadOfficialManifest({
  url = resolveManifestUrl(),
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this environment.');
  }
  const response = await fetchImpl(url, { cache: 'no-store', credentials: 'omit' });
  if (!response || !response.ok) {
    throw new Error(`Manifest request failed (${response ? response.status : 'no response'}).`);
  }
  return response.json();
}

/**
 * End-to-end check: fetch the manifest, verify its signature, then evaluate the
 * configured address against it. Never throws — failures collapse into the
 * `unverified` status so the UI can warn rather than crash.
 */
export async function verifyConfiguredContract({
  contractId,
  network,
  url = resolveManifestUrl(),
  fetchImpl,
  signers,
  verify,
} = {}) {
  const configured = typeof contractId === 'string' ? contractId.trim() : '';
  if (!configured || configured === UNCONFIGURED_CONTRACT_ID) {
    return { ...evaluateContractDeployment({ contractId }), manifestUrl: url };
  }

  try {
    const manifest = await loadOfficialManifest({ url, fetchImpl });
    const verification = await verifyManifest(manifest, { signers, verify });
    const evaluation = evaluateContractDeployment({
      contractId,
      network,
      payload: verification.payload,
      manifestVerified: verification.valid,
    });
    return {
      ...evaluation,
      manifestUrl: url,
      reason: verification.valid
        ? evaluation.reason
        : `${evaluation.reason} (${verification.reason})`,
    };
  } catch (error) {
    return {
      status: DEPLOYMENT_STATUS.UNVERIFIED,
      reason: `${error && error.message ? error.message : 'Manifest verification failed.'}`,
      contractId: configured,
      manifestUrl: url,
    };
  }
}
