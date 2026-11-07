#!/usr/bin/env node
/**
 * sign-contract-manifest.mjs (Issue #792)
 *
 * Generates, signs and verifies the canonical manifest of officially
 * sanctioned contract addresses that the frontend cross-checks its
 * `VITE_CONTRACT_ID` against at startup.
 *
 * The manifest is an Ed25519-signed envelope:
 *
 *   {
 *     "schema": "...",
 *     "signer": "<base64 raw ed25519 public key>",
 *     "payload": { ... address list ... },
 *     "signature": "<base64 ed25519 signature over canonicalize(payload)>"
 *   }
 *
 * Verification uses only Node's built-in `node:crypto`, so this script (and
 * the CI check that runs it) needs no third-party dependency.
 *
 * Usage
 * -----
 *   node scripts/sign-contract-manifest.mjs keygen [--out key.json]
 *   node scripts/sign-contract-manifest.mjs sign \
 *       --key-file key.json \
 *       --payload contract-manifest/official-contracts.payload.json \
 *       --out public/official-contracts.json
 *   node scripts/sign-contract-manifest.mjs verify [--file public/official-contracts.json]
 *
 * The signing key is a release secret and MUST NOT be committed. Only the
 * signed artifact and the pinned public key (see
 * `src/utils/contractManifest.js`) belong in the repository.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(SCRIPT_DIR, '..');
export const DEFAULT_PAYLOAD_PATH = resolve(
  FRONTEND_DIR,
  'contract-manifest',
  'official-contracts.payload.json',
);
export const DEFAULT_MANIFEST_PATH = resolve(
  FRONTEND_DIR,
  'public',
  'official-contracts.json',
);

/**
 * Deterministic, key-sorted JSON serialisation.
 *
 * Both this script and the runtime verifier must agree byte-for-byte on the
 * bytes that were signed, so object keys are sorted recursively.
 */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(',')}}`;
}

/** Wrap a 32-byte raw Ed25519 public key in its SPKI DER envelope. */
function publicKeyFromRaw(raw) {
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return createPublicKey({
    key: Buffer.concat([prefix, Buffer.from(raw)]),
    format: 'der',
    type: 'spki',
  });
}

/** Import an Ed25519 private key from a JWK ({ kty:'OKP', crv:'Ed25519', d }). */
function privateKeyFromJwk(jwk) {
  return createPrivateKey({ key: jwk, format: 'jwk' });
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const [flag, inlineValue] = token.slice(2).split('=');
      if (inlineValue !== undefined) {
        args[flag] = inlineValue;
      } else {
        args[flag] = argv[i + 1];
        i += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function buildEnvelope(payload, signingKey) {
  const publicKey = createPublicKey(signingKey);
  const rawPublic = publicKey.export({ format: 'jwk' }).x;
  const signer = Buffer.from(rawPublic, 'base64url').toString('base64');
  const signature = nodeSign(null, Buffer.from(canonicalize(payload)), signingKey).toString(
    'base64',
  );
  return { signer, signature };
}

export function verifyEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return { valid: false, reason: 'manifest is not an object' };
  }
  const { payload, signer, signature } = envelope;
  if (!payload || !signer || !signature) {
    return { valid: false, reason: 'manifest is missing payload, signer or signature' };
  }
  try {
    const rawPublic = Buffer.from(signer, 'base64');
    if (rawPublic.length !== 32) {
      return { valid: false, reason: 'signer is not a 32-byte Ed25519 public key' };
    }
    const valid = nodeVerify(
      null,
      Buffer.from(canonicalize(payload)),
      publicKeyFromRaw(rawPublic),
      Buffer.from(signature, 'base64'),
    );
    return valid ? { valid: true } : { valid: false, reason: 'signature does not match payload' };
  } catch (error) {
    return { valid: false, reason: `verification failed: ${error.message}` };
  }
}

function cmdKeygen(args) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicJwk = publicKey.export({ format: 'jwk' });
  const privateJwk = privateKey.export({ format: 'jwk' });
  const out = args.out || resolve(FRONTEND_DIR, '.contract-manifest-signing-key.json');

  writeFileSync(
    out,
    `${JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: publicJwk.x, d: privateJwk.d }, null, 2)}\n`,
  );

  process.stdout.write(
    `Signing key written to ${out}\n` +
      `Pinned signer (base64): ${Buffer.from(publicJwk.x, 'base64url').toString('base64')}\n` +
      'Keep this file out of version control.\n',
  );
  return 0;
}

function cmdSign(args) {
  const keyFile = args['key-file'];
  if (!keyFile) throw new Error('sign requires --key-file <path>');
  const payloadPath = args.payload || DEFAULT_PAYLOAD_PATH;
  const outPath = args.out || DEFAULT_MANIFEST_PATH;

  const jwk = JSON.parse(readFileSync(keyFile, 'utf8'));
  const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
  const { signer, signature } = buildEnvelope(payload, privateKeyFromJwk(jwk));

  const envelope = {
    schema: payload.schema || 'rwa.official-contracts/v1',
    signer,
    payload,
    signature,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(envelope, null, 2)}\n`);
  process.stdout.write(`Signed manifest written to ${outPath}\nSigner: ${signer}\n`);
  return 0;
}

function cmdVerify(args) {
  const file = args.file || DEFAULT_MANIFEST_PATH;
  const envelope = JSON.parse(readFileSync(file, 'utf8'));
  const result = verifyEnvelope(envelope);
  if (!result.valid) {
    process.stderr.write(`✘ ${file}: ${result.reason}\n`);
    return 1;
  }
  process.stdout.write(`✔ ${file}: signature valid\n`);
  return 0;
}

export function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0];
  switch (command) {
    case 'keygen':
      return cmdKeygen(args);
    case 'sign':
      return cmdSign(args);
    case 'verify':
      return cmdVerify(args);
    default:
      process.stderr.write(
        'Usage: sign-contract-manifest.mjs <keygen|sign|verify> [options]\n',
      );
      return 2;
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  process.exitCode = run();
}
