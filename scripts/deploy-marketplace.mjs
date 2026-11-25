import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { deploymentRegistry, normalizeNetwork } from '../backend/src/deployments.js';

const [networkName, source, wasmPath] = process.argv.slice(2);
const network = normalizeNetwork(networkName);
if (!network || !source || !wasmPath) {
  throw new Error('Usage: node scripts/deploy-marketplace.mjs <testnet|mainnet> <stellar-identity-alias> <wasm-path>');
}
const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = resolve(wasmPath);
const cliNetwork = network === 'MAINNET' ? 'mainnet' : 'testnet';
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain', '--', 'contracts')) {
  throw new Error('Commit contract sources before deploying');
}
const commitSha = git('rev-parse', 'HEAD');
const wasmHash = createHash('sha256').update(readFileSync(wasm)).digest('hex');
const args = ['contract', 'deploy', '--wasm', wasm, '--source', source, '--network', cliNetwork];
const result = spawnSync('stellar', args, { encoding: 'utf8' });
process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('Stellar contract deployment failed');

const contractId = result.stdout.trim();
const hashes = Array.from((result.stderr ?? '').matchAll(/Transaction hash is ([a-f0-9]{64})\b/g));
const deployTx = hashes.at(-1)?.[1];
if (!/^C[A-Z2-7]{55}$/.test(contractId) || !deployTx) {
  throw new Error('Deployment output must contain the contract ID and transaction hash');
}
const remoteWasmHash = execFileSync('stellar', [
  'contract', 'info', 'hash', '--id', contractId, '--network', cliNetwork,
], { encoding: 'utf8' }).trim();
if (remoteWasmHash !== wasmHash) throw new Error('Deployed Wasm hash differs from the local artifact');

deploymentRegistry.deployments.push({
  contractId, network, asset: 'marketplace', label: 'RWA Marketplace',
  status: 'pending', wasmHash, deployTx, commitSha,
});
const target = resolve(root, 'backend/deployments.json');
const temp = `${target}.${process.pid}.tmp`;
writeFileSync(temp, JSON.stringify(deploymentRegistry, null, 2) + '\n', { flag: 'wx' });
renameSync(temp, target);
console.log(contractId);
