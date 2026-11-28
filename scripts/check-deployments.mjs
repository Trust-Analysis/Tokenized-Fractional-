import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deploymentRegistry, normalizeNetwork, requireRegisteredContract } from '../backend/src/deployments.js';
import { registryManifestContracts } from '../frontend/scripts/sign-contract-manifest.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(new URL(path, new URL('..', import.meta.url)), 'utf8');
const keys = new Set();
for (const entry of deploymentRegistry.deployments) {
  const { contractId, network, wasmHash, deployTx, commitSha, provenance } = entry;
  assert.match(contractId, /^C[A-Z2-7]{55}$/);
  assert.equal(network, normalizeNetwork(network));
  const key = `${network}:${contractId}`;
  assert.ok(!keys.has(key), `Duplicate deployment ${key}`);
  keys.add(key);
  if (provenance !== 'legacy') {
    assert.match(wasmHash, /^[a-f0-9]{64}$/);
    assert.match(deployTx, /^[a-f0-9]{64}$/);
    assert.match(commitSha, /^[a-f0-9]{40}$/);
  }
}
const { payload } = JSON.parse(read('frontend/public/official-contracts.json'));
assert.deepEqual(payload.contracts, registryManifestContracts(payload.network));

const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
for (const path of tracked.split('\0').filter((file) =>
  /(^|\/)\.env(?:\.|$)/.test(file) || /^(?:k8s\/.*|docker-compose|render)\.ya?ml$/.test(file),
)) {
  const contents = read(path);
  const settings = Object.fromEntries(Array.from(contents.matchAll(
    /^\s*(?:-\s*)?((?:VITE_|SOROBAN_|STELLAR_)?(?:CONTRACT_ID|NETWORK(?:_PASSPHRASE)?))\s*[:=]\s*["']?([^"'\r\n#]*?)["']?\s*(?:#.*)?$/gm,
  ), ([, key, value]) => [key, value.trim().replace(/^\\(?=\$\{)/, '')]));
  const defaultNetwork = settings.VITE_NETWORK_PASSPHRASE ?? settings.SOROBAN_NETWORK ?? settings.STELLAR_NETWORK;
  for (const [name, value] of Object.entries(settings)) {
    if (!name.endsWith('CONTRACT_ID')) continue;
    const contractId = /^\$\{[^:}]+:-([^}]+)\}$/.exec(value)?.[1] ?? value;
    if (!contractId || contractId === 'C...' || contractId.startsWith('REPLACE_') || contractId.startsWith('${')) continue;
    requireRegisteredContract(defaultNetwork ?? 'testnet', contractId);
  }
}
