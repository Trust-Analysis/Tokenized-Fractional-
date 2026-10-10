import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicKey, verify as nodeVerify } from 'node:crypto';
import {
  DEPLOYMENT_STATUS,
  OFFICIAL_MANIFEST_SIGNERS,
  canonicalize,
  evaluateContractDeployment,
  findContractEntry,
  listContractIds,
  resolveNetworkName,
  verifyManifest,
} from '../utils/contractManifest';

/** Verify an Ed25519 signature with node:crypto (independent of WebCrypto). */
function nodeVerifyEd25519({ publicKey, signature, data }) {
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  const key = createPublicKey({
    key: Buffer.concat([prefix, Buffer.from(publicKey)]),
    format: 'der',
    type: 'spki',
  });
  return { valid: nodeVerify(null, Buffer.from(data), key, Buffer.from(signature)) };
}

// Vitest's root is the frontend package, so the served manifest lives here.
const MANIFEST_PATH = resolve(process.cwd(), 'public/official-contracts.json');
const loadManifest = () => JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

describe('canonicalize', () => {
  it('sorts object keys recursively so the signed bytes are deterministic', () => {
    const a = canonicalize({ b: 1, a: { d: 2, c: [3, 4] } });
    const b = canonicalize({ a: { c: [3, 4], d: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  it('serialises primitives and arrays', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize('x')).toBe('"x"');
    expect(canonicalize([1, 'a'])).toBe('[1,"a"]');
  });
});

describe('shipped manifest', () => {
  it('is signed by a pinned key', async () => {
    const manifest = loadManifest();
    expect(OFFICIAL_MANIFEST_SIGNERS).toContain(manifest.signer);

    const result = await verifyManifest(manifest, { verify: nodeVerifyEd25519 });
    expect(result.valid).toBe(true);
    expect(result.payload).toBeTruthy();
  });

  it('is rejected when the payload is tampered with', async () => {
    const manifest = loadManifest();
    manifest.payload.contracts[0].id =
      'CTAMPERED0000000000000000000000000000000000000000000000000000';

    const result = await verifyManifest(manifest, { verify: nodeVerifyEd25519 });
    expect(result.valid).toBe(false);
  });

  it('is rejected when signed by an unpinned key', async () => {
    const manifest = loadManifest();
    manifest.signer = Buffer.alloc(32, 1).toString('base64');

    const result = await verifyManifest(manifest, { verify: nodeVerifyEd25519 });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/pinned/i);
  });
});

describe('manifest helpers', () => {
  const payload = {
    networkPassphrase: 'Test SDF Network ; September 2015',
    contracts: [
      { id: 'CAAAA', network: 'TESTNET' },
      { id: 'CBBBB', network: 'TESTNET' },
    ],
  };

  it('lists contract ids and finds entries', () => {
    expect(listContractIds(payload)).toEqual(['CAAAA', 'CBBBB']);
    expect(findContractEntry(payload, 'CBBBB')).toEqual({ id: 'CBBBB', network: 'TESTNET' });
    expect(findContractEntry(payload, 'CZZZZ')).toBeNull();
  });

  it('normalises network names', () => {
    expect(resolveNetworkName('Test SDF Network ; September 2015')).toBe('TESTNET');
    expect(resolveNetworkName('Public Global Stellar Network ; September 2015')).toBe('PUBLIC');
  });
});

describe('evaluateContractDeployment', () => {
  it('reports not-configured for the placeholder address', () => {
    expect(evaluateContractDeployment({ contractId: 'C...' }).status).toBe(
      DEPLOYMENT_STATUS.NOT_CONFIGURED,
    );
    expect(evaluateContractDeployment({ contractId: '' }).status).toBe(
      DEPLOYMENT_STATUS.NOT_CONFIGURED,
    );
  });

  it('warns when the configured contract is absent from the manifest', () => {
    const result = evaluateContractDeployment({
      contractId: 'CNOTLISTED',
      network: 'Test SDF Network ; September 2015',
      payload: { contracts: [{ id: 'CAAAA', network: 'TESTNET' }] },
      manifestVerified: true,
    });
    expect(result.status).toBe(DEPLOYMENT_STATUS.UNOFFICIAL);
  });

  it('reports unverified when the manifest could not be verified', () => {
    const result = evaluateContractDeployment({
      contractId: 'CAAAA',
      manifestVerified: false,
      payload: undefined,
    });
    expect(result.status).toBe(DEPLOYMENT_STATUS.UNVERIFIED);
  });

  it('approves a listed contract on the matching network', () => {
    const result = evaluateContractDeployment({
      contractId: 'CAAAA',
      network: 'Test SDF Network ; September 2015',
      payload: { contracts: [{ id: 'CAAAA', network: 'TESTNET' }] },
      manifestVerified: true,
    });
    expect(result.status).toBe(DEPLOYMENT_STATUS.OFFICIAL);
  });

  it('warns when a listed contract targets a different network', () => {
    const result = evaluateContractDeployment({
      contractId: 'CAAAA',
      network: 'Public Global Stellar Network ; September 2015',
      payload: {
        networkPassphrase: 'Test SDF Network ; September 2015',
        contracts: [{ id: 'CAAAA', network: 'TESTNET' }],
      },
      manifestVerified: true,
    });
    expect(result.status).toBe(DEPLOYMENT_STATUS.UNOFFICIAL);
  });
});
