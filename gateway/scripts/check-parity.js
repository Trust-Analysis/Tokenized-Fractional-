#!/usr/bin/env node
/**
 * Gateway configuration parity check (Issue #891)
 *
 * The repo ships two gateway implementations that must stay functionally
 * equivalent for the routes they both serve:
 *   - gateway/aws/cdk-stack.ts   (AWS API Gateway via CDK + WAF)
 *   - gateway/kong/kong.yml      (self-hosted Kong, declarative config)
 *
 * This script extracts, with zero dependencies, the routing table (method,
 * path, auth requirement) plus Kong's per-route rate limit from both configs,
 * and verifies BOTH against the canonical contract in
 * gateway/config-parity.json. It also verifies the WAF rate-based rule limit
 * is identical across the CDK stack and both Terraform files.
 *
 * Exits non-zero with a diff report when the configs diverge, so it can run
 * as a CI step or pre-merge check:
 *   npm run gateway:check-parity
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(GATEWAY_ROOT, '..');

const problems = [];

function fail(msg) {
  problems.push(msg);
}

/** Normalize Kong-style params (/api/rwa/:id) to CDK-style (/api/rwa/{id}). */
function normalizePath(p) {
  return p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function routeKey(method, routePath) {
  return `${method.toUpperCase()} ${normalizePath(routePath)}`;
}

// ---------------------------------------------------------------------------
// Kong (kong.yml) — line-based extraction of routes, auth, and rate limits
// ---------------------------------------------------------------------------
function parseKong(yml) {
  const routes = new Map();
  const lines = yml.split('\n');

  let current = null; // { methods: [], path, auth, rateLimitPerMinute }
  let section = null; // 'methods' | 'paths' | 'rate'
  let inRoutes = false;

  const flush = () => {
    if (!current) return;
    for (const method of current.methods) {
      routes.set(routeKey(method, current.path), {
        auth: current.auth,
        rateLimitPerMinute: current.rateLimitPerMinute,
      });
    }
    current = null;
    section = null;
  };

  for (const rawLine of lines) {
    if (/^\s*routes:\s*$/.test(rawLine)) {
      inRoutes = true;
      continue;
    }
    if (/^\s*upstreams:\s*$/.test(rawLine)) {
      flush();
      inRoutes = false;
      continue;
    }
    if (!inRoutes) continue;

    // New route entry: "      - name: get-rwa-list"
    const routeStart = rawLine.match(/^\s{6}- name:\s*(\S+)\s*$/);
    if (routeStart) {
      flush();
      current = { methods: [], path: null, auth: 'none', rateLimitPerMinute: null };
      section = null;
      continue;
    }
    if (!current) continue;

    if (/^\s{8}methods:\s*$/.test(rawLine)) {
      section = 'methods';
      continue;
    }
    if (/^\s{8}paths:\s*$/.test(rawLine)) {
      section = 'paths';
      continue;
    }
    if (/^\s{8}plugins:\s*$/.test(rawLine)) {
      section = 'plugins';
      continue;
    }

    const listItem = rawLine.match(/^\s{10}-\s*(\S+)\s*$/);
    if (listItem && section === 'methods') {
      current.methods.push(listItem[1]);
      continue;
    }
    if (listItem && section === 'paths') {
      current.path = listItem[1];
      continue;
    }

    // Plugin entries are maps: "          - name: rate-limiting" (10 spaces)
    const plugin = rawLine.match(/^\s{10}- name:\s*(\S+)\s*$/);
    if (plugin) {
      if (['jwt', 'key-auth', 'basic-auth'].includes(plugin[1])) {
        current.auth = 'jwt';
      }
      section = plugin[1] === 'rate-limiting' ? 'rate' : 'plugins';
      continue;
    }

    // Rate limit: "              minute: 60" directly under the rate-limiting plugin
    if (section === 'rate') {
      const minute = rawLine.match(/^\s{14}minute:\s*(\d+)\s*$/);
      if (minute) {
        current.rateLimitPerMinute = Number(minute[1]);
        section = 'plugins';
        continue;
      }
    }
  }
  flush();
  return routes;
}

// ---------------------------------------------------------------------------
// AWS CDK (cdk-stack.ts) — resource tree + addMethod extraction
// ---------------------------------------------------------------------------
function parseCdk(ts) {
  const routes = new Map();
  // `api.root` is the RestApi root; `api` then holds the /api resource.
  const resourcePaths = { 'api.root': '' };

  // Walk addResource/addMethod occurrences in document order so the auth
  // detection window for each addMethod ends at the next declaration.
  const tokenRe = /(\w+)\s*=\s*([\w.]+)\.addResource\('([^']+)'\)|(\w+)\.addMethod\('(\w+)'/g;
  const tokens = [];
  let m;
  while ((m = tokenRe.exec(ts)) !== null) {
    tokens.push({ index: m.index, length: m[0].length, match: m });
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const { index, length, match } = tokens[i];
    const nextIndex = i + 1 < tokens.length ? tokens[i + 1].index : ts.length;
    const segment = ts.slice(index + length, nextIndex);

    if (match[1]) {
      // const <newVar> = <parentVar>.addResource('path')
      const newVar = match[1];
      const parentVar = match[2];
      const pathPart = match[3];
      const parentPath = resourcePaths[parentVar] ?? null;
      if (parentPath === null) {
        fail(`cdk: unknown parent resource variable "${parentVar}" for "${newVar}"`);
        continue;
      }
      resourcePaths[newVar] = `${parentPath}/${pathPart}`.replace(/\/+/g, '/');
    } else {
      // <var>.addMethod('METHOD', ...)
      const resourceVar = match[4];
      const method = match[5];
      const routePath = resourcePaths[resourceVar] ?? null;
      if (routePath === null) {
        fail(`cdk: unknown resource variable "${resourceVar}" for ${method} method`);
        continue;
      }
      const auth = /AuthorizationType\.CUSTOM/.test(segment) ? 'jwt' : 'none';
      routes.set(routeKey(method, routePath), { auth });
    }
  }
  return routes;
}

// ---------------------------------------------------------------------------
// WAF rate-limit extraction
// ---------------------------------------------------------------------------
function resolveTfVar(tfText, variablesText, varName) {
  const varBlock = variablesText.match(
    new RegExp(`variable\\s+"${varName}"\\s*\\{[\\s\\S]*?default\\s*=\\s*(\\d+)`)
  );
  return varBlock ? Number(varBlock[1]) : null;
}

function extractCdkWafLimit(ts) {
  const m = ts.match(/rateBasedStatement[\s\S]{0,200}?limit:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

function extractTerraformWafLimit(tfText, variablesText) {
  const m = tfText.match(/rate_based_statement\s*\{[\s\S]{0,200}?limit\s*=\s*(\S+)/);
  if (!m) return null;
  const value = m[1];
  if (/^\d+$/.test(value)) return Number(value);
  const varRef = value.match(/^var\.([A-Za-z0-9_]+)$/);
  if (varRef) return resolveTfVar(tfText, variablesText, varRef[1]);
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const manifest = JSON.parse(readFileSync(path.join(GATEWAY_ROOT, 'config-parity.json'), 'utf8'));
const kongRoutes = parseKong(readFileSync(path.join(GATEWAY_ROOT, 'kong', 'kong.yml'), 'utf8'));
const cdkRoutes = parseCdk(readFileSync(path.join(GATEWAY_ROOT, 'aws', 'cdk-stack.ts'), 'utf8'));

console.log('Gateway configuration parity check (Issue #891)');
console.log(`  manifest routes: ${manifest.routes.length}`);
console.log(`  kong.yml routes: ${kongRoutes.size}`);
console.log(`  cdk-stack.ts routes: ${cdkRoutes.size}`);
console.log('');

for (const expected of manifest.routes) {
  const key = routeKey(expected.method, expected.path);

  // Kong side
  const kong = kongRoutes.get(key);
  if (!kong) {
    fail(`kong.yml: missing route ${key} (declared in config-parity.json)`);
  } else {
    if (kong.auth !== expected.auth) {
      fail(`kong.yml: ${key} auth is "${kong.auth}", manifest requires "${expected.auth}"`);
    }
    if (expected.kongRateLimitPerMinute != null && kong.rateLimitPerMinute !== expected.kongRateLimitPerMinute) {
      fail(
        `kong.yml: ${key} rate limit is ${kong.rateLimitPerMinute}/min, manifest requires ${expected.kongRateLimitPerMinute}/min`
      );
    }
  }

  // AWS CDK side
  const cdk = cdkRoutes.get(key);
  if (!cdk) {
    fail(`cdk-stack.ts: missing route ${key} (declared in config-parity.json)`);
  } else if (cdk.auth !== expected.auth) {
    fail(`cdk-stack.ts: ${key} auth is "${cdk.auth}", manifest requires "${expected.auth}"`);
  }
}

// Routes present in a gateway config but NOT in the manifest (bidirectional check).
const manifestKeys = new Set(manifest.routes.map((r) => routeKey(r.method, r.path)));
for (const key of kongRoutes.keys()) {
  if (!manifestKeys.has(key)) fail(`kong.yml: route ${key} exists but is not declared in config-parity.json`);
}
for (const key of cdkRoutes.keys()) {
  if (!manifestKeys.has(key)) fail(`cdk-stack.ts: route ${key} exists but is not declared in config-parity.json`);
}

// WAF rate limit consistency across CDK + Terraform sources.
const terraformVariables = readFileSync(path.join(REPO_ROOT, 'terraform', 'variables.tf'), 'utf8');
const wafLimits = {
  'gateway/aws/cdk-stack.ts': extractCdkWafLimit(readFileSync(path.join(GATEWAY_ROOT, 'aws', 'cdk-stack.ts'), 'utf8')),
  'gateway/aws/waf.tf': extractTerraformWafLimit(readFileSync(path.join(GATEWAY_ROOT, 'aws', 'waf.tf'), 'utf8'), terraformVariables),
  'terraform/waf.tf': extractTerraformWafLimit(readFileSync(path.join(REPO_ROOT, 'terraform', 'waf.tf'), 'utf8'), terraformVariables),
};

for (const source of manifest.waf.sources) {
  const limit = wafLimits[source];
  if (limit == null) {
    fail(`waf: could not extract rate-based limit from ${source}`);
  } else if (limit !== manifest.waf.rateLimitPerIpPer5Minutes) {
    fail(
      `waf: ${source} rate-based limit is ${limit}/5min per IP, manifest requires ${manifest.waf.rateLimitPerIpPer5Minutes}`
    );
  }
}

if (problems.length > 0) {
  console.error('PARITY CHECK FAILED — gateway configurations have diverged:\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    '\nFix the diverging config (or intentionally update gateway/config-parity.json together with BOTH gateway docs).'
  );
  process.exit(1);
}

console.log('✓ All gateway configs match the parity manifest (routes, auth, rate limits, WAF limits).');
