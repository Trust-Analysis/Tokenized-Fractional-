import { readFileSync } from 'node:fs';

export const deploymentRegistry = JSON.parse(
  readFileSync(new URL('../deployments.json', import.meta.url), 'utf8'),
);

export function normalizeNetwork(value) {
  switch (value?.trim().toUpperCase()) {
    case 'TESTNET':
    case 'TEST SDF NETWORK ; SEPTEMBER 2015':
      return 'TESTNET';
    case 'PUBLIC':
    case 'MAINNET':
    case 'PUBLIC GLOBAL STELLAR NETWORK ; SEPTEMBER 2015':
      return 'MAINNET';
    default:
      return undefined;
  }
}

export function requireRegisteredContract(network, contractId) {
  const match = deploymentRegistry.deployments.find((entry) =>
    entry.network === normalizeNetwork(network) && entry.contractId === contractId,
  );
  if (!match) throw new Error(`Contract ${contractId} is missing from the ${network} deployment registry`);
  return match;
}
